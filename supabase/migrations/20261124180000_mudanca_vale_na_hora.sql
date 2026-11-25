-- Mudar a dose ou suspender também VALE NA HORA; o administrador revisa e pode negar.
--
-- Ao aplicar, o banco guarda como o remédio era (`antes`). Negar volta exatamente a esse estado.
--  * Só há uma revisão aberta por remédio: mudanças seguidas se somam, e `antes` continua
--    sendo o último estado que o administrador conhecia.
--  * Se o administrador editar o remédio com revisão aberta, a revisão se encerra: um
--    "negar" posterior não pode desfazer a edição dele.

alter table public.medicacao_pedido add column if not exists antes jsonb;

-- Revisões só nascem pela função (que guarda o estado anterior de verdade).
revoke insert on public.medicacao_pedido from authenticated;

-- ---------------------------------------------------------------------------
-- Guarda
-- ---------------------------------------------------------------------------
create or replace function public.medicacao_guarda()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean;
  -- só as funções abaixo definem este valor; o aplicativo não tem como defini-lo
  v_modo text := coalesce(current_setting('guardiao.modo', true), '');
begin
  if v_uid is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.idoso_id is distinct from old.idoso_id then
      raise exception 'Um remédio não muda de pessoa.';
    end if;
    if v_modo in ('revisao', 'negacao') then
      return new;
    end if;
  end if;

  v_admin := public.is_admin(new.idoso_id);

  if tg_op = 'INSERT' then
    new.autor_id := v_uid;
    new.recusado_em := null;
    if v_admin then
      new.confirmado := true;
      new.confirmado_por := v_uid;
      new.confirmado_em := now();
    else
      new.confirmado := false;
      new.confirmado_por := null;
      new.confirmado_em := null;
    end if;
    return new;
  end if;

  if v_admin then
    if new.confirmado and not old.confirmado then
      new.confirmado_por := v_uid;
      new.confirmado_em := now();
    end if;
    -- Edição ou negação direta do administrador encerra a revisão aberta deste remédio.
    if (new.nome, new.dosagem, new.instrucoes, new.frequencia, new.horarios, new.dias_semana,
        new.intervalo_dias, new.inicio, new.fim, new.ativo, new.deleted_at, new.recusado_em)
       is distinct from
       (old.nome, old.dosagem, old.instrucoes, old.frequencia, old.horarios, old.dias_semana,
        old.intervalo_dias, old.inicio, old.fim, old.ativo, old.deleted_at, old.recusado_em)
    then
      update medicacao_pedido
         set status = case when new.recusado_em is not null and old.recusado_em is null then 'recusado' else 'aprovado' end,
             decidido_por = v_uid,
             decidido_em = now()
       where medicacao_id = new.id and status = 'pendente';
      update alerta_destinatario d set lido_em = now()
        from alerta a
       where a.id = d.alerta_id and a.idoso_id = new.idoso_id and d.lido_em is null
         and a.tipo = 'medicacao_pedido' and a.referencia_id = new.id;
    end if;
    return new;
  end if;

  -- Não administrador, direto: só o PRÓPRIO remédio ainda não revisado. O resto passa
  -- por aplicar_mudanca_medicacao, que registra a revisão.
  if old.confirmado or old.autor_id is distinct from v_uid or old.recusado_em is not null then
    raise exception 'Esta mudança precisa passar pela revisão da família.';
  end if;
  if new.confirmado
     or new.confirmado_por is distinct from old.confirmado_por
     or new.recusado_em is distinct from old.recusado_em
     or new.autor_id is distinct from old.autor_id then
    raise exception 'Só o administrador aprova ou nega um remédio.';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Aplicar na hora e abrir a revisão
-- ---------------------------------------------------------------------------
create or replace function public.aplicar_mudanca_medicacao(
  p_med uuid,
  p_tipo text,
  p_dados jsonb default '{}'::jsonb,
  p_motivo text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  m medicacao;
  v_uid uuid := auth.uid();
  v_admin boolean;
  v_antes jsonb;
  d jsonb := coalesce(p_dados, '{}'::jsonb);
  v_aberta uuid;
begin
  select * into m from medicacao where id = p_med for update;
  if m.id is null or v_uid is null or not public.is_member(m.idoso_id) then
    raise exception 'Sem acesso a este remédio.';
  end if;
  if p_tipo not in ('alterar', 'suspender') then
    raise exception 'Tipo de mudança desconhecido.';
  end if;
  if m.deleted_at is not null or m.recusado_em is not null or not m.ativo then
    raise exception 'Este remédio não está mais na lista.';
  end if;

  v_admin := public.is_admin(m.idoso_id);
  v_antes := jsonb_build_object(
    'nome', m.nome, 'dosagem', m.dosagem, 'instrucoes', m.instrucoes, 'frequencia', m.frequencia,
    'horarios', to_jsonb(m.horarios), 'dias_semana', to_jsonb(m.dias_semana),
    'intervalo_dias', m.intervalo_dias, 'inicio', m.inicio, 'fim', m.fim, 'ativo', m.ativo);

  if not v_admin then
    perform set_config('guardiao.modo', 'revisao', true);
  end if;

  if p_tipo = 'suspender' then
    update medicacao set ativo = false where id = m.id;
  else
    update medicacao set
      nome = coalesce(nullif(btrim(d ->> 'nome'), ''), nome),
      dosagem = case when d ? 'dosagem' then nullif(d ->> 'dosagem', '') else dosagem end,
      instrucoes = case when d ? 'instrucoes' then nullif(d ->> 'instrucoes', '') else instrucoes end,
      frequencia = coalesce(d ->> 'frequencia', frequencia),
      horarios = case when d ? 'horarios'
        then array(select jsonb_array_elements_text(d -> 'horarios')) else horarios end,
      dias_semana = case when d ? 'dias_semana'
        then array(select (jsonb_array_elements_text(d -> 'dias_semana'))::smallint) else dias_semana end,
      intervalo_dias = case when d ? 'intervalo_dias' then (d ->> 'intervalo_dias')::int else intervalo_dias end,
      inicio = coalesce(nullif(d ->> 'inicio', '')::date, inicio),
      fim = case when d ? 'fim' then nullif(d ->> 'fim', '')::date else fim end
    where id = m.id;
  end if;

  perform set_config('guardiao.modo', '', true);

  if v_admin then
    return;
  end if;

  select id into v_aberta from medicacao_pedido
   where medicacao_id = m.id and status = 'pendente' limit 1;

  if v_aberta is null then
    insert into medicacao_pedido (idoso_id, medicacao_id, tipo, dados, antes, motivo, pedido_por)
    values (m.idoso_id, m.id, p_tipo, d, v_antes, nullif(btrim(p_motivo), ''), v_uid);
  else
    -- Soma à revisão aberta; `antes` não muda.
    update medicacao_pedido
       set tipo = p_tipo,
           dados = dados || d,
           motivo = coalesce(nullif(btrim(p_motivo), ''), motivo),
           pedido_por = v_uid,
           pedido_em = now()
     where id = v_aberta;
  end if;
end $$;

revoke all on function public.aplicar_mudanca_medicacao(uuid, text, jsonb, text) from public, anon;
grant execute on function public.aplicar_mudanca_medicacao(uuid, text, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Aprovar (nada muda, já valia) ou negar (volta ao que era)
-- ---------------------------------------------------------------------------
create or replace function public.decidir_pedido_medicacao(p_pedido uuid, p_aprovar boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  p medicacao_pedido;
  a jsonb;
  m medicacao;
  v_texto text;
begin
  select * into p from medicacao_pedido where id = p_pedido for update;
  if p.id is null or not public.is_admin(p.idoso_id) then
    raise exception 'Só o administrador decide esta revisão.';
  end if;
  if p.status <> 'pendente' then
    raise exception 'Esta revisão já foi encerrada.';
  end if;

  if not p_aprovar then
    a := p.antes;
    if a is null then
      raise exception 'Não há como voltar esta mudança.';
    end if;
    perform set_config('guardiao.modo', 'negacao', true);
    update medicacao set
      nome = a ->> 'nome',
      dosagem = a ->> 'dosagem',
      instrucoes = a ->> 'instrucoes',
      frequencia = a ->> 'frequencia',
      horarios = array(select jsonb_array_elements_text(a -> 'horarios')),
      dias_semana = array(select (jsonb_array_elements_text(a -> 'dias_semana'))::smallint),
      intervalo_dias = (a ->> 'intervalo_dias')::int,
      inicio = (a ->> 'inicio')::date,
      fim = (a ->> 'fim')::date,
      ativo = (a ->> 'ativo')::boolean
    where id = p.medicacao_id
    returning * into m;
    perform set_config('guardiao.modo', '', true);

    v_texto := case p.tipo
        when 'suspender' then 'A suspensão de ' || m.nome || ' foi negada pela família. Ele voltou para a lista'
        else 'A mudança em ' || m.nome || ' foi negada pela família. Voltou a ser como antes'
      end
      || coalesce(' (' || nullif(m.dosagem, '') || ')', '')
      || '. Confira a lista de hoje antes da próxima dose.';

    perform public.emitir_alerta(
      p_idoso := p.idoso_id,
      p_tipo := 'medicacao_mudanca_negada',
      p_severidade := 'atencao',
      p_natureza := 'operacional',
      p_titulo := 'Mudança negada: ' || m.nome,
      p_ref_tipo := 'medicacao',
      p_ref_id := m.id,
      p_chave := 'medicacao_negada:' || p.id,
      p_texto_familiar := v_texto,
      p_texto_cuidador := v_texto,
      p_excluir := auth.uid()
    );
  end if;

  update medicacao_pedido
     set status = case when p_aprovar then 'aprovado' else 'recusado' end,
         decidido_por = auth.uid(),
         decidido_em = now()
   where id = p.id;

  update alerta_destinatario d set lido_em = now()
    from alerta x
   where x.id = d.alerta_id and x.idoso_id = p.idoso_id and d.lido_em is null
     and x.chave = 'medicacao_pedido:' || p.id;
end $$;

create or replace function public.trg_alerta_pedido_medicacao()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_med text;
  v_quem text;
begin
  select nome into v_med from medicacao where id = new.medicacao_id;
  select coalesce(nullif(u.nome, ''), 'Alguém da rede') into v_quem from usuario u where u.id = new.pedido_por;

  perform public.emitir_alerta(
    p_idoso := new.idoso_id,
    p_tipo := 'medicacao_pedido',
    p_severidade := 'atencao',
    p_natureza := 'operacional',
    p_titulo := case new.tipo when 'suspender' then 'Suspensão para revisar: ' else 'Mudança para revisar: ' end || v_med,
    p_ref_tipo := 'medicacao',
    p_ref_id := new.medicacao_id,
    p_chave := 'medicacao_pedido:' || new.id,
    p_texto_familiar := coalesce(v_quem, 'Alguém da rede')
      || case new.tipo when 'suspender' then ' suspendeu ' else ' mudou ' end || v_med
      || coalesce('. Motivo: ' || nullif(btrim(new.motivo), ''), '') || '. Já está valendo. Aprove ou negue.',
    p_familiar_so_admin := true,
    p_excluir := new.pedido_por
  );
  return new;
end $$;

create or replace function public.trg_alerta_medicacao()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_desc text;
  v_quem text;
  v_retirada boolean := false;
  v_modo text := coalesce(current_setting('guardiao.modo', true), '');
begin
  -- Ao negar uma mudança, o aviso é próprio (feito por quem nega); o genérico seria confuso.
  if v_modo = 'negacao' then
    return new;
  end if;

  v_desc := new.nome
    || coalesce(' ' || nullif(new.dosagem, ''), '')
    || coalesce(' (' || nullif(new.instrucoes, '') || ')', '');
  select coalesce(nullif(u.nome, ''), 'Alguém da rede') into v_quem from usuario u where u.id = auth.uid();
  v_quem := coalesce(v_quem, 'Alguém da rede');

  if tg_op = 'INSERT' and not new.confirmado then
    -- Já está valendo. O administrador é chamado a revisar; os demais ficam sabendo.
    perform public.emitir_alerta(
      p_idoso := new.idoso_id,
      p_tipo := 'medicacao_a_confirmar',
      p_severidade := 'atencao',
      p_natureza := 'operacional',
      p_titulo := 'Remédio novo para revisar: ' || new.nome,
      p_ref_tipo := 'medicacao',
      p_ref_id := new.id,
      p_chave := 'medicacao_confirmar:' || new.id,
      p_texto_familiar := v_quem || ' adicionou ' || v_desc || '. Já está valendo. Aprove, corrija ou negue na tela de Medicação.',
      p_familiar_so_admin := true,
      p_texto_cuidador := 'Remédio novo na lista: ' || v_desc || '. Confira a lista de hoje antes de registrar as doses.',
      p_excluir := auth.uid()
    );
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Revisado (aprovado ou negado): o pedido de revisão sai dos não lidos.
    if (new.confirmado and not old.confirmado) or (new.recusado_em is not null and old.recusado_em is null) then
      update alerta_destinatario d set lido_em = now()
        from alerta a
       where a.id = d.alerta_id and a.idoso_id = new.idoso_id
         and a.chave = 'medicacao_confirmar:' || new.id and d.lido_em is null;
    end if;

    if new.recusado_em is not null and old.recusado_em is null then
      perform public.emitir_alerta(
        p_idoso := new.idoso_id,
        p_tipo := 'medicacao_recusada',
        p_severidade := 'atencao',
        p_natureza := 'operacional',
        p_titulo := 'Remédio negado: ' || new.nome,
        p_ref_tipo := 'medicacao',
        p_ref_id := new.id,
        p_chave := 'medicacao_recusada:' || new.id,
        p_texto_familiar := new.nome || ' foi negado e saiu da lista.',
        p_texto_cuidador := new.nome || ' foi negado pela família e saiu da lista. Não dê de novo sem falar com a família.',
        p_excluir := auth.uid()
      );
      return new;
    end if;

    if old.nome is not distinct from new.nome
       and old.dosagem is not distinct from new.dosagem
       and old.instrucoes is not distinct from new.instrucoes
       and old.horarios is not distinct from new.horarios
       and old.frequencia is not distinct from new.frequencia
       and old.dias_semana is not distinct from new.dias_semana
       and old.intervalo_dias is not distinct from new.intervalo_dias
       and old.fim is not distinct from new.fim
       and old.ativo is not distinct from new.ativo
       and old.deleted_at is not distinct from new.deleted_at then
      return new;
    end if;

    v_retirada := (new.deleted_at is not null and old.deleted_at is null)
      or (new.ativo = false and old.ativo = true);
  end if;

  perform public.emitir_alerta(
    p_idoso := new.idoso_id,
    p_tipo := 'medicacao_alterada',
    p_severidade := 'info',
    p_natureza := 'operacional',
    p_titulo := case when v_retirada then 'Medicação retirada: ' else 'Medicação atualizada: ' end || new.nome,
    p_ref_tipo := 'medicacao',
    p_ref_id := new.id,
    p_chave := 'medicacao:' || new.id || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'),
    p_texto_familiar := case when v_modo = 'revisao' then null
      else case when v_retirada then 'Medicação retirada da lista: ' else 'Medicação atualizada: ' end || v_desc || '.' end,
    p_texto_cuidador := case when v_retirada
        then 'Medicação retirada da lista: ' || new.nome || '. Não precisa mais registrar as doses dela.'
        else 'Medicação atualizada: ' || v_desc || '. Confira a lista de hoje antes de registrar as doses.' end,
    p_texto_titular := case when v_retirada
        then 'A medicação ' || new.nome || ' foi retirada da sua lista.'
        else 'Houve uma mudança na sua medicação: ' || new.nome || '.' end,
    p_excluir := auth.uid()
  );
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Teste (desfeito no fim; se falhar, a migração é recusada)
-- ---------------------------------------------------------------------------
do $$
declare
  adm uuid := gen_random_uuid();
  cui uuid := gen_random_uuid();
  cu2 uuid := gen_random_uuid();
  ido uuid;
  med uuid;
  ped uuid;
  res text := '';
  r text;
  v text;
  n int;
begin
  begin
    insert into auth.users (id, email) values
      (adm, 'teste-adm-' || adm || '@exemplo.invalid'),
      (cui, 'teste-cui-' || cui || '@exemplo.invalid'),
      (cu2, 'teste-cu2-' || cu2 || '@exemplo.invalid');
    insert into public.idoso (nome) values ('Teste de mudancas') returning id into ido;
    insert into public.vinculo (usuario_id, idoso_id, papel, admin) values
      (adm, ido, 'familiar', true), (cui, ido, 'cuidador', false), (cu2, ido, 'cuidador', false);

    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    insert into public.medicacao (idoso_id, nome, dosagem, horarios) values (ido, 'Base', '10mg', array['08:00'])
      returning id into med;

    -- A. cuidadora muda: vale na hora; abre uma revisao; mexer direto continua bloqueado
    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    perform public.aplicar_mudanca_medicacao(med, 'alterar', '{"dosagem":"20mg"}', 'medico mudou');
    select dosagem into v from public.medicacao where id = med;
    res := res || 'vale_na_hora=' || v || ';';
    begin
      update public.medicacao set dosagem = '99mg' where id = med;
      res := res || 'direto_depois=permitido;';
    exception when others then res := res || 'direto_depois=bloqueado;';
    end;
    set local role authenticated;
    begin
      insert into public.medicacao_pedido (idoso_id, medicacao_id, tipo, antes, pedido_por)
        values (ido, med, 'alterar', '{"dosagem":"500mg"}', cui);
      res := res || 'forjar_revisao=permitido;';
    exception when others then res := res || 'forjar_revisao=bloqueado;';
    end;

    -- B. segunda mudanca soma na mesma revisao, e o "antes" continua o original
    set local role authenticated;
    perform public.aplicar_mudanca_medicacao(med, 'alterar', '{"dosagem":"30mg","horarios":["noite"]}', null);
    set local role postgres;
    select count(*) into n from public.medicacao_pedido where medicacao_id = med and status = 'pendente';
    select id, antes ->> 'dosagem' into ped, v from public.medicacao_pedido where medicacao_id = med and status = 'pendente';
    res := res || 'revisoes_abertas=' || n || ';antes_guardado=' || v || ';';
    select string_agg(distinct a.tipo, ',') into v from public.alerta a
      join public.alerta_destinatario d on d.alerta_id = a.id
     where a.idoso_id = ido and d.usuario_id = adm and d.lido_em is null and a.referencia_id = med;
    res := res || 'avisos_do_admin=' || coalesce(v, 'nenhum') || ';';

    -- C. cuidadora nao decide; admin nega: volta ao original e quem cuida e avisado
    set local role authenticated;
    begin
      perform public.decidir_pedido_medicacao(ped, false);
      res := res || 'cuidadora_decide=permitido;';
    exception when others then res := res || 'cuidadora_decide=bloqueado;';
    end;
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    perform public.decidir_pedido_medicacao(ped, false);
    select dosagem || ' ' || array_to_string(horarios, ',') into v from public.medicacao where id = med;
    res := res || 'apos_negar=' || v || ';';
    set local role postgres;
    select count(*) into n from public.alerta_destinatario d join public.alerta a on a.id = d.alerta_id
     where a.chave = 'medicacao_negada:' || ped and d.usuario_id in (cui, cu2);
    res := res || 'avisadas_da_negacao=' || n || ';';

    -- D. suspender vale na hora; negar traz de volta
    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    perform public.aplicar_mudanca_medicacao(med, 'suspender');
    select ativo::text into v from public.medicacao where id = med;
    res := res || 'suspenso_na_hora_ativo=' || v || ';';
    set local role postgres;
    select id into ped from public.medicacao_pedido where medicacao_id = med and status = 'pendente';
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    perform public.decidir_pedido_medicacao(ped, false);
    select ativo::text into v from public.medicacao where id = med;
    res := res || 'apos_negar_suspensao_ativo=' || v || ';';

    -- E. edicao do admin encerra a revisao: negar depois nao desfaz a edicao dele
    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    perform public.aplicar_mudanca_medicacao(med, 'alterar', '{"dosagem":"40mg"}');
    set local role postgres;
    select id into ped from public.medicacao_pedido where medicacao_id = med and status = 'pendente';
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    update public.medicacao set dosagem = '15mg' where id = med;
    begin
      perform public.decidir_pedido_medicacao(ped, false);
      res := res || 'negar_apos_edicao=permitido;';
    exception when others then res := res || 'negar_apos_edicao=bloqueado;';
    end;
    set local role authenticated;
    select dosagem into v from public.medicacao where id = med;
    res := res || 'dose_final=' || v || ';';

    raise exception 'RESULTADO_TESTE|%|%', res,
      'vale_na_hora=20mg;direto_depois=bloqueado;forjar_revisao=bloqueado;revisoes_abertas=1;antes_guardado=10mg;'
      'avisos_do_admin=medicacao_pedido;cuidadora_decide=bloqueado;apos_negar=10mg 08:00;avisadas_da_negacao=2;'
      'suspenso_na_hora_ativo=false;apos_negar_suspensao_ativo=true;negar_apos_edicao=bloqueado;dose_final=15mg;';
  exception when others then
    if sqlerrm like 'RESULTADO_TESTE|%' then r := sqlerrm; else raise; end if;
  end;
  if split_part(r, '|', 2) is distinct from split_part(r, '|', 3) then
    raise exception E'Teste das mudanças FALHOU.\nObtido:   %\nEsperado: %', split_part(r, '|', 2), split_part(r, '|', 3);
  end if;
end $$;
