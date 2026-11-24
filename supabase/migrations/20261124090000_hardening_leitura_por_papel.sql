-- Hardening (card GRD-33): leitura por papel garantida no banco.
--
-- Antes, a regra de leitura era "qualquer membro do idoso", e o que o cuidador não deve
-- ver (exames, tendências, observações, visão 360, diretivas e alertas clínicos) ficava
-- escondido só na tela. Agora o banco recusa: quem chamar a API direto também não lê.
--
-- Regra (docs/permissoes.md): o cuidador recebe o que é operacional, não o clínico.

-- 1. Papel de quem chama, num idoso ---------------------------------------------

create or replace function public.papel_em(p_idoso uuid)
returns text language sql security definer stable set search_path = public as $$
  select v.papel
  from vinculo v
  where v.idoso_id = p_idoso and v.usuario_id = auth.uid() and v.deleted_at is null
  limit 1;
$$;

grant execute on function public.papel_em(uuid) to authenticated;

-- Leitura clínica: membro que NÃO é cuidador.
create or replace function public.pode_ler_clinico(p_idoso uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce(public.papel_em(p_idoso), 'nenhum') in ('familiar', 'idoso');
$$;

grant execute on function public.pode_ler_clinico(uuid) to authenticated;

-- 2. Tabelas clínicas: SELECT só para familiar e titular -----------------------------

drop policy if exists exame_sel on public.exame;
create policy exame_sel on public.exame for select
  using (public.pode_ler_clinico(idoso_id));

drop policy if exists analito_sel on public.analito;
create policy analito_sel on public.analito for select
  using (public.pode_ler_clinico(idoso_id));

drop policy if exists diretiva_sel on public.diretiva;
create policy diretiva_sel on public.diretiva for select
  using (public.pode_ler_clinico(idoso_id));

drop policy if exists visao_360_sel on public.visao_360;
create policy visao_360_sel on public.visao_360 for select
  using (public.pode_ler_clinico(idoso_id));

drop policy if exists insight_sel on public.insight;
create policy insight_sel on public.insight for select
  using (public.pode_ler_clinico(idoso_id));

-- exame_resultado tinha uma política única "for all"; separo leitura e escrita.
drop policy if exists exres_all on public.exame_resultado;
create policy exres_sel on public.exame_resultado for select
  using (public.pode_ler_clinico((select e.idoso_id from public.exame e where e.id = exame_id)));
create policy exres_ins on public.exame_resultado for insert
  with check (public.is_member((select e.idoso_id from public.exame e where e.id = exame_id)));
create policy exres_upd on public.exame_resultado for update
  using (public.is_member((select e.idoso_id from public.exame e where e.id = exame_id)))
  with check (public.is_member((select e.idoso_id from public.exame e where e.id = exame_id)));

-- 3. Alertas: o cuidador só enxerga os operacionais, e só os textos que são dele ----------

drop policy if exists alerta_sel on public.alerta;
create policy alerta_sel on public.alerta for select
  using (
    public.is_member(idoso_id)
    and (natureza = 'operacional' or public.pode_ler_clinico(idoso_id))
  );

drop policy if exists alertdest_sel on public.alerta_destinatario;
create policy alertdest_sel on public.alerta_destinatario for select
  using (
    usuario_id = auth.uid()
    or public.pode_ler_clinico((select a.idoso_id from public.alerta a where a.id = alerta_id))
  );

-- 4. Arquivos: exames e diretivas no Storage seguem a mesma regra ---------------------------

drop policy if exists exames_sel on storage.objects;
drop policy if exists exames_ins on storage.objects;
drop policy if exists exames_upd on storage.objects;

create policy exames_sel on storage.objects for select to authenticated
  using (bucket_id = 'exames' and public.pode_ler_clinico(((storage.foldername(name))[1])::uuid));

create policy exames_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'exames' and public.pode_ler_clinico(((storage.foldername(name))[1])::uuid));

create policy exames_upd on storage.objects for update to authenticated
  using (bucket_id = 'exames' and public.pode_ler_clinico(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'exames' and public.pode_ler_clinico(((storage.foldername(name))[1])::uuid));

drop policy if exists diretivas_sel on storage.objects;
create policy diretivas_sel on storage.objects for select to authenticated
  using (bucket_id = 'diretivas' and public.pode_ler_clinico(((storage.foldername(name))[1])::uuid));

-- 5. Rastreabilidade: quem e quando alterou, nas tabelas que ainda podem ser alteradas -----

alter table public.analito
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists editado_por uuid;

alter table public.conversa
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists editado_por uuid;

drop trigger if exists trg_touch on public.analito;
create trigger trg_touch before update on public.analito
  for each row execute function public.touch_updated();

drop trigger if exists trg_touch on public.conversa;
create trigger trg_touch before update on public.conversa
  for each row execute function public.touch_updated();

-- 6. Teste das regras, dentro da própria migração ----------------------------------------
--
-- Cria um idoso e três pessoas (familiar, cuidador e alguém de fora), simula cada uma
-- chamando como usuário logado e confere o que o banco devolve. Tudo é desfeito no fim,
-- então não sobra dado. Se alguma conferência falhar, a migração inteira é recusada.

do $$
declare
  fam uuid := gen_random_uuid();
  cui uuid := gen_random_uuid();
  fora uuid := gen_random_uuid();
  ido uuid;
  r text;
  esperado text;
begin
  begin
    insert into auth.users (id, email) values
      (fam, 'teste-fam-' || fam || '@exemplo.invalid'),
      (cui, 'teste-cui-' || cui || '@exemplo.invalid'),
      (fora, 'teste-fora-' || fora || '@exemplo.invalid');

    insert into public.idoso (nome) values ('Teste de papeis') returning id into ido;
    insert into public.vinculo (usuario_id, idoso_id, papel) values
      (fam, ido, 'familiar'),
      (cui, ido, 'cuidador');

    insert into public.exame (idoso_id, tipo, confirmado_por) values (ido, 'teste', fam);

    declare
      a_clin uuid;
      a_oper uuid;
    begin
      insert into public.alerta (idoso_id, tipo, severidade, natureza, titulo)
        values (ido, 'teste', 'info', 'clinico', 'alerta clinico') returning id into a_clin;
      insert into public.alerta (idoso_id, tipo, severidade, natureza, titulo)
        values (ido, 'teste', 'info', 'operacional', 'alerta operacional') returning id into a_oper;
      insert into public.alerta_destinatario (alerta_id, usuario_id, texto) values
        (a_clin, fam, 'texto clinico do familiar'),
        (a_oper, cui, 'texto operacional da cuidadora'),
        (a_oper, fam, 'texto operacional do familiar');
    end;

    -- Cada linha: papel | exames | alertas visiveis | destinatarios visiveis | idoso visivel
    declare
      resultado text := '';
      quem uuid;
      rotulo text;
      n_exame int; n_alerta int; n_dest int; n_idoso int;
    begin
      for quem, rotulo in select fam, 'familiar' union all select cui, 'cuidador' union all select fora, 'fora' loop
        perform set_config('request.jwt.claims', json_build_object('sub', quem, 'role', 'authenticated')::text, true);
        perform set_config('request.jwt.claim.sub', quem::text, true);
        set local role authenticated;
        select count(*) into n_exame from public.exame where idoso_id = ido;
        select count(*) into n_alerta from public.alerta where idoso_id = ido;
        select count(*) into n_dest from public.alerta_destinatario d
          where d.alerta_id in (select id from public.alerta where idoso_id = ido);
        select count(*) into n_idoso from public.idoso where id = ido;
        reset role;
        resultado := resultado || rotulo || '=' || n_exame || ',' || n_alerta || ',' || n_dest || ',' || n_idoso || ';';
      end loop;
      -- familiar: ve tudo (1 exame, 2 alertas, 3 destinatarios, o idoso)
      -- cuidador: nenhum exame, so o alerta operacional, so o proprio texto, o idoso
      -- fora: nada
      esperado := 'familiar=1,2,3,1;cuidador=0,1,1,1;fora=0,0,0,0;';
      raise exception 'RESULTADO_TESTE|%|%', resultado, esperado;
    end;
  exception when others then
    if sqlerrm like 'RESULTADO_TESTE|%' then
      r := sqlerrm;
    else
      raise;
    end if;
  end;

  if split_part(r, '|', 2) <> split_part(r, '|', 3) then
    raise exception 'Teste de leitura por papel FALHOU. Obtido: %  Esperado: %',
      split_part(r, '|', 2), split_part(r, '|', 3);
  end if;
  raise notice 'Teste de leitura por papel OK: %', split_part(r, '|', 2);
end $$;
