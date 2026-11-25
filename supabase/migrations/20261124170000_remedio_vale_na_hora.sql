-- Remédio adicionado por quem não administra VALE NA HORA.
--
-- Antes ficava marcado como "aguardando confirmação". Agora ele já está em uso (lista de doses,
-- painel, QR, folha e alerta de silêncio), o administrador é avisado para revisar e pode
-- aprovar, corrigir ou negar. Só ao negar ele sai.
--
-- A coluna `confirmado` passa a significar apenas "já revisado pelo administrador".
-- Mudar ou suspender um remédio já revisado continua passando por pedido.


create or replace function public.trg_alerta_medicacao()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_desc text;
  v_quem text;
  v_retirada boolean := false;
begin
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
    p_texto_familiar := case when v_retirada then 'Medicação retirada da lista: ' else 'Medicação atualizada: ' end || v_desc || '.',
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

create or replace function public.gerar_alertas_silencio(p_idoso uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ultimo date;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_dias int;
  v_ep text;
  v_desde text;
begin
  if not public.is_member(p_idoso) then
    return;
  end if;

  -- Último dia que recebeu algum registro.
  select max((rm.registrado_em at time zone 'America/Sao_Paulo')::date) into v_ultimo
  from registro_medicacao rm
  join medicacao m on m.id = rm.medicacao_id
  where m.idoso_id = p_idoso and rm.deleted_at is null;

  -- Sem nenhum registro anterior não é silêncio (cadastro novo não dispara alarme).
  if v_ultimo is null then
    return;
  end if;

  -- Dias já encerrados, depois do último registro, que tinham dose prevista.
  select count(*) into v_dias
  from generate_series(greatest(v_ultimo + 1, v_hoje - 90), v_hoje - 1, interval '1 day') g(dia)
  where exists (
    select 1 from medicacao m
    where m.idoso_id = p_idoso and public.med_vale_no_dia(m, g.dia::date)
  );

  v_ep := to_char(v_ultimo, 'YYYY-MM-DD');
  v_desde := to_char(v_ultimo, 'DD/MM');

  update alerta_destinatario d
     set lido_em = now()
    from alerta a
   where a.id = d.alerta_id
     and a.idoso_id = p_idoso
     and a.tipo in ('silencio_registro', 'silencio_escalado')
     and d.lido_em is null
     and (v_dias < 3 or a.chave not in ('silencio:' || v_ep, 'silencio_escalado:' || v_ep));

  if v_dias >= 3 then
    perform public.emitir_alerta(
      p_idoso := p_idoso,
      p_tipo := 'silencio_registro',
      p_severidade := 'info',
      p_natureza := 'operacional',
      p_titulo := 'Sem registro de medicação desde ' || v_desde,
      p_ref_tipo := 'silencio',
      p_ref_id := null,
      p_chave := 'silencio:' || v_ep,
      p_texto_cuidador := 'Ninguém registra a medicação desde ' || v_desde || '. Quando puder, marque o que foi dado.'
    );
  end if;

  if v_dias >= 5 then
    perform public.emitir_alerta(
      p_idoso := p_idoso,
      p_tipo := 'silencio_escalado',
      p_severidade := 'atencao',
      p_natureza := 'operacional',
      p_titulo := 'Sem registro de medicação desde ' || v_desde,
      p_ref_tipo := 'silencio',
      p_ref_id := null,
      p_chave := 'silencio_escalado:' || v_ep,
      p_texto_familiar := 'Não há registro de medicação desde ' || v_desde || ', e o aviso já tinha ido para quem cuida. Isto é sobre o registro, não necessariamente sobre a saúde: pode valer um contato para saber se está tudo bem.',
      p_familiar_so_admin := true
    );
  end if;
end $$;

revoke all on function public.gerar_alertas_silencio(uuid) from public, anon;
grant execute on function public.gerar_alertas_silencio(uuid) to authenticated;

create or replace function public.emergencia_por_token(p_token text)
returns jsonb language sql security definer stable set search_path = public as $$
  select case when et.id is null then null else jsonb_build_object(
    'nome', i.nome,
    'data_nascimento', i.data_nascimento,
    'tipo_sanguineo', i.tipo_sanguineo,
    'alergias', (select coalesce(jsonb_agg(jsonb_build_object(
        'substancia', a.substancia, 'reacao', a.reacao, 'gravidade', a.gravidade)), '[]'::jsonb)
      from alergia a where a.idoso_id = i.id and a.deleted_at is null),
    'condicoes', (select coalesce(jsonb_agg(c.nome), '[]'::jsonb)
      from condicao c where c.idoso_id = i.id and c.ativa and c.deleted_at is null),
    'medicacoes', (select coalesce(jsonb_agg(jsonb_build_object(
        'nome', m.nome, 'dosagem', m.dosagem) order by m.nome), '[]'::jsonb)
      from medicacao m where m.idoso_id = i.id and m.ativo and m.deleted_at is null
        and (m.fim is null or m.fim >= (now() at time zone 'America/Sao_Paulo')::date)),
    'contatos', (select coalesce(jsonb_agg(jsonb_build_object(
        'nome', ce.nome, 'telefone', ce.telefone, 'relacao', ce.relacao)), '[]'::jsonb)
      from contato_emergencia ce where ce.idoso_id = i.id and ce.deleted_at is null)
  ) end
  from emergencia_token et
  join idoso i on i.id = et.idoso_id
  where et.token = p_token and et.ativo = true and et.revogado_em is null and i.deleted_at is null;
$$;

grant execute on function public.emergencia_por_token(text) to anon;

-- Teste (desfeito no fim; se falhar, a migração é recusada)
do $$
declare
  adm uuid := gen_random_uuid();
  cui uuid := gen_random_uuid();
  cu2 uuid := gen_random_uuid();
  ido uuid;
  med uuid;
  outro uuid;
  res text := '';
  r text;
  v text;
  n int;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  begin
    insert into auth.users (id, email) values
      (adm, 'teste-adm-' || adm || '@exemplo.invalid'),
      (cui, 'teste-cui-' || cui || '@exemplo.invalid'),
      (cu2, 'teste-cu2-' || cu2 || '@exemplo.invalid');
    insert into public.idoso (nome) values ('Teste de revisao') returning id into ido;
    insert into public.vinculo (usuario_id, idoso_id, papel, admin) values
      (adm, ido, 'familiar', true), (cui, ido, 'cuidador', false), (cu2, ido, 'cuidador', false);

    -- A. cuidadora adiciona: admin recebe pedido de revisao, a outra cuidadora fica sabendo
    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    insert into public.medicacao (idoso_id, nome) values (ido, 'Novo') returning id into med;
    insert into public.medicacao (idoso_id, nome) values (ido, 'Outro') returning id into outro;
    set local role postgres;
    select string_agg(x, ',' order by x) into v from (
      select case d.usuario_id when adm then 'admin' when cu2 then 'outra' else 'autora' end as x
        from public.alerta_destinatario d join public.alerta a on a.id = d.alerta_id
       where a.chave = 'medicacao_confirmar:' || med) t;
    res := res || 'avisados=' || coalesce(v, 'ninguem') || ';';

    -- B. vale antes da revisao: entra no QR sem ressalva e conta para o silencio
    insert into public.emergencia_token (idoso_id, token) values (ido, 'teste-' || ido);
    res := res || 'no_qr=' || (jsonb_array_length(public.emergencia_por_token('teste-' || ido) -> 'medicacoes')) || ';';
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    update public.medicacao set inicio = hoje - 10 where id = med;
    insert into public.registro_medicacao (medicacao_id, data, status, registrado_em)
      values (med, hoje - 7, 'dada', ((hoje - 7)::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo');
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    perform public.gerar_alertas_silencio(ido);
    set local role postgres;
    select count(*) into n from public.alerta where idoso_id = ido and tipo like 'silencio%';
    res := res || 'silencio_conta_nao_revisado=' || n || ';';

    -- C. aprovar sem mudar: nenhum aviso novo, e o pedido de revisao fica lido
    select count(*) into n from public.alerta where idoso_id = ido and tipo = 'medicacao_alterada' and referencia_id = med;
    set local role authenticated;
    update public.medicacao set confirmado = true where id = med;
    set local role postgres;
    select count(*) - n into n from public.alerta where idoso_id = ido and tipo = 'medicacao_alterada' and referencia_id = med;
    res := res || 'avisos_ao_aprovar=' || n || ';';
    select count(*) into n from public.alerta_destinatario d join public.alerta a on a.id = d.alerta_id
      where a.chave = 'medicacao_confirmar:' || med and d.usuario_id = adm and d.lido_em is null;
    res := res || 'revisao_pendente_apos_aprovar=' || n || ';';

    -- D. negar: sai da lista e quem cuida e avisado
    set local role authenticated;
    update public.medicacao set ativo = false, recusado_em = now() where id = outro;
    set local role postgres;
    select count(*) into n from public.alerta_destinatario d join public.alerta a on a.id = d.alerta_id
      where a.chave = 'medicacao_recusada:' || outro and d.usuario_id in (cui, cu2);
    res := res || 'cuidadoras_avisadas_ao_negar=' || n || ';';
    res := res || 'no_qr_apos_negar=' || (jsonb_array_length(public.emergencia_por_token('teste-' || ido) -> 'medicacoes')) || ';';

    raise exception 'RESULTADO_TESTE|%|%', res,
      'avisados=admin,outra;no_qr=2;silencio_conta_nao_revisado=2;avisos_ao_aprovar=0;revisao_pendente_apos_aprovar=0;cuidadoras_avisadas_ao_negar=2;no_qr_apos_negar=1;';
  exception when others then
    if sqlerrm like 'RESULTADO_TESTE|%' then r := sqlerrm; else raise; end if;
  end;
  if split_part(r, '|', 2) is distinct from split_part(r, '|', 3) then
    raise exception E'Teste da revisão FALHOU.\nObtido:   %\nEsperado: %', split_part(r, '|', 2), split_part(r, '|', 3);
  end if;
end $$;
