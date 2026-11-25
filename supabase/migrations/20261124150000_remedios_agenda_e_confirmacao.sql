-- Remédios: horário, frequência e confirmação pela administração.
--
-- 1. Cada remédio passa a ter horários, frequência e período de uso.
-- 2. Cada dose é um registro próprio (remédio + dia + horário).
-- 3. Quem não é administrador pode ADICIONAR um remédio, que fica aguardando confirmação,
--    e PEDIR mudança ou suspensão de um já confirmado. Quem confirma é o administrador.
--    A regra vale no banco, e não só na tela.

-- ---------------------------------------------------------------------------
-- 1. Agenda do remédio
-- ---------------------------------------------------------------------------

alter table public.medicacao
  add column if not exists horarios text[] not null default '{}',
  add column if not exists frequencia text not null default 'diaria',
  add column if not exists dias_semana smallint[] not null default '{}',
  add column if not exists intervalo_dias int,
  add column if not exists inicio date,
  add column if not exists fim date,
  add column if not exists confirmado_por uuid references public.usuario (id),
  add column if not exists confirmado_em timestamptz,
  add column if not exists recusado_em timestamptz;

-- Os já cadastrados começam na data em que foram criados.
update public.medicacao
   set inicio = (created_at at time zone 'America/Sao_Paulo')::date
 where inicio is null;

alter table public.medicacao
  alter column inicio set default ((now() at time zone 'America/Sao_Paulo')::date),
  alter column inicio set not null;

alter table public.medicacao drop constraint if exists medicacao_agenda_valida;
alter table public.medicacao add constraint medicacao_agenda_valida check (
  frequencia in ('diaria', 'semana', 'intervalo', 'quando_precisar')
  and (frequencia <> 'semana' or cardinality(dias_semana) > 0)
  and dias_semana <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
  and (frequencia <> 'intervalo' or coalesce(intervalo_dias, 0) between 2 and 365)
  and (fim is null or fim >= inicio)
  and (
    cardinality(horarios) = 0
    or array_to_string(horarios, ',') ~ '^([01][0-9]|2[0-3]):[0-5][0-9](,([01][0-9]|2[0-3]):[0-5][0-9])*$'
  )
);

-- O remédio é esperado neste dia?
create or replace function public.med_vale_no_dia(m public.medicacao, d date)
returns boolean language sql stable as $$
  select m.ativo and m.deleted_at is null
     and d >= m.inicio and (m.fim is null or d <= m.fim)
     and case m.frequencia
           when 'diaria' then true
           when 'semana' then extract(dow from d)::smallint = any (m.dias_semana)
           when 'intervalo' then ((d - m.inicio) % m.intervalo_dias) = 0
           else false
         end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Uma marcação por dose (antes era uma por dia)
-- ---------------------------------------------------------------------------

-- '' = remédio sem horário definido. Nos "só quando precisar", guarda a hora em que foi dado.
alter table public.registro_medicacao
  add column if not exists horario text not null default '';

alter table public.registro_medicacao
  drop constraint if exists registro_medicacao_medicacao_id_data_key;

create unique index if not exists registro_medicacao_dose_uq
  on public.registro_medicacao (medicacao_id, data, horario);

-- ---------------------------------------------------------------------------
-- 3. Confirmação: quem não administra não confirma nem muda o que está confirmado
-- ---------------------------------------------------------------------------

create or replace function public.medicacao_guarda()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean;
begin
  -- Sem usuário logado (migração e manutenção): não há o que conferir.
  if v_uid is null then
    return new;
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

  if new.idoso_id is distinct from old.idoso_id then
    raise exception 'Um remédio não muda de pessoa.';
  end if;

  if v_admin then
    if new.confirmado and not old.confirmado then
      new.confirmado_por := v_uid;
      new.confirmado_em := now();
    end if;
    return new;
  end if;

  -- Não administrador: só mexe no PRÓPRIO remédio que ainda aguarda confirmação.
  if old.confirmado or old.autor_id is distinct from v_uid or old.recusado_em is not null then
    raise exception 'Mudar um remédio já confirmado precisa do administrador. Envie um pedido.';
  end if;
  if new.confirmado
     or new.confirmado_por is distinct from old.confirmado_por
     or new.recusado_em is distinct from old.recusado_em
     or new.autor_id is distinct from old.autor_id then
    raise exception 'Só o administrador confirma ou recusa um remédio.';
  end if;
  return new;
end $$;

drop trigger if exists trg_medicacao_guarda on public.medicacao;
create trigger trg_medicacao_guarda
  before insert or update on public.medicacao
  for each row execute function public.medicacao_guarda();

-- ---------------------------------------------------------------------------
-- 4. Pedidos de mudança ou suspensão
-- ---------------------------------------------------------------------------

create table if not exists public.medicacao_pedido (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  medicacao_id uuid not null references public.medicacao (id) on delete cascade,
  tipo text not null check (tipo in ('alterar', 'suspender')),
  dados jsonb not null default '{}'::jsonb,
  motivo text,
  status text not null default 'pendente' check (status in ('pendente', 'aprovado', 'recusado')),
  pedido_por uuid not null references public.usuario (id),
  pedido_em timestamptz not null default now(),
  decidido_por uuid references public.usuario (id),
  decidido_em timestamptz
);

create index if not exists medicacao_pedido_idx on public.medicacao_pedido (idoso_id, status);

alter table public.medicacao_pedido enable row level security;
-- Sem UPDATE: a decisão passa só pela função abaixo.
grant select, insert on public.medicacao_pedido to authenticated;

drop policy if exists medpedido_sel on public.medicacao_pedido;
create policy medpedido_sel on public.medicacao_pedido for select
  using (public.is_member(idoso_id));

drop policy if exists medpedido_ins on public.medicacao_pedido;
create policy medpedido_ins on public.medicacao_pedido for insert
  with check (
    public.is_member(idoso_id)
    and pedido_por = auth.uid()
    and status = 'pendente'
    and decidido_por is null
    and exists (select 1 from public.medicacao m where m.id = medicacao_id and m.idoso_id = medicacao_pedido.idoso_id)
  );

create or replace function public.decidir_pedido_medicacao(p_pedido uuid, p_aprovar boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  p medicacao_pedido;
  d jsonb;
begin
  select * into p from medicacao_pedido where id = p_pedido for update;
  if p.id is null or not public.is_admin(p.idoso_id) then
    raise exception 'Só o administrador decide este pedido.';
  end if;
  if p.status <> 'pendente' then
    raise exception 'Este pedido já foi decidido.';
  end if;

  if p_aprovar then
    if p.tipo = 'suspender' then
      update medicacao set ativo = false where id = p.medicacao_id;
    else
      d := p.dados;
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
        fim = case when d ? 'fim' then nullif(d ->> 'fim', '')::date else fim end
      where id = p.medicacao_id;
    end if;
  end if;

  update medicacao_pedido
     set status = case when p_aprovar then 'aprovado' else 'recusado' end,
         decidido_por = auth.uid(),
         decidido_em = now()
   where id = p.id;
end $$;

revoke all on function public.decidir_pedido_medicacao(uuid, boolean) from public, anon;
grant execute on function public.decidir_pedido_medicacao(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Avisos
-- ---------------------------------------------------------------------------

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
    -- Aguardando: só quem pode confirmar é avisado.
    perform public.emitir_alerta(
      p_idoso := new.idoso_id,
      p_tipo := 'medicacao_a_confirmar',
      p_severidade := 'atencao',
      p_natureza := 'operacional',
      p_titulo := 'Remédio aguardando confirmação: ' || new.nome,
      p_ref_tipo := 'medicacao',
      p_ref_id := new.id,
      p_chave := 'medicacao_confirmar:' || new.id,
      p_texto_familiar := v_quem || ' adicionou ' || v_desc || '. Confira e confirme, corrija ou recuse na tela de Medicação.',
      p_familiar_so_admin := true,
      p_excluir := auth.uid()
    );
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.recusado_em is not null and old.recusado_em is null then
      perform public.emitir_alerta(
        p_idoso := new.idoso_id,
        p_tipo := 'medicacao_recusada',
        p_severidade := 'atencao',
        p_natureza := 'operacional',
        p_titulo := 'Remédio não confirmado: ' || new.nome,
        p_ref_tipo := 'medicacao',
        p_ref_id := new.id,
        p_chave := 'medicacao_recusada:' || new.id,
        p_texto_familiar := new.nome || ' não foi confirmado e saiu da lista.',
        p_texto_cuidador := new.nome || ' não foi confirmado e saiu da lista. Antes de dar de novo, fale com a família.',
        p_excluir := auth.uid()
      );
      return new;
    end if;

    -- Enquanto aguarda, correções não geram aviso para todos.
    if not new.confirmado then
      return new;
    end if;

    if old.confirmado = new.confirmado
       and old.nome is not distinct from new.nome
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
    p_titulo := case new.tipo when 'suspender' then 'Pedido para suspender: ' else 'Pedido de mudança: ' end || v_med,
    p_ref_tipo := 'medicacao',
    p_ref_id := new.medicacao_id,
    p_chave := 'medicacao_pedido:' || new.id,
    p_texto_familiar := coalesce(v_quem, 'Alguém da rede') || ' pediu '
      || case new.tipo when 'suspender' then 'para suspender ' else 'uma mudança em ' end || v_med
      || coalesce('. Motivo: ' || nullif(btrim(new.motivo), ''), '') || '. Decida na tela de Medicação.',
    p_familiar_so_admin := true,
    p_excluir := new.pedido_por
  );
  return new;
end $$;

drop trigger if exists trg_alerta_pedido_medicacao on public.medicacao_pedido;
create trigger trg_alerta_pedido_medicacao
  after insert on public.medicacao_pedido
  for each row execute function public.trg_alerta_pedido_medicacao();

-- ---------------------------------------------------------------------------
-- 6. Silêncio: conta só os dias em que havia dose prevista
-- ---------------------------------------------------------------------------

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
    where m.idoso_id = p_idoso and m.confirmado and public.med_vale_no_dia(m, g.dia::date)
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

-- ---------------------------------------------------------------------------
-- 7. QR de emergência: o que aguarda confirmação aparece, e avisado como tal
-- ---------------------------------------------------------------------------

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
        'nome', m.nome, 'dosagem', m.dosagem, 'aguardando', not m.confirmado) order by m.nome), '[]'::jsonb)
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

-- ---------------------------------------------------------------------------
-- 8. Teste das regras (desfeito no fim; se falhar, a migração é recusada)
-- ---------------------------------------------------------------------------

do $$
declare
  adm uuid := gen_random_uuid();
  fam uuid := gen_random_uuid();
  cui uuid := gen_random_uuid();
  ido uuid;
  ido2 uuid;
  m_adm uuid;
  m_cui uuid;
  m_fam uuid;
  m_sem uuid;
  ped uuid;
  res text := '';
  r text;
  v_bool boolean;
  v_txt text;
  n int;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  begin
    insert into auth.users (id, email) values
      (adm, 'teste-adm-' || adm || '@exemplo.invalid'),
      (fam, 'teste-fam-' || fam || '@exemplo.invalid'),
      (cui, 'teste-cui-' || cui || '@exemplo.invalid');
    insert into public.idoso (nome) values ('Teste de remedios') returning id into ido;
    insert into public.vinculo (usuario_id, idoso_id, papel, admin) values
      (adm, ido, 'familiar', true),
      (fam, ido, 'familiar', false),
      (cui, ido, 'cuidador', false);

    -- A. administrador adiciona: ja entra confirmado
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    insert into public.medicacao (idoso_id, nome, horarios) values (ido, 'Do admin', array['08:00', '20:00'])
      returning id into m_adm;
    select confirmado and confirmado_por = adm into v_bool from public.medicacao where id = m_adm;
    set local role postgres;
    res := res || 'admin_entra_confirmado=' || v_bool || ';';

    -- B. cuidadora adiciona tentando ja confirmar: fica aguardando; so o admin e avisado
    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    insert into public.medicacao (idoso_id, nome, confirmado, confirmado_por)
      values (ido, 'Da cuidadora', true, cui) returning id into m_cui;
    select confirmado into v_bool from public.medicacao where id = m_cui;
    set local role postgres;
    res := res || 'cuidadora_confirmado=' || v_bool || ';';

    set local role postgres;
    select string_agg(case d.usuario_id when adm then 'admin' when fam then 'familiar' else 'cuidadora' end, ',')
      into v_txt
      from public.alerta_destinatario d join public.alerta a on a.id = d.alerta_id
     where a.idoso_id = ido and a.tipo = 'medicacao_a_confirmar';
    set local role postgres;
    res := res || 'aviso_de_pendente_para=' || coalesce(v_txt, 'ninguem') || ';';

    -- C. familiar sem administracao segue a mesma regra
    perform set_config('request.jwt.claims', json_build_object('sub', fam, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', fam::text, true);
    set local role authenticated;
    insert into public.medicacao (idoso_id, nome) values (ido, 'Do familiar') returning id into m_fam;
    select confirmado into v_bool from public.medicacao where id = m_fam;
    set local role postgres;
    res := res || 'familiar_confirmado=' || v_bool || ';';

    -- D. cuidadora: nao confirma o proprio, nao muda o confirmado, nao mexe no de outra pessoa
    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    begin
      set local role authenticated;
      update public.medicacao set confirmado = true where id = m_cui;
      set local role postgres;
      res := res || 'auto_confirmar=permitido;';
    exception when others then set local role postgres; res := res || 'auto_confirmar=bloqueado;';
    end;
    begin
      set local role authenticated;
      update public.medicacao set dosagem = '999mg' where id = m_adm;
      set local role postgres;
      res := res || 'mudar_confirmado=permitido;';
    exception when others then set local role postgres; res := res || 'mudar_confirmado=bloqueado;';
    end;
    begin
      set local role authenticated;
      update public.medicacao set nome = 'outro' where id = m_fam;
      set local role postgres;
      res := res || 'mudar_pendente_alheio=permitido;';
    exception when others then set local role postgres; res := res || 'mudar_pendente_alheio=bloqueado;';
    end;
    begin
      set local role authenticated;
      update public.medicacao set dosagem = '5mg' where id = m_cui;
      set local role postgres;
      res := res || 'corrigir_o_proprio_pendente=permitido;';
    exception when others then set local role postgres; res := res || 'corrigir_o_proprio_pendente=bloqueado;';
    end;

    -- E. cada dose e um registro; a mesma dose nao se repete (inclusive do pendente)
    set local role authenticated;
    insert into public.registro_medicacao (medicacao_id, data, horario, status, registrado_por) values
      (m_adm, hoje, '08:00', 'dada', cui),
      (m_adm, hoje, '20:00', 'dada', cui),
      (m_cui, hoje, '', 'dada', cui);
    set local role postgres;
    res := res || 'duas_doses_no_dia_e_dose_de_pendente=permitido;';
    begin
      set local role authenticated;
      insert into public.registro_medicacao (medicacao_id, data, horario, status, registrado_por)
        values (m_adm, hoje, '08:00', 'dada', cui);
      set local role postgres;
      res := res || 'mesma_dose_duas_vezes=permitido;';
    exception when others then set local role postgres; res := res || 'mesma_dose_duas_vezes=bloqueado;';
    end;

    -- F. pedido de mudanca: cuidadora pede, nao decide; admin aprova e a mudanca entra
    set local role authenticated;
    insert into public.medicacao_pedido (idoso_id, medicacao_id, tipo, dados, motivo, pedido_por)
      values (ido, m_adm, 'alterar', '{"dosagem":"50mg","horarios":["09:00"]}', 'medico mudou', cui)
      returning id into ped;
    set local role postgres;
    begin
      set local role authenticated;
      perform public.decidir_pedido_medicacao(ped, true);
      set local role postgres;
      res := res || 'cuidadora_decide=permitido;';
    exception when others then set local role postgres; res := res || 'cuidadora_decide=bloqueado;';
    end;

    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    perform public.decidir_pedido_medicacao(ped, true);
    select dosagem || ' ' || array_to_string(horarios, ',') into v_txt from public.medicacao where id = m_adm;
    update public.medicacao set confirmado = true where id = m_cui;
    select confirmado and confirmado_por = adm into v_bool from public.medicacao where id = m_cui;
    set local role postgres;
    res := res || 'apos_aprovar=' || v_txt || ';admin_confirma_pendente=' || v_bool || ';';

    -- G. silencio so conta dia com dose prevista: remedio semanal nao dispara alarme falso
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    insert into public.idoso (nome) values ('Teste de silencio semanal') returning id into ido2;
    insert into public.vinculo (usuario_id, idoso_id, papel, admin) values (adm, ido2, 'familiar', true);
    insert into public.medicacao (idoso_id, nome, frequencia, dias_semana, inicio)
      values (ido2, 'Semanal', 'semana', array[extract(dow from hoje - 6)::smallint], hoje - 30)
      returning id into m_sem;
    set local role postgres;
    insert into public.registro_medicacao (medicacao_id, data, status, registrado_em)
      values (m_sem, hoje - 6, 'dada', ((hoje - 6)::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo');
    set local role postgres;
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    perform public.gerar_alertas_silencio(ido2);
    set local role postgres;
    set local role postgres;
    select count(*) into n from public.alerta where idoso_id = ido2 and tipo like 'silencio%';
    set local role postgres;
    res := res || 'silencio_remedio_semanal=' || n || ';';

    -- H. o mesmo periodo, com remedio diario, dispara os dois avisos
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    update public.medicacao set frequencia = 'diaria' where id = m_sem;
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    perform public.gerar_alertas_silencio(ido2);
    set local role postgres;
    set local role postgres;
    select count(*) into n from public.alerta where idoso_id = ido2 and tipo like 'silencio%';
    set local role postgres;
    res := res || 'silencio_remedio_diario=' || n || ';';

    raise exception 'RESULTADO_TESTE|%|%', res,
      'admin_entra_confirmado=true;cuidadora_confirmado=false;aviso_de_pendente_para=admin;familiar_confirmado=false;'
      'auto_confirmar=bloqueado;mudar_confirmado=bloqueado;mudar_pendente_alheio=bloqueado;corrigir_o_proprio_pendente=permitido;'
      'duas_doses_no_dia_e_dose_de_pendente=permitido;mesma_dose_duas_vezes=bloqueado;cuidadora_decide=bloqueado;'
      'apos_aprovar=50mg 09:00;admin_confirma_pendente=true;silencio_remedio_semanal=0;silencio_remedio_diario=2;';
  exception when others then
    if sqlerrm like 'RESULTADO_TESTE|%' then r := sqlerrm; else raise; end if;
  end;

  if split_part(r, '|', 2) is distinct from split_part(r, '|', 3) then
    raise exception E'Teste dos remédios FALHOU.\nObtido:   %\nEsperado: %',
      split_part(r, '|', 2), split_part(r, '|', 3);
  end if;
end $$;
