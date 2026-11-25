-- O administrador corrige, em vez de só aceitar ou negar.
--
-- Valores de exame: a correção grava uma versão nova do exame e esconde a anterior, que fica
-- no histórico (dá para saber o que foi conferido e o que foi mudado). Quem cuida é avisado
-- do que mudou. Pedido de exame: nomes e preparo podem ser corrigidos, e a tarefa do dia
-- acompanha. Remédios já são corrigidos pela edição normal, que avisa quem cuida.

create or replace function public.corrigir_exame(p_exame uuid, p_dados jsonb, p_resultados jsonb, p_mudancas text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_velho exame;
  v_novo uuid;
  v_data timestamptz := nullif(p_dados ->> 'data', '')::timestamptz;
  v_tipo text := nullif(btrim(p_dados ->> 'tipo'), '');
  v_n int := coalesce(jsonb_array_length(p_resultados), 0);
  l leitura_papel;
begin
  select * into v_velho from exame where id = p_exame and deleted_at is null for update;
  if v_velho.id is null or not public.is_admin(v_velho.idoso_id) then
    raise exception 'Só o administrador corrige um exame.';
  end if;
  if v_data is null then
    raise exception 'Falta o dia da coleta.';
  end if;
  if v_n < 1 or v_n > 200 then
    raise exception 'O exame precisa ter de 1 a 200 resultados.';
  end if;

  -- Os avisos de "fora da faixa" da versão anterior saem antes: os da nova são gerados já.
  update alerta_destinatario d set lido_em = now()
    from alerta a
   where a.id = d.alerta_id and a.idoso_id = v_velho.idoso_id and d.lido_em is null
     and a.chave in (select 'exame_fora:' || r.id from exame_resultado r where r.exame_id = v_velho.id);
  update exame set deleted_at = now() where id = v_velho.id;

  v_novo := public.confirmar_exame(
    v_velho.idoso_id, v_tipo, nullif(btrim(p_dados ->> 'laboratorio'), ''), v_data, v_velho.arquivo_url, p_resultados);

  -- Se esta correção veio de uma revisão aberta, ela passa a apontar para a versão nova
  -- e se encerra.
  for l in
    select * from leitura_papel
     where idoso_id = v_velho.idoso_id and itens @> jsonb_build_array(jsonb_build_object('exame_id', v_velho.id))
  loop
    update leitura_papel
       set itens = (select jsonb_agg(case when it ->> 'exame_id' = v_velho.id::text then it || jsonb_build_object('exame_id', v_novo) else it end)
                      from jsonb_array_elements(l.itens) it),
           status = case when status = 'pendente' then 'aceita' else status end,
           decidido_por = case when status = 'pendente' then auth.uid() else decidido_por end,
           decidido_em = case when status = 'pendente' then now() else decidido_em end
     where id = l.id;
    update alerta_destinatario d set lido_em = now()
      from alerta a
     where a.id = d.alerta_id and a.idoso_id = l.idoso_id and d.lido_em is null and a.chave = 'leitura:' || l.id;
  end loop;

  if nullif(btrim(p_mudancas), '') is not null then
    perform public.emitir_alerta(
      p_idoso := v_velho.idoso_id,
      p_tipo := 'valores_corrigidos',
      p_severidade := 'info',
      p_natureza := 'operacional',
      p_titulo := 'Valores corrigidos: ' || coalesce(v_tipo, v_velho.tipo, 'exame'),
      p_ref_tipo := 'exame',
      p_ref_id := v_novo,
      p_chave := 'valores_corrigidos:' || v_novo,
      p_texto_cuidador := 'A família corrigiu: ' || left(p_mudancas, 600),
      p_excluir := auth.uid()
    );
  end if;
  return v_novo;
end $$;
revoke all on function public.corrigir_exame(uuid, jsonb, jsonb, text) from public, anon;
grant execute on function public.corrigir_exame(uuid, jsonb, jsonb, text) to authenticated;

create or replace function public.corrigir_pedido_exame(p_pedido uuid, p_exames text[], p_preparo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  p pedido_exame;
  v_exames text[];
  v_preparo text := nullif(btrim(p_preparo), '');
  v_nomes text;
begin
  p := public.pedido_exame_da_rede(p_pedido);
  if not public.is_admin(p.idoso_id) then
    raise exception 'Só o administrador corrige um pedido.';
  end if;
  select array_agg(left(btrim(x), 160)) into v_exames from unnest(coalesce(p_exames, '{}')) x where btrim(x) <> '';
  if v_exames is null then
    raise exception 'Diga ao menos um exame.';
  end if;
  if v_exames = p.exames and v_preparo is not distinct from p.preparo then
    return;
  end if;
  v_nomes := array_to_string(v_exames, ', ');
  update pedido_exame set exames = v_exames, preparo = v_preparo where id = p.id;
  if p.tarefa_id is not null then
    update tarefa
       set titulo = left('Exame: ' || v_nomes, 120),
           instrucao = left(
             coalesce(p.hora || '. ', '') || coalesce(p.laboratorio || '. ', '')
             || 'Levar o pedido, a carteirinha do plano e o RG. '
             || coalesce('Preparo: ' || v_preparo, 'Confirme o preparo com o laboratório.'), 300)
     where id = p.tarefa_id and deleted_at is null;
  end if;
  perform public.emitir_alerta(
    p_idoso := p.idoso_id,
    p_tipo := 'pedido_exame_corrigido',
    p_severidade := 'atencao',
    p_natureza := 'operacional',
    p_titulo := 'Pedido de exame corrigido',
    p_ref_tipo := 'pedido_exame',
    p_ref_id := p.id,
    p_chave := 'pedido_corrigido:' || p.id || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'),
    p_texto_cuidador := 'A família corrigiu o pedido: ' || v_nomes || '. '
      || coalesce('Preparo: ' || v_preparo, 'Confirme o preparo com o laboratório.'),
    p_excluir := auth.uid()
  );
end $$;
revoke all on function public.corrigir_pedido_exame(uuid, text[], text) from public, anon;
grant execute on function public.corrigir_pedido_exame(uuid, text[], text) to authenticated;

-- Teste (desfeito no fim; se falhar, a migração é recusada) -------------------------
do $$
declare
  adm uuid := gen_random_uuid();
  cui uuid := gen_random_uuid();
  ido uuid;
  laudo uuid;
  doc uuid;
  ped uuid;
  lei uuid;
  lei2 uuid;
  exa uuid;
  novo uuid;
  tar uuid;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  res text := '';
  r text;
  v text;
  n int;
begin
  begin
    insert into auth.users (id, email) values
      (adm, 'teste-adm-' || adm || '@exemplo.invalid'), (cui, 'teste-cui-' || cui || '@exemplo.invalid');
    insert into public.idoso (nome) values ('Teste de correcao') returning id into ido;
    insert into public.vinculo (usuario_id, idoso_id, papel, admin) values
      (adm, ido, 'familiar', true), (cui, ido, 'cuidador', false);

    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    insert into public.documento (idoso_id, nome, arquivo_url, autor_id, envio)
      values (ido, 'laudo', ido || '/laudo', cui, 'resultado_exame') returning id into laudo;
    ped := public.registrar_resultado_avulso(laudo);
    exa := public.confirmar_valores(ped,
      jsonb_build_object('tipo', 'Glicose', 'data', '2026-11-20T12:00:00-03:00', 'arquivo', ido || '/x.pdf'),
      jsonb_build_array(jsonb_build_object('nome', 'Glicose', 'valor', 130, 'unidade', 'mg/dL', 'ref_max', 99)));
    select id into lei from public.leitura_papel where idoso_id = ido;

    -- A. quem cuida nao corrige
    begin
      perform public.corrigir_exame(exa, jsonb_build_object('data', '2026-11-20T12:00:00-03:00'), '[]'::jsonb);
      res := res || 'cuidadora_corrige=permitido;';
    exception when others then res := res || 'cuidadora_corrige=bloqueado;';
    end;

    -- B. admin corrige: versao nova, anterior escondida, revisao encerrada, aviso a quem cuida
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    novo := public.corrigir_exame(exa,
      jsonb_build_object('tipo', 'Glicose', 'data', '2026-11-20T12:00:00-03:00'),
      jsonb_build_array(jsonb_build_object('analito_id', (select analito_id from public.exame_resultado where exame_id = exa),
        'nome', 'Glicose', 'valor', 98, 'unidade', 'mg/dL', 'ref_max', 99, 'corrigido_manualmente', true)),
      'Glicose: 130 → 98 mg/dL');
    set local role postgres;
    select (deleted_at is not null)::text into v from public.exame where id = exa;
    res := res || 'anterior_escondido=' || v || ';';
    select valor || ' ' || corrigido_manualmente into v from public.exame_resultado where exame_id = novo;
    res := res || 'novo=' || v || ';';
    select status || ' ' || (itens -> 0 ->> 'exame_id' = novo::text) into v from public.leitura_papel where id = lei;
    res := res || 'revisao=' || v || ';';
    select count(*) into n from public.alerta_destinatario d join public.alerta a on a.id = d.alerta_id
     where a.idoso_id = ido and a.tipo = 'exame_fora_da_faixa' and d.lido_em is null;
    res := res || 'fora_abertos=' || n || ';';
    select count(*) into n from public.alerta_destinatario d join public.alerta a on a.id = d.alerta_id
     where a.idoso_id = ido and a.tipo = 'valores_corrigidos' and d.usuario_id = cui and d.texto like '%130 → 98%';
    res := res || 'aviso_a_quem_cuida=' || n || ';';
    select status into v from public.pedido_exame where id = ped;
    res := res || 'exame=' || v || ';';

    -- C. corrigir pedido acompanha a tarefa do dia
    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    insert into public.documento (idoso_id, nome, arquivo_url, autor_id, envio)
      values (ido, 'pedido', ido || '/p', cui, 'pedido_exame') returning id into doc;
    lei2 := public.confirmar_leitura(doc, jsonb_build_object('exames',
      jsonb_build_object('resposta', 'igual', 'nomes', jsonb_build_array('Eco'))));
    select id into ped from public.pedido_exame where leitura_id = lei2;
    perform public.marcar_exame(ped, hoje + 5);
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    perform public.corrigir_pedido_exame(ped, array['Ecocardiograma'], 'Jejum de 4 horas');
    set local role postgres;
    select t.titulo || ' ' || (t.instrucao like '%Jejum de 4 horas%') into v
      from public.tarefa t join public.pedido_exame p on p.tarefa_id = t.id where p.id = ped;
    res := res || 'tarefa=' || v || ';';

    raise exception 'RESULTADO_TESTE|%|%', res,
      'cuidadora_corrige=bloqueado;anterior_escondido=true;novo=98 true;revisao=aceita true;fora_abertos=0;'
      'aviso_a_quem_cuida=1;exame=concluido;tarefa=Exame: Ecocardiograma true;';
  exception when others then
    if sqlerrm like 'RESULTADO_TESTE|%' then r := sqlerrm; else raise; end if;
  end;
  if split_part(r, '|', 2) is distinct from split_part(r, '|', 3) then
    raise exception E'Teste da correção FALHOU.\nObtido:   %\nEsperado: %', split_part(r, '|', 2), split_part(r, '|', 3);
  end if;
end $$;
