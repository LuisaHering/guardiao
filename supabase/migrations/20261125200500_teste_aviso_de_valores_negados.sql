-- So teste (tudo e desfeito). O teste da migracao anterior procurava o aviso de "fora da
-- faixa" pelo nome errado e passaria de qualquer jeito; este confere que o aviso existe antes
-- de negar e deixa de pedir atencao depois.

-- Teste (desfeito no fim; se falhar, a migração é recusada) -------------------------
do $$
declare
  adm uuid := gen_random_uuid();
  cui uuid := gen_random_uuid();
  ido uuid;
  laudo uuid;
  ped uuid;
  lei uuid;
  exa uuid;
  pf uuid;
  res text := '';
  r text;
  v text;
  n int;
  valores jsonb := jsonb_build_array(jsonb_build_object('nome', 'Glicose', 'valor', 130, 'unidade', 'mg/dL', 'ref_max', 99));
begin
  begin
    insert into auth.users (id, email) values
      (adm, 'teste-adm-' || adm || '@exemplo.invalid'), (cui, 'teste-cui-' || cui || '@exemplo.invalid');
    insert into public.idoso (nome) values ('Teste de valores') returning id into ido;
    insert into public.vinculo (usuario_id, idoso_id, papel, admin) values
      (adm, ido, 'familiar', true), (cui, ido, 'cuidador', false);

    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    insert into public.documento (idoso_id, nome, arquivo_url, autor_id, envio)
      values (ido, 'laudo', ido || '/laudo', cui, 'resultado_exame') returning id into laudo;
    ped := public.registrar_resultado_avulso(laudo);
    pf := public.criar_pedido_familia(ido, 'conferir_exame', null, adm, false, ped);

    -- A. sem o dia da coleta nao guarda
    begin
      perform public.confirmar_valores(ped, jsonb_build_object('arquivo', ido || '/x.pdf'), valores);
      res := res || 'sem_data=permitido;';
    exception when others then res := res || 'sem_data=bloqueado;';
    end;

    -- B. conferido: vale na hora, conclui, fecha o pedido de conferir
    set local role authenticated;
    exa := public.confirmar_valores(ped, jsonb_build_object('tipo', 'Glicose', 'data', '2026-11-20T12:00:00-03:00', 'arquivo', ido || '/x.pdf'), valores);
    select count(*) into n from public.exame_resultado where exame_id = exa;
    select status into v from public.pedido_exame where id = ped;
    res := res || 'valores=' || n || ';exame=' || v || ';';
    select status into v from public.pedido_familia where id = pf;
    res := res || 'pedido_conferir=' || v || ';';
    select id into lei from public.leitura_papel where idoso_id = ido and status = 'pendente';
    res := res || 'popup=' || (lei is not null) || ';';

    set local role postgres;
    select count(*) into n from public.alerta_destinatario d join public.alerta a on a.id = d.alerta_id
     where a.idoso_id = ido and a.tipo = 'exame_fora_da_faixa' and d.lido_em is null;
    res := res || 'avisos_fora_antes=' || n || ';';

    -- C. admin nega: valores saem, exame volta para ler, e pode ser conferido de novo
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    perform public.decidir_leitura(lei, false);
    select count(*) into n from public.exame where idoso_id = ido and deleted_at is null;
    select status into v from public.pedido_exame where id = ped;
    res := res || 'apos_negar=' || n || ' ' || v || ';';
    set local role postgres;
    select count(*) into n from public.alerta_destinatario d join public.alerta a on a.id = d.alerta_id
     where a.idoso_id = ido and a.tipo = 'exame_fora_da_faixa' and d.lido_em is null;
    res := res || 'avisos_fora_abertos=' || n || ';';
    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    perform public.confirmar_valores(ped, jsonb_build_object('data', '2026-11-20T12:00:00-03:00', 'arquivo', ido || '/y.pdf'), valores);
    select status into v from public.pedido_exame where id = ped;
    res := res || 'conferir_de_novo=' || v || ';';

    raise exception 'RESULTADO_TESTE|%|%', res,
      'sem_data=bloqueado;valores=1;exame=concluido;pedido_conferir=feito;popup=true;avisos_fora_antes=1;'
      'apos_negar=0 resultado_enviado;avisos_fora_abertos=0;conferir_de_novo=concluido;';
  exception when others then
    if sqlerrm like 'RESULTADO_TESTE|%' then r := sqlerrm; else raise; end if;
  end;
  if split_part(r, '|', 2) is distinct from split_part(r, '|', 3) then
    raise exception E'Teste dos valores FALHOU.\nObtido:   %\nEsperado: %', split_part(r, '|', 2), split_part(r, '|', 3);
  end if;
end $$;
