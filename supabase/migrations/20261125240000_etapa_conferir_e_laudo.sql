-- Um exame só está completo com os valores conferidos. A exceção é o laudo escrito
-- (ultrassom, raio-X), que não tem números: a família diz que é um laudo.
--
-- Se os valores saírem depois (removidos na tela de Exames), o exame volta a esperar a
-- conferência.

alter table public.pedido_exame add column if not exists laudo boolean not null default false;

-- Trocou ou tirou o arquivo do resultado: o que se disse sobre o anterior não vale.
create or replace function public.trg_resultado_trocado()
returns trigger language plpgsql as $$
begin
  if new.resultado_documento_id is distinct from old.resultado_documento_id then
    new.laudo := false;
  end if;
  return new;
end $$;

drop trigger if exists trg_resultado_trocado on public.pedido_exame;
create trigger trg_resultado_trocado
  before update on public.pedido_exame
  for each row execute function public.trg_resultado_trocado();

create or replace function public.marcar_laudo(p_pedido uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  p pedido_exame;
begin
  p := public.pedido_exame_da_rede(p_pedido);
  if not (public.is_admin(p.idoso_id) or public.papel_em(p.idoso_id) = 'familiar') then
    raise exception 'Só a família diz que o resultado é um laudo.';
  end if;
  if p.status <> 'resultado_enviado' then
    raise exception 'Não há resultado esperando conferência.';
  end if;
  update pedido_exame set status = 'concluido', laudo = true where id = p.id;
end $$;
revoke all on function public.marcar_laudo(uuid) from public, anon;
grant execute on function public.marcar_laudo(uuid) to authenticated;

-- Confere no fim da transação: numa correção, o exame antigo sai e o novo entra com o
-- mesmo arquivo, e aí nada deve mudar.
create or replace function public.trg_valores_removidos()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.deleted_at is not null or new.deleted_at is null or new.arquivo_url is null then
    return null;
  end if;
  if exists (select 1 from exame e
              where e.idoso_id = new.idoso_id and e.arquivo_url = new.arquivo_url and e.deleted_at is null) then
    return null;
  end if;

  -- A conferência desses valores deixa de contar; sem isso o arquivo não poderia ser
  -- conferido de novo.
  update leitura_papel l
     set status = 'negada', decidido_por = coalesce(l.decidido_por, auth.uid()),
         decidido_em = coalesce(l.decidido_em, now())
   where l.idoso_id = new.idoso_id and l.status <> 'negada'
     and l.itens @> jsonb_build_array(jsonb_build_object('tipo', 'valores', 'exame_id', new.id));

  update pedido_exame
     set status = 'resultado_enviado', exame_arquivo = null
   where idoso_id = new.idoso_id and exame_arquivo = new.arquivo_url
     and status = 'concluido' and resultado_documento_id is not null;
  return null;
end $$;

drop trigger if exists trg_valores_removidos on public.exame;
create constraint trigger trg_valores_removidos
  after update on public.exame
  deferrable initially deferred
  for each row execute function public.trg_valores_removidos();

-- Teste (desfeito no fim; se falhar, a migração é recusada) -------------------------
do $$
declare
  adm uuid := gen_random_uuid();
  cui uuid := gen_random_uuid();
  ido uuid;
  d1 uuid;
  d2 uuid;
  p1 uuid;
  p2 uuid;
  exa uuid;
  novo uuid;
  res text := '';
  r text;
  v text;
  valores jsonb := jsonb_build_array(jsonb_build_object('nome', 'Glicose', 'valor', 90, 'unidade', 'mg/dL'));
begin
  begin
    insert into auth.users (id, email) values
      (adm, 'teste-adm-' || adm || '@exemplo.invalid'), (cui, 'teste-cui-' || cui || '@exemplo.invalid');
    insert into public.idoso (nome) values ('Teste de laudo') returning id into ido;
    insert into public.vinculo (usuario_id, idoso_id, papel, admin) values
      (adm, ido, 'familiar', true), (cui, ido, 'cuidador', false);

    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    insert into public.documento (idoso_id, nome, arquivo_url, autor_id, envio)
      values (ido, 'laudo', ido || '/laudo', cui, 'resultado_exame') returning id into d1;
    p1 := public.registrar_resultado_avulso(d1);
    insert into public.documento (idoso_id, nome, arquivo_url, autor_id, envio)
      values (ido, 'sangue', ido || '/sangue', cui, 'resultado_exame') returning id into d2;
    p2 := public.registrar_resultado_avulso(d2);

    -- A. quem cuida nao diz que e laudo
    begin
      perform public.marcar_laudo(p1);
      res := res || 'cuidadora_laudo=permitido;';
    exception when others then res := res || 'cuidadora_laudo=bloqueado;';
    end;

    -- B. a familia diz: concluido como laudo
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    perform public.marcar_laudo(p1);
    select status || ' ' || laudo into v from public.pedido_exame where id = p1;
    res := res || 'laudo=' || v || ';';

    -- C. corrigir os valores nao reabre o exame
    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    exa := public.confirmar_valores(p2, jsonb_build_object('data', '2026-11-20T12:00:00-03:00', 'arquivo', ido || '/x.pdf'), valores);
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    novo := public.corrigir_exame(exa, jsonb_build_object('data', '2026-11-20T12:00:00-03:00'),
      jsonb_build_array(jsonb_build_object('analito_id', (select analito_id from public.exame_resultado where exame_id = exa),
        'nome', 'Glicose', 'valor', 91, 'unidade', 'mg/dL')), null);
    set constraints public.trg_valores_removidos immediate;
    set constraints public.trg_valores_removidos deferred;
    select status into v from public.pedido_exame where id = p2;
    res := res || 'apos_corrigir=' || v || ';';

    -- D. remover os valores reabre, e da para conferir de novo
    set local role authenticated;
    update public.exame set deleted_at = now() where id = novo;
    set constraints public.trg_valores_removidos immediate;
    set constraints public.trg_valores_removidos deferred;
    select status || ' ' || (exame_arquivo is null) into v from public.pedido_exame where id = p2;
    res := res || 'apos_remover=' || v || ';';
    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    perform public.confirmar_valores(p2, jsonb_build_object('data', '2026-11-20T12:00:00-03:00', 'arquivo', ido || '/y.pdf'), valores);
    select status into v from public.pedido_exame where id = p2;
    res := res || 'de_novo=' || v || ';';

    raise exception 'RESULTADO_TESTE|%|%', res,
      'cuidadora_laudo=bloqueado;laudo=concluido true;apos_corrigir=concluido;apos_remover=resultado_enviado true;de_novo=concluido;';
  exception when others then
    if sqlerrm like 'RESULTADO_TESTE|%' then r := sqlerrm; else raise; end if;
  end;
  if split_part(r, '|', 2) is distinct from split_part(r, '|', 3) then
    raise exception E'Teste do laudo FALHOU.\nObtido:   %\nEsperado: %', split_part(r, '|', 2), split_part(r, '|', 3);
  end if;
end $$;
