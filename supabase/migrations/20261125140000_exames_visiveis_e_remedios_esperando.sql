-- Ajustes pedidos depois de ver o desenho:
--  1. Quem cuida VÊ os exames, os valores e os laudos (continua sem poder alterar o que a
--     família confirmou pela tela dela; tendências, observações, visão 360 e diretivas
--     seguem como estavam).
--  2. Sai o lembrete com prazo de "falta marcar": a situação fica destacada na tela.
--  3. Remédio que não entra sozinho não some: fica "esperando a família" na lista de quem
--     cuida, que pode pedir a aprovação com um aviso urgente.

-- 1. Exames visíveis para toda a rede ------------------------------------------

drop policy if exists exame_sel on public.exame;
create policy exame_sel on public.exame for select using (public.is_member(idoso_id));

drop policy if exists analito_sel on public.analito;
create policy analito_sel on public.analito for select using (public.is_member(idoso_id));

drop policy if exists exres_sel on public.exame_resultado;
create policy exres_sel on public.exame_resultado for select
  using (public.is_member((select e.idoso_id from public.exame e where e.id = exame_id)));

drop policy if exists exames_sel on storage.objects;
create policy exames_sel on storage.objects for select to authenticated
  using (bucket_id = 'exames' and public.is_member(((storage.foldername(name))[1])::uuid));

-- O resultado de um pedido aparece para a rede, tenha sido enviado por quem for.
drop policy if exists documento_sel on public.documento;
create policy documento_sel on public.documento for select
  using (
    public.is_member(idoso_id)
    and (
      public.papel_em(idoso_id) <> 'cuidador'
      or levar_consulta
      or autor_id = auth.uid()
      or exists (select 1 from public.pedido_exame p where p.resultado_documento_id = documento.id)
    )
  );

-- 2. Sem prazo: sobra só o lembrete da véspera ----------------------------------

create or replace function public.gerar_alertas_exames(p_idoso uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  p pedido_exame;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_texto text;
begin
  if not public.is_member(p_idoso) then
    return;
  end if;

  for p in select * from pedido_exame
            where idoso_id = p_idoso and status = 'marcado' and dia = v_hoje + 1
  loop
    v_texto := 'Amanhã' || coalesce(' às ' || p.hora, '') || ' tem exame: ' || array_to_string(p.exames, ', ')
      || coalesce(' (' || p.laboratorio || ')', '') || '. '
      || coalesce('Preparo: ' || p.preparo, 'Confirme o preparo com o laboratório.')
      || ' Levar o pedido, a carteirinha do plano e o RG.';
    perform public.emitir_alerta(
      p_idoso := p_idoso,
      p_tipo := 'exame_vespera',
      p_severidade := 'atencao',
      p_natureza := 'operacional',
      p_titulo := 'Amanhã tem exame',
      p_ref_tipo := 'pedido_exame',
      p_ref_id := p.id,
      p_chave := 'exame_vespera:' || p.id || ':' || p.dia,
      p_texto_familiar := v_texto,
      p_texto_cuidador := v_texto,
      p_familiar_so_admin := true
    );
  end loop;
end $$;

-- 3. Remédios esperando a família -----------------------------------------------

create table if not exists public.remedio_pendente (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  leitura_id uuid not null references public.leitura_papel (id) on delete cascade,
  documento_id uuid not null references public.documento (id),
  nome text not null,
  texto text,
  motivo text not null,
  -- 'parar' = o papel manda parar; nao e um remedio a cadastrar
  tipo text not null check (tipo in ('duvida', 'nao_confere', 'parar')),
  status text not null default 'esperando' check (status in ('esperando', 'cadastrado', 'descartado')),
  enviado_por uuid references public.usuario (id),
  pedido_em timestamptz,
  resolvido_por uuid references public.usuario (id),
  resolvido_em timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists remedio_pendente_idx on public.remedio_pendente (idoso_id) where status = 'esperando';

alter table public.remedio_pendente enable row level security;
revoke all on public.remedio_pendente from anon, authenticated;
grant select on public.remedio_pendente to authenticated;
drop policy if exists remedio_pendente_sel on public.remedio_pendente;
create policy remedio_pendente_sel on public.remedio_pendente for select using (public.is_member(idoso_id));

-- Nasce junto com a conferência. Se quem confere é o administrador, ele já está vendo.
create or replace function public.trg_remedios_pendentes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  it jsonb;
begin
  if new.status <> 'pendente' or old.itens = new.itens then
    return new;
  end if;
  for it in select * from jsonb_array_elements(new.itens) loop
    if it ->> 'tipo' = 'remedio' and it ->> 'resultado' in ('duvida', 'nao_entrou', 'parar') then
      insert into remedio_pendente (idoso_id, leitura_id, documento_id, nome, texto, motivo, tipo, enviado_por)
      values (
        new.idoso_id, new.id, new.documento_id, coalesce(nullif(it ->> 'nome', ''), 'Remédio'), it ->> 'texto',
        case it ->> 'resultado'
          when 'duvida' then coalesce(it ->> 'motivo', 'ficou em dúvida')
          when 'parar' then 'o papel parece mandar parar'
          else 'quem conferiu disse que não está igual ao papel'
        end,
        case it ->> 'resultado' when 'duvida' then 'duvida' when 'parar' then 'parar' else 'nao_confere' end,
        new.enviado_por);
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists trg_remedios_pendentes on public.leitura_papel;
create trigger trg_remedios_pendentes
  after update on public.leitura_papel
  for each row execute function public.trg_remedios_pendentes();

-- "Pedir para a família aprovar": aviso urgente, no máximo um por hora para cada item.
create or replace function public.pedir_aprovacao_remedio(p_pendente uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  p remedio_pendente;
  v_quem text;
begin
  select * into p from remedio_pendente where id = p_pendente for update;
  if p.id is null or auth.uid() is null or not public.is_member(p.idoso_id) then
    raise exception 'Sem acesso a este item.';
  end if;
  if p.status <> 'esperando' then
    raise exception 'Este item já foi resolvido.';
  end if;
  if p.pedido_em is not null and p.pedido_em > clock_timestamp() - interval '1 hour' then
    raise exception 'O aviso já foi enviado há pouco.';
  end if;
  update remedio_pendente set pedido_em = clock_timestamp() where id = p.id;

  select coalesce(nullif(u.nome, ''), 'Quem cuida') into v_quem from usuario u where u.id = auth.uid();
  perform public.emitir_alerta(
    p_idoso := p.idoso_id,
    p_tipo := 'remedio_pede_aprovacao',
    p_severidade := 'urgente',
    p_natureza := 'operacional',
    p_titulo := 'Esperando você: ' || p.nome,
    p_ref_tipo := 'remedio_pendente',
    p_ref_id := p.id,
    p_chave := 'remedio_pede:' || p.id || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'),
    p_texto_familiar := coalesce(v_quem, 'Quem cuida') || ' está pedindo sua resposta sobre ' || p.nome
      || ', que não entrou na lista porque ' || p.motivo || '. Veja a foto em Medicação.',
    p_familiar_so_admin := true,
    p_excluir := auth.uid()
  );
end $$;
revoke all on function public.pedir_aprovacao_remedio(uuid) from public, anon;
grant execute on function public.pedir_aprovacao_remedio(uuid) to authenticated;

-- O administrador resolve: cadastrou (pela tela de Medicação) ou decidiu não cadastrar.
create or replace function public.resolver_remedio_pendente(p_pendente uuid, p_cadastrado boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  p remedio_pendente;
  v_texto text;
begin
  select * into p from remedio_pendente where id = p_pendente for update;
  if p.id is null or not public.is_admin(p.idoso_id) then
    raise exception 'Só o administrador resolve este item.';
  end if;
  if p.status <> 'esperando' then
    raise exception 'Este item já foi resolvido.';
  end if;
  update remedio_pendente
     set status = case when p_cadastrado then 'cadastrado' else 'descartado' end,
         resolvido_por = auth.uid(), resolvido_em = now()
   where id = p.id;

  update alerta_destinatario d set lido_em = now()
    from alerta a
   where a.id = d.alerta_id and a.idoso_id = p.idoso_id and d.lido_em is null
     and a.chave like 'remedio_pede:' || p.id || ':%';

  v_texto := case
    when p_cadastrado then 'A família resolveu ' || p.nome || '. Confira a lista de remédios antes da próxima dose.'
    else 'A família decidiu não colocar na lista: ' || p.nome || '.'
  end;
  perform public.emitir_alerta(
    p_idoso := p.idoso_id,
    p_tipo := 'remedio_pendente_resolvido',
    p_severidade := 'atencao',
    p_natureza := 'operacional',
    p_titulo := 'Resposta da família: ' || p.nome,
    p_ref_tipo := 'remedio_pendente',
    p_ref_id := p.id,
    p_chave := 'remedio_resolvido:' || p.id,
    p_texto_cuidador := v_texto,
    p_excluir := auth.uid()
  );
end $$;
revoke all on function public.resolver_remedio_pendente(uuid, boolean) from public, anon;
grant execute on function public.resolver_remedio_pendente(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Teste (desfeito no fim; se falhar, a migração é recusada)
-- ---------------------------------------------------------------------------
do $$
declare
  adm uuid := gen_random_uuid();
  cui uuid := gen_random_uuid();
  fora uuid := gen_random_uuid();
  ido uuid;
  doc uuid;
  lei uuid;
  pend uuid;
  ped uuid;
  res text := '';
  r text;
  v text;
  n int;
begin
  begin
    insert into auth.users (id, email) values
      (adm, 'teste-adm-' || adm || '@exemplo.invalid'), (cui, 'teste-cui-' || cui || '@exemplo.invalid'),
      (fora, 'teste-fora-' || fora || '@exemplo.invalid');
    insert into public.idoso (nome) values ('Teste de ajustes') returning id into ido;
    insert into public.vinculo (usuario_id, idoso_id, papel, admin) values
      (adm, ido, 'familiar', true), (cui, ido, 'cuidador', false);
    insert into public.exame (idoso_id, tipo, confirmado_por) values (ido, 'Hemograma', adm);

    -- A. quem cuida le o exame; quem e de fora, nao
    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    select count(*) into n from public.exame where idoso_id = ido;
    res := res || 'cuidadora_le_exame=' || n || ';';
    perform set_config('request.jwt.claims', json_build_object('sub', fora, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', fora::text, true);
    set local role authenticated;
    select count(*) into n from public.exame where idoso_id = ido;
    res := res || 'de_fora=' || n || ';';

    -- B. o que nao entra fica esperando, e o pedido de aprovacao e urgente e so para o admin
    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    insert into public.documento (idoso_id, nome, arquivo_url, autor_id, envio)
      values (ido, 'receita', ido || '/r', cui, 'receita') returning id into doc;
    lei := public.confirmar_leitura(doc, jsonb_build_object(
      'remedios', jsonb_build_array(jsonb_build_object('acao', 'duvida', 'nome', 'Semanal', 'motivo', 'não sei os dias')),
      'exames', jsonb_build_object('resposta', 'igual', 'nomes', jsonb_build_array('TSH'))));
    select count(*) into n from public.remedio_pendente where idoso_id = ido and status = 'esperando';
    select id into pend from public.remedio_pendente where idoso_id = ido;
    res := res || 'esperando=' || n || ';';
    perform public.pedir_aprovacao_remedio(pend);
    begin
      perform public.pedir_aprovacao_remedio(pend);
      res := res || 'repetir_na_hora=permitido;';
    exception when others then res := res || 'repetir_na_hora=bloqueado;';
    end;
    set local role authenticated;
    begin
      perform public.resolver_remedio_pendente(pend, false);
      res := res || 'cuidadora_resolve=permitido;';
    exception when others then res := res || 'cuidadora_resolve=bloqueado;';
    end;
    set local role postgres;
    select string_agg(a.severidade || ':' || case d.usuario_id when adm then 'admin' else 'cuidadora' end, ',') into v
      from public.alerta a join public.alerta_destinatario d on d.alerta_id = a.id
     where a.idoso_id = ido and a.tipo = 'remedio_pede_aprovacao';
    res := res || 'aviso=' || coalesce(v, 'nenhum') || ';';

    -- C. continua esperando mesmo depois de o admin aceitar a foto; so ele resolve
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    perform public.decidir_leitura(lei, true);
    select status into v from public.remedio_pendente where id = pend;
    res := res || 'apos_aceitar_foto=' || v || ';';
    perform public.resolver_remedio_pendente(pend, true);
    select status into v from public.remedio_pendente where id = pend;
    res := res || 'resolvido=' || v || ';';

    -- D. nao ha mais lembrete com prazo para marcar exame
    set local role postgres;
    select id into ped from public.pedido_exame where leitura_id = lei;
    update public.pedido_exame set falta_desde = now() - interval '30 days' where id = ped;
    set local role authenticated;
    perform public.gerar_alertas_exames(ido);
    set local role postgres;
    select count(*) into n from public.alerta where idoso_id = ido and tipo = 'exame_falta_marcar';
    res := res || 'lembrete_com_prazo=' || n || ';';

    raise exception 'RESULTADO_TESTE|%|%', res,
      'cuidadora_le_exame=1;de_fora=0;esperando=1;repetir_na_hora=bloqueado;cuidadora_resolve=bloqueado;'
      'aviso=urgente:admin;apos_aceitar_foto=esperando;resolvido=cadastrado;lembrete_com_prazo=0;';
  exception when others then
    if sqlerrm like 'RESULTADO_TESTE|%' then r := sqlerrm; else raise; end if;
  end;
  if split_part(r, '|', 2) is distinct from split_part(r, '|', 3) then
    raise exception E'Teste dos ajustes FALHOU.\nObtido:   %\nEsperado: %', split_part(r, '|', 2), split_part(r, '|', 3);
  end if;
end $$;
