-- Volta o lembrete de "falta marcar", agora depois de UMA SEMANA (decisão revista).
-- Conta dias de calendário desde que o pedido passou a faltar marcar (recomeça num "não
-- consegui"). Vai só para o administrador, uma vez por período, e fecha quando o pedido
-- anda (gatilho trg_pedido_exame_mudou).

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
            where idoso_id = p_idoso and status = 'falta_marcar'
              and v_hoje - (falta_desde at time zone 'America/Sao_Paulo')::date >= 7
  loop
    perform public.emitir_alerta(
      p_idoso := p_idoso,
      p_tipo := 'exame_falta_marcar',
      p_severidade := 'atencao',
      p_natureza := 'operacional',
      p_titulo := 'Exame sem marcar há uma semana',
      p_ref_tipo := 'pedido_exame',
      p_ref_id := p.id,
      p_chave := 'exame_marcar:' || p.id || ':' || to_char(p.falta_desde, 'YYYYMMDDHH24MISS'),
      p_texto_familiar := 'O exame (' || array_to_string(p.exames, ', ') || ') está sem marcar desde '
        || to_char(p.falta_desde at time zone 'America/Sao_Paulo', 'DD/MM') || '.',
      p_familiar_so_admin := true
    );
  end loop;

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

-- Teste (desfeito no fim; se falhar, a migração é recusada) -------------------------
do $$
declare
  adm uuid := gen_random_uuid();
  cui uuid := gen_random_uuid();
  ido uuid;
  ped uuid;
  res text := '';
  r text;
  v text;
  n int;
begin
  begin
    insert into auth.users (id, email) values
      (adm, 'teste-adm-' || adm || '@exemplo.invalid'), (cui, 'teste-cui-' || cui || '@exemplo.invalid');
    insert into public.idoso (nome) values ('Teste de uma semana') returning id into ido;
    insert into public.vinculo (usuario_id, idoso_id, papel, admin) values
      (adm, ido, 'familiar', true), (cui, ido, 'cuidador', false);
    insert into public.pedido_exame (idoso_id, exames, falta_desde)
      values (ido, array['TSH'], now() - interval '6 days') returning id into ped;

    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    perform public.gerar_alertas_exames(ido);
    set local role postgres;
    select count(*) into n from public.alerta where idoso_id = ido and tipo = 'exame_falta_marcar';
    res := res || 'com_6_dias=' || n || ';';

    update public.pedido_exame set falta_desde = now() - interval '7 days' where id = ped;
    set local role authenticated;
    perform public.gerar_alertas_exames(ido);
    perform public.gerar_alertas_exames(ido);
    set local role postgres;
    select count(*) || ' ' || coalesce(string_agg(case d.usuario_id when adm then 'admin' else 'cuidadora' end, ','), '') into v
      from public.alerta a join public.alerta_destinatario d on d.alerta_id = a.id
     where a.idoso_id = ido and a.tipo = 'exame_falta_marcar';
    res := res || 'com_7_dias=' || v || ';';

    set local role authenticated;
    perform public.marcar_exame(ped);
    set local role postgres;
    select count(*) into n from public.alerta a join public.alerta_destinatario d on d.alerta_id = a.id
     where a.idoso_id = ido and a.tipo = 'exame_falta_marcar' and d.lido_em is null;
    res := res || 'aberto_depois_de_marcar=' || n || ';';

    raise exception 'RESULTADO_TESTE|%|%', res, 'com_6_dias=0;com_7_dias=1 admin;aberto_depois_de_marcar=0;';
  exception when others then
    if sqlerrm like 'RESULTADO_TESTE|%' then r := sqlerrm; else raise; end if;
  end;
  if split_part(r, '|', 2) is distinct from split_part(r, '|', 3) then
    raise exception E'Teste do lembrete de uma semana FALHOU.\nObtido:   %\nEsperado: %', split_part(r, '|', 2), split_part(r, '|', 3);
  end if;
end $$;
