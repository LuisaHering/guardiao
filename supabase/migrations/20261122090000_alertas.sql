-- Guardião — alertas e notificações (cards 26 e 28).
-- Idempotente: pode rodar mais de uma vez.
--
-- Regras (docs/modelagem.md, seção 3.12):
--   . estado de leitura POR USUÁRIO (alerta_destinatario.lido_em), nunca global;
--   . o texto de cada destinatário é gerado NA CRIAÇÃO e guardado: não muda se o dado
--     de origem for editado depois, e o lido_em só faz sentido contra um texto estável;
--   . o titular recebe sobre os próprios dados, sem precisar de permissão;
--   . o cuidador recebe o OPERACIONAL (silêncio, alergia nova, mudança de medicação)
--     e não o clínico: a linha divisória é se a informação muda o que a pessoa faz amanhã;
--   . o silêncio vai primeiro para a cuidadora; só escala para o responsável depois;
--   . valor de exame fora da faixa do laudo notifica SEMPRE.
-- Só funções do banco criam alertas: usuários logados não têm INSERT direto.

-- =====================================================================
-- 1. COLUNAS E DEDUPLICAÇÃO
-- =====================================================================

alter table public.alerta add column if not exists titulo text;
alter table public.alerta add column if not exists chave text;

-- Mesma ocorrência não gera dois alertas (ex: o mesmo resultado, o mesmo dia de silêncio).
create unique index if not exists alerta_chave_uq
  on public.alerta (idoso_id, chave) where chave is not null;

-- =====================================================================
-- 2. FORMATAÇÃO (números em pt-BR e texto de faixa)
-- =====================================================================

create or replace function public.fmt_num(n numeric)
returns text language sql immutable as $$
  select replace(regexp_replace(to_char(round(n, 2), 'FM999999990.00'), '\.?0+$', ''), '.', ',')
$$;

create or replace function public.faixa_texto(p_min numeric, p_max numeric)
returns text language sql immutable as $$
  select case
    when p_min is not null and p_max is not null then public.fmt_num(p_min) || ' a ' || public.fmt_num(p_max)
    when p_max is not null then 'até ' || public.fmt_num(p_max)
    when p_min is not null then 'a partir de ' || public.fmt_num(p_min)
    else ''
  end
$$;

-- =====================================================================
-- 3. EMISSÃO: única porta de entrada para criar alertas
--    Cada papel recebe o seu texto; texto nulo = esse papel não recebe.
--    Fica sem EXECUTE para usuários: só as funções abaixo a chamam.
-- =====================================================================

create or replace function public.emitir_alerta(
  p_idoso uuid,
  p_tipo text,
  p_severidade text,
  p_natureza text,
  p_titulo text,
  p_ref_tipo text,
  p_ref_id uuid,
  p_chave text,
  p_texto_familiar text default null,
  p_texto_cuidador text default null,
  p_texto_titular text default null,
  p_familiar_so_admin boolean default false,
  p_excluir uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  insert into alerta (idoso_id, tipo, severidade, natureza, titulo, referencia_tipo, referencia_id, chave)
  values (p_idoso, p_tipo, p_severidade, p_natureza, p_titulo, p_ref_tipo, p_ref_id, p_chave)
  on conflict (idoso_id, chave) where chave is not null do nothing
  returning id into v_id;

  -- Já existia um alerta para esta ocorrência.
  if v_id is null then
    return null;
  end if;

  insert into alerta_destinatario (alerta_id, usuario_id, texto)
  select v_id, s.usuario_id, s.texto
  from (
    select
      vi.usuario_id,
      case
        when vi.papel = 'idoso' then p_texto_titular
        when vi.papel = 'cuidador' then p_texto_cuidador
        when vi.papel = 'familiar' and (not p_familiar_so_admin or vi.admin) then p_texto_familiar
      end as texto
    from vinculo vi
    where vi.idoso_id = p_idoso
      and vi.deleted_at is null
      and vi.usuario_id is distinct from p_excluir
  ) s
  where s.texto is not null;

  return v_id;
end $$;

revoke all on function public.emitir_alerta(uuid, text, text, text, text, text, uuid, text, text, text, text, boolean, uuid) from public, anon, authenticated;

-- =====================================================================
-- 4. EXAME FORA DA FAIXA (clínico): notifica sempre
--    Chamada de dentro de confirmar_exame, logo após gravar os resultados.
-- =====================================================================

create or replace function public.gerar_alertas_exame(p_exame uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  e record;
  r record;
  v_data text;
  v_lado text;
  v_faixa text;
begin
  select * into e from exame where id = p_exame;
  if not found then
    return;
  end if;
  if not public.is_member(e.idoso_id) then
    raise exception 'Sem acesso a este idoso.';
  end if;

  v_data := to_char(e.data at time zone 'America/Sao_Paulo', 'DD/MM/YYYY');

  for r in
    select er.id, er.valor, er.unidade, er.ref_min, er.ref_max, a.nome_canonico
    from exame_resultado er
    join analito a on a.id = er.analito_id
    where er.exame_id = p_exame
      and (
        (er.ref_min is not null and er.valor < er.ref_min)
        or (er.ref_max is not null and er.valor > er.ref_max)
      )
  loop
    v_lado := case when r.ref_min is not null and r.valor < r.ref_min then 'abaixo' else 'acima' end;
    v_faixa := public.faixa_texto(r.ref_min, r.ref_max);

    perform public.emitir_alerta(
      p_idoso := e.idoso_id,
      p_tipo := 'exame_fora_da_faixa',
      p_severidade := 'atencao',
      p_natureza := 'clinico',
      p_titulo := 'Resultado fora da faixa: ' || r.nome_canonico,
      p_ref_tipo := 'exame_resultado',
      p_ref_id := r.id,
      p_chave := 'exame_fora:' || r.id,
      -- dado bruto, para quem age sobre ele
      p_texto_familiar := r.nome_canonico || ': ' || public.fmt_num(r.valor) || ' ' || coalesce(r.unidade, '')
        || ' (faixa do laudo: ' || v_faixa || '), exame de ' || v_data
        || coalesce(' no ' || nullif((select laboratorio from exame where id = p_exame), ''), '') || '. '
        || 'O resultado está ' || v_lado || ' da faixa impressa no laudo.',
      -- formulação acionável e sem susto, para o titular
      p_texto_titular := 'O resultado de ' || r.nome_canonico || ' no seu exame de ' || v_data
        || ' ficou ' || v_lado || ' da faixa de referência do laudo. '
        || 'Vale conversar com seu médico na próxima consulta. Sua família também foi avisada.'
    );
  end loop;
end $$;

revoke all on function public.gerar_alertas_exame(uuid) from public, anon;
grant execute on function public.gerar_alertas_exame(uuid) to authenticated;

-- confirmar_exame passa a chamar a geração de alertas ao final (mesma transação).
create or replace function public.confirmar_exame(
  p_idoso uuid,
  p_tipo text,
  p_laboratorio text,
  p_data timestamptz,
  p_arquivo_url text,
  p_resultados jsonb
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_exame uuid;
  r jsonb;
  v_analito uuid;
  v_unidade text;
begin
  if not public.is_member(p_idoso) then
    raise exception 'Sem acesso a este idoso';
  end if;
  if jsonb_typeof(p_resultados) is distinct from 'array' or jsonb_array_length(p_resultados) = 0 then
    raise exception 'O exame precisa ter ao menos um resultado';
  end if;

  insert into public.exame (idoso_id, tipo, laboratorio, data, arquivo_url, confirmado_por, autor_id)
  values (p_idoso, p_tipo, p_laboratorio, p_data, p_arquivo_url, auth.uid(), auth.uid())
  returning id into v_exame;

  for r in select * from jsonb_array_elements(p_resultados) loop
    v_analito := nullif(r ->> 'analito_id', '')::uuid;

    if v_analito is null then
      insert into public.analito (idoso_id, nome_canonico, unidade_canonica)
      values (p_idoso, r ->> 'nome', r ->> 'unidade')
      on conflict (idoso_id, (lower(nome_canonico))) where fundido_em is null
      do update set nome_canonico = public.analito.nome_canonico
      returning id into v_analito;
    end if;

    select unidade_canonica into v_unidade from public.analito where id = v_analito and idoso_id = p_idoso;
    if not found then
      raise exception 'Analito invalido para este idoso';
    end if;
    if lower(coalesce(v_unidade, '')) is distinct from lower(coalesce(r ->> 'unidade', '')) then
      raise exception 'Unidade do resultado difere da unidade do analito (%): converta antes de confirmar', v_unidade;
    end if;

    insert into public.exame_resultado (
      exame_id, analito_id, valor, unidade, valor_original, unidade_original,
      convertido, ref_min, ref_max, corrigido_manualmente
    ) values (
      v_exame, v_analito,
      (r ->> 'valor')::numeric, r ->> 'unidade',
      nullif(r ->> 'valor_original', '')::numeric, r ->> 'unidade_original',
      coalesce((r ->> 'convertido')::boolean, false),
      nullif(r ->> 'ref_min', '')::numeric, nullif(r ->> 'ref_max', '')::numeric,
      coalesce((r ->> 'corrigido_manualmente')::boolean, false)
    );
  end loop;

  -- Exame confirmado com valor fora da faixa notifica sempre.
  perform public.gerar_alertas_exame(v_exame);

  return v_exame;
end $$;

revoke all on function public.confirmar_exame(uuid, text, text, timestamptz, text, jsonb) from public, anon;
grant execute on function public.confirmar_exame(uuid, text, text, timestamptz, text, jsonb) to authenticated;

-- =====================================================================
-- 5. ALERGIA NOVA e MUDANÇA DE MEDICAÇÃO (operacionais)
--    Quem fez a mudança não é notificado sobre a própria ação.
-- =====================================================================

create or replace function public.trg_alerta_alergia()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_desc text;
begin
  v_desc := new.substancia
    || coalesce(' (' || nullif(new.reacao, '') || ')', '')
    || coalesce(', gravidade ' || new.gravidade, '');

  perform public.emitir_alerta(
    p_idoso := new.idoso_id,
    p_tipo := 'alergia_nova',
    p_severidade := 'atencao',
    p_natureza := 'operacional',
    p_titulo := 'Nova alergia registrada: ' || new.substancia,
    p_ref_tipo := 'alergia',
    p_ref_id := new.id,
    p_chave := 'alergia:' || new.id,
    p_texto_familiar := 'Nova alergia registrada: ' || v_desc || '.',
    p_texto_cuidador := 'Nova alergia registrada: ' || v_desc || '. Confira a lista antes de oferecer alimentos ou remédios.',
    p_texto_titular := 'Uma nova alergia foi registrada no seu perfil: ' || new.substancia || '.',
    p_excluir := auth.uid()
  );
  return new;
end $$;

drop trigger if exists trg_alerta_alergia on public.alergia;
create trigger trg_alerta_alergia
  after insert on public.alergia
  for each row execute function public.trg_alerta_alergia();

create or replace function public.trg_alerta_medicacao()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_desc text;
  v_retirada boolean;
begin
  v_retirada := false;

  -- OLD só existe em UPDATE: só é tocado dentro deste bloco.
  if tg_op = 'UPDATE' then
    if old.nome is not distinct from new.nome
       and old.dosagem is not distinct from new.dosagem
       and old.instrucoes is not distinct from new.instrucoes
       and old.ativo is not distinct from new.ativo
       and old.deleted_at is not distinct from new.deleted_at then
      return new;
    end if;

    v_retirada := (new.deleted_at is not null and old.deleted_at is null)
      or (new.ativo = false and old.ativo = true);
  end if;

  v_desc := new.nome
    || coalesce(' ' || nullif(new.dosagem, ''), '')
    || coalesce(' (' || nullif(new.instrucoes, '') || ')', '');

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

drop trigger if exists trg_alerta_medicacao on public.medicacao;
create trigger trg_alerta_medicacao
  after insert or update on public.medicacao
  for each row execute function public.trg_alerta_medicacao();

-- =====================================================================
-- 6. SILÊNCIO DE REGISTRO (operacional)
--    Sem agendador no banco, é gerado quando alguém abre o app (idempotente por dia).
--    3 dias: vai para a cuidadora. 5 dias: escala também para o(s) responsável(is).
--    Sem nenhum registro anterior não é silêncio (cadastro novo não dispara alarme).
-- =====================================================================

create or replace function public.gerar_alertas_silencio(p_idoso uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ultimo timestamptz;
  v_dias int;
  v_hoje text := to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD');
begin
  if not public.is_member(p_idoso) then
    return;
  end if;

  if not exists (
    select 1 from medicacao where idoso_id = p_idoso and ativo and deleted_at is null
  ) then
    return;
  end if;

  select max(rm.registrado_em) into v_ultimo
  from registro_medicacao rm
  join medicacao m on m.id = rm.medicacao_id
  where m.idoso_id = p_idoso and m.ativo and m.deleted_at is null and rm.deleted_at is null;

  if v_ultimo is null then
    return;
  end if;

  v_dias := floor(extract(epoch from (now() - v_ultimo)) / 86400);

  if v_dias >= 3 then
    perform public.emitir_alerta(
      p_idoso := p_idoso,
      p_tipo := 'silencio_registro',
      p_severidade := 'info',
      p_natureza := 'operacional',
      p_titulo := 'Faz ' || v_dias || ' dias sem registro de medicação',
      p_ref_tipo := 'silencio',
      p_ref_id := null,
      p_chave := 'silencio:' || v_hoje,
      p_texto_cuidador := 'Faz ' || v_dias || ' dias que ninguém registra a medicação. Quando puder, marque o que foi dado.'
    );
  end if;

  if v_dias >= 5 then
    perform public.emitir_alerta(
      p_idoso := p_idoso,
      p_tipo := 'silencio_escalado',
      p_severidade := 'atencao',
      p_natureza := 'operacional',
      p_titulo := 'Faz ' || v_dias || ' dias sem registro de medicação',
      p_ref_tipo := 'silencio',
      p_ref_id := null,
      p_chave := 'silencio_escalado:' || v_hoje,
      p_texto_familiar := 'Faz ' || v_dias || ' dias sem registro de medicação, e o aviso já tinha ido para quem cuida. Isto é sobre o registro, não necessariamente sobre a saúde: pode valer um contato para saber se está tudo bem.',
      p_familiar_so_admin := true
    );
  end if;
end $$;

revoke all on function public.gerar_alertas_silencio(uuid) from public, anon;
grant execute on function public.gerar_alertas_silencio(uuid) to authenticated;

-- =====================================================================
-- 7. PERMISSÕES E INTEGRIDADE DO TEXTO
-- =====================================================================

-- Ninguém cria nem altera alertas diretamente; só as funções acima.
revoke insert, update on public.alerta from authenticated;
revoke insert on public.alerta_destinatario from authenticated;

-- O destinatário só pode mudar o estado de leitura; o texto fica como foi gerado.
create or replace function public.alerta_dest_so_leitura()
returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - 'lido_em') is distinct from (to_jsonb(old) - 'lido_em') then
    raise exception 'Só o estado de leitura de um alerta pode ser alterado.';
  end if;
  return new;
end $$;

drop trigger if exists trg_alerta_dest_so_leitura on public.alerta_destinatario;
create trigger trg_alerta_dest_so_leitura
  before update on public.alerta_destinatario
  for each row execute function public.alerta_dest_so_leitura();
