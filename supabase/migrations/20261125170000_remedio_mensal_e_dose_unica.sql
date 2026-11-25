-- Dois tipos de agenda:
--  * 'mensal': no mesmo dia do mês do início (ou no último dia, nos meses mais curtos).
--    intervalo_dias, neste tipo, guarda de quantos em quantos MESES (vazio = todo mês).
--  * 'unica': uma dose só. Fica pendente a partir do início; quando é dada, o "fim" vira
--    o dia em que foi dada (e volta a ficar vazio se a pessoa desmarcar).

alter table public.medicacao drop constraint if exists medicacao_agenda_valida;
alter table public.medicacao add constraint medicacao_agenda_valida check (
  frequencia in ('diaria', 'semana', 'intervalo', 'mensal', 'unica', 'quando_precisar')
  and (frequencia <> 'semana' or cardinality(dias_semana) > 0)
  and dias_semana <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
  and (frequencia <> 'intervalo' or coalesce(intervalo_dias, 0) between 2 and 365)
  and (frequencia <> 'mensal' or intervalo_dias is null or intervalo_dias between 1 and 24)
  and (fim is null or fim >= inicio)
  and (
    cardinality(horarios) = 0
    or array_to_string(horarios, ',') ~
       '^(manha|tarde|noite|([01][0-9]|2[0-3]):[0-5][0-9])(,(manha|tarde|noite|([01][0-9]|2[0-3]):[0-5][0-9]))*$'
  )
);

create or replace function public.med_vale_no_dia(m public.medicacao, d date)
returns boolean language sql stable as $$
  select m.ativo and m.deleted_at is null
     and d >= m.inicio and (m.fim is null or d <= m.fim)
     and case m.frequencia
           when 'diaria' then true
           when 'semana' then extract(dow from d)::smallint = any (m.dias_semana)
           when 'intervalo' then ((d - m.inicio) % m.intervalo_dias) = 0
           when 'mensal' then
             extract(day from d) = least(
               extract(day from m.inicio),
               extract(day from (date_trunc('month', d) + interval '1 month - 1 day')))
             and ((((extract(year from d) - extract(year from m.inicio)) * 12
                    + extract(month from d) - extract(month from m.inicio))::int)
                  % coalesce(m.intervalo_dias, 1)) = 0
           when 'unica' then true
           else false
         end;
$$;

create or replace function public.trg_dose_unica()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m medicacao;
  v_dia date;
  v_modo text := coalesce(current_setting('guardiao.modo', true), '');
begin
  select * into m from medicacao where id = new.medicacao_id;
  if m.frequencia is distinct from 'unica' then
    return new;
  end if;
  select max(data) into v_dia from registro_medicacao
   where medicacao_id = m.id and status = 'dada' and deleted_at is null;
  v_dia := case when v_dia is null then null else greatest(v_dia, m.inicio) end;
  if m.fim is distinct from v_dia then
    -- Ajuste do próprio sistema: o modo 'negacao' passa pela guarda de revisão e não gera
    -- o aviso de "medicação atualizada".
    perform set_config('guardiao.modo', 'negacao', true);
    update medicacao set fim = v_dia where id = m.id;
    perform set_config('guardiao.modo', v_modo, true);
  end if;
  return new;
end $$;

drop trigger if exists trg_dose_unica on public.registro_medicacao;
create trigger trg_dose_unica
  after insert or update on public.registro_medicacao
  for each row execute function public.trg_dose_unica();

-- O aviso urgente passa a valer também para o mensal e a dose única.
create or replace function public.trg_alerta_remedio_nao_diario()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  it jsonb;
  m medicacao;
  v_quem text;
  v_quando text;
begin
  if new.status <> 'pendente' and old.status = 'pendente' then
    update alerta_destinatario d set lido_em = now()
      from alerta a
     where a.id = d.alerta_id and a.idoso_id = new.idoso_id and d.lido_em is null
       and a.chave like 'nao_diario:' || new.id || ':%';
    return new;
  end if;
  if new.status <> 'pendente' or old.itens = new.itens then
    return new;
  end if;

  select coalesce(nullif(u.nome, ''), 'Alguém da rede') into v_quem from usuario u where u.id = new.enviado_por;
  for it in select * from jsonb_array_elements(new.itens) loop
    continue when it ->> 'tipo' <> 'remedio' or it ->> 'resultado' <> 'entrou';
    select * into m from medicacao where id = (it ->> 'medicacao_id')::uuid;
    continue when m.id is null or m.frequencia not in ('semana', 'intervalo', 'mensal', 'unica');
    v_quando := case m.frequencia
      when 'semana' then 'de ' || (select string_agg((array['domingo','segunda','terça','quarta','quinta','sexta','sábado'])[x + 1], ', ' order by x) from unnest(m.dias_semana) x)
      when 'intervalo' then 'a cada ' || m.intervalo_dias || ' dias, a partir de ' || to_char(m.inicio, 'DD/MM')
      when 'mensal' then case when coalesce(m.intervalo_dias, 1) > 1 then 'a cada ' || m.intervalo_dias || ' meses' else 'mensal' end
        || ', a partir de ' || to_char(m.inicio, 'DD/MM')
      else 'de uma dose só, para ' || to_char(m.inicio, 'DD/MM')
    end;
    perform public.emitir_alerta(
      p_idoso := new.idoso_id,
      p_tipo := 'remedio_nao_diario',
      p_severidade := 'urgente',
      p_natureza := 'operacional',
      p_titulo := 'Confira já: ' || m.nome || ' não é de todo dia',
      p_ref_tipo := 'medicacao',
      p_ref_id := m.id,
      p_chave := 'nao_diario:' || new.id || ':' || m.id,
      p_texto_familiar := coalesce(v_quem, 'Alguém da rede') || ' confirmou pela foto um remédio '
        || v_quando || ': ' || m.nome || coalesce(' ' || m.dosagem, '') || '. Já está valendo. Compare com a foto.',
      p_familiar_so_admin := true,
      p_excluir := new.enviado_por
    );
  end loop;
  return new;
end $$;

-- Teste (desfeito no fim; se falhar, a migração é recusada) -------------------------
do $$
declare
  adm uuid := gen_random_uuid();
  cui uuid := gen_random_uuid();
  ido uuid;
  doc uuid;
  uni uuid;
  men public.medicacao;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  res text := '';
  r text;
  v text;
  n int;
begin
  begin
    insert into auth.users (id, email) values
      (adm, 'teste-adm-' || adm || '@exemplo.invalid'), (cui, 'teste-cui-' || cui || '@exemplo.invalid');
    insert into public.idoso (nome) values ('Teste mensal') returning id into ido;
    insert into public.vinculo (usuario_id, idoso_id, papel, admin) values
      (adm, ido, 'familiar', true), (cui, ido, 'cuidador', false);

    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    insert into public.documento (idoso_id, nome, arquivo_url, autor_id, envio)
      values (ido, 'receita', ido || '/r', cui, 'receita') returning id into doc;
    perform public.confirmar_leitura(doc, jsonb_build_object('remedios', jsonb_build_array(
      jsonb_build_object('resposta', 'igual', 'acao', 'novo', 'nome', 'Unica', 'novo',
        jsonb_build_object('nome', 'Unica', 'dosagem', '1 g', 'frequencia', 'unica')),
      jsonb_build_object('resposta', 'igual', 'acao', 'novo', 'nome', 'Mensal', 'novo',
        jsonb_build_object('nome', 'Mensal', 'dosagem', '150 mg', 'frequencia', 'mensal', 'inicio', '2026-01-31')))));

    -- A. aviso urgente para os dois, so para o admin
    set local role postgres;
    select count(*) into n from public.alerta a join public.alerta_destinatario d on d.alerta_id = a.id
     where a.idoso_id = ido and a.tipo = 'remedio_nao_diario' and a.severidade = 'urgente' and d.usuario_id = adm;
    res := res || 'urgentes=' || n || ';';

    -- B. dias do mensal, com fim de mes
    select * into men from public.medicacao where idoso_id = ido and nome = 'Mensal';
    res := res || 'mensal=' || public.med_vale_no_dia(men, '2026-02-28') || ' ' || public.med_vale_no_dia(men, '2026-03-28')
      || ' ' || public.med_vale_no_dia(men, '2026-03-31') || ';';

    -- C. "nao dada" mantem pendente; "dada" por quem cuida grava o fim; desmarcar reabre
    select id into uni from public.medicacao where idoso_id = ido and nome = 'Unica';
    set local role authenticated;
    insert into public.registro_medicacao (medicacao_id, data, horario, status, registrado_por)
      values (uni, hoje, '', 'nao_dada', cui);
    select coalesce(fim::text, 'aberta') into v from public.medicacao where id = uni;
    res := res || 'nao_dada=' || v || ';';
    update public.registro_medicacao set status = 'dada' where medicacao_id = uni;
    select (fim = hoje)::text into v from public.medicacao where id = uni;
    res := res || 'dada_fecha_hoje=' || v || ';';
    update public.registro_medicacao set deleted_at = now() where medicacao_id = uni;
    select coalesce(fim::text, 'aberta') into v from public.medicacao where id = uni;
    res := res || 'desmarcou=' || v || ';';

    -- D. o ajuste do sistema nao gera aviso de medicacao atualizada
    set local role postgres;
    select count(*) into n from public.alerta where idoso_id = ido and tipo = 'medicacao_alterada';
    res := res || 'avisos_de_mudanca=' || n || ';';

    raise exception 'RESULTADO_TESTE|%|%', res,
      'urgentes=2;mensal=true false true;nao_dada=aberta;dada_fecha_hoje=true;desmarcou=aberta;avisos_de_mudanca=0;';
  exception when others then
    if sqlerrm like 'RESULTADO_TESTE|%' then r := sqlerrm; else raise; end if;
  end;
  if split_part(r, '|', 2) is distinct from split_part(r, '|', 3) then
    raise exception E'Teste do mensal e dose única FALHOU.\nObtido:   %\nEsperado: %', split_part(r, '|', 2), split_part(r, '|', 3);
  end if;
end $$;
