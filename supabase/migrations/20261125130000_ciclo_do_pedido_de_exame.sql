-- O caminho do pedido de exame até o resultado.
--
--   falta marcar -> marcado (com ou sem o dia) -> feito -> resultado enviado -> concluído
--                    ^------- "não consegui" ------'           (ou cancelado)
--
--  * Com dia, vira uma tarefa na tela Hoje, com o que levar e o preparo.
--  * Qualquer pessoa da rede marca; o administrador é avisado quando não foi ele.
--  * Quem cuida envia o resultado, mas depois de entregue não o abre mais (não vê valores).
--  * Lembretes (3 dias sem marcar; véspera com o preparo) são gerados quando alguém abre o
--    aplicativo, como o aviso de silêncio.

alter table public.pedido_exame add column if not exists tarefa_id uuid references public.tarefa (id) on delete set null;
alter table public.tarefa add column if not exists pedido_exame_id uuid references public.pedido_exame (id) on delete set null;

alter table public.documento drop constraint if exists documento_envio_check;
alter table public.documento add constraint documento_envio_check
  check (envio in ('receita', 'pedido_exame', 'atestado', 'outro', 'resultado_exame'));

-- O resultado entregue deixa de aparecer para quem cuida (inclusive o arquivo no Storage,
-- cuja regra depende desta). Se a família marcar "levar nas consultas", volta a aparecer.
drop policy if exists documento_sel on public.documento;
create policy documento_sel on public.documento for select
  using (
    public.is_member(idoso_id)
    and (
      public.papel_em(idoso_id) <> 'cuidador'
      or levar_consulta
      or (
        autor_id = auth.uid()
        and not exists (select 1 from public.pedido_exame p where p.resultado_documento_id = documento.id)
      )
    )
  );

-- Quando o pedido muda, a tarefa sem resposta e os lembretes antigos saem.
create or replace function public.trg_pedido_exame_mudou()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status or new.dia is distinct from old.dia then
    update alerta_destinatario d set lido_em = now()
      from alerta a
     where a.id = d.alerta_id and a.idoso_id = new.idoso_id and d.lido_em is null
       and (a.chave like 'exame_marcar:' || new.id || ':%' or a.chave like 'exame_vespera:' || new.id || ':%'
            or a.chave like 'exame_sem_dia:' || new.id || ':%');
  end if;
  if new.status is distinct from old.status
     and new.status in ('feito', 'resultado_enviado', 'concluido', 'cancelado')
     and new.tarefa_id is not null then
    update tarefa set deleted_at = now()
     where id = new.tarefa_id and deleted_at is null
       and not exists (select 1 from tarefa_registro r where r.tarefa_id = new.tarefa_id and r.deleted_at is null);
  end if;
  return new;
end $$;

drop trigger if exists trg_pedido_exame_mudou on public.pedido_exame;
create trigger trg_pedido_exame_mudou
  after update on public.pedido_exame
  for each row execute function public.trg_pedido_exame_mudou();

-- A resposta da tarefa do dia ("Fiz" ou "Não consegui") anda o pedido.
create or replace function public.trg_exame_pela_tarefa()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t tarefa;
begin
  select * into t from tarefa where id = new.tarefa_id;
  if t.pedido_exame_id is null then
    return new;
  end if;

  if new.deleted_at is not null then
    -- Desmarcou: volta a estar marcado para o dia da tarefa.
    update pedido_exame set status = 'marcado', dia = t.data
     where id = t.pedido_exame_id and tarefa_id = t.id and status in ('feito', 'falta_marcar');
  elsif new.status = 'feito' then
    update pedido_exame set status = 'feito'
     where id = t.pedido_exame_id and tarefa_id = t.id and status in ('marcado', 'falta_marcar');
  else
    update pedido_exame set status = 'falta_marcar', dia = null, hora = null, falta_desde = now()
     where id = t.pedido_exame_id and tarefa_id = t.id and status in ('marcado', 'feito');
  end if;
  return new;
end $$;

drop trigger if exists trg_exame_pela_tarefa on public.tarefa_registro;
create trigger trg_exame_pela_tarefa
  after insert or update on public.tarefa_registro
  for each row execute function public.trg_exame_pela_tarefa();

create or replace function public.pedido_exame_da_rede(p_pedido uuid)
returns public.pedido_exame language plpgsql security definer set search_path = public as $$
declare
  p pedido_exame;
begin
  select * into p from pedido_exame where id = p_pedido for update;
  if p.id is null or auth.uid() is null or not public.is_member(p.idoso_id) then
    raise exception 'Sem acesso a este pedido.';
  end if;
  return p;
end $$;
revoke all on function public.pedido_exame_da_rede(uuid) from public, anon, authenticated;

-- Marcar. Sem dia = "já está marcado". Dia, hora e laboratório: hora e laboratório opcionais.
create or replace function public.marcar_exame(
  p_pedido uuid, p_dia date default null, p_hora text default null, p_laboratorio text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  p pedido_exame;
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_hora text := nullif(btrim(p_hora), '');
  v_lab text := nullif(btrim(p_laboratorio), '');
  v_nomes text;
  v_tarefa uuid;
  v_quem text;
begin
  p := public.pedido_exame_da_rede(p_pedido);
  if p.status not in ('falta_marcar', 'marcado') then
    raise exception 'Este pedido não está mais para marcar.';
  end if;
  if p_dia is null and p.dia is not null then
    raise exception 'Este exame já tem dia marcado.';
  end if;
  if p_dia is not null and (p_dia < v_hoje or p_dia > v_hoje + 730) then
    raise exception 'O exame precisa ser de hoje em diante (até 2 anos).';
  end if;

  -- A tarefa anterior sem resposta é trocada; a que já foi respondida fica no histórico.
  if p.tarefa_id is not null then
    update tarefa set deleted_at = now()
     where id = p.tarefa_id and deleted_at is null
       and not exists (select 1 from tarefa_registro r where r.tarefa_id = p.tarefa_id and r.deleted_at is null);
  end if;

  v_nomes := array_to_string(p.exames, ', ');
  if p_dia is not null then
    insert into tarefa (idoso_id, titulo, instrucao, frequencia, data, criado_por, pedido_exame_id)
    values (
      p.idoso_id,
      left('Exame: ' || v_nomes, 120),
      left(
        coalesce(v_hora || '. ', '') || coalesce(v_lab || '. ', '')
        || 'Levar o pedido, a carteirinha do plano e o RG. '
        || coalesce('Preparo: ' || p.preparo, 'Confirme o preparo com o laboratório.'), 300),
      'uma_vez', p_dia, v_uid, p.id)
    returning id into v_tarefa;
  end if;

  update pedido_exame
     set status = 'marcado', dia = p_dia, hora = case when p_dia is null then null else v_hora end,
         laboratorio = coalesce(v_lab, laboratorio), tarefa_id = v_tarefa
   where id = p.id;

  if not public.is_admin(p.idoso_id) then
    select coalesce(nullif(u.nome, ''), 'Alguém da rede') into v_quem from usuario u where u.id = v_uid;
    perform public.emitir_alerta(
      p_idoso := p.idoso_id,
      p_tipo := 'exame_marcado',
      p_severidade := case when p_dia is null then 'atencao' else 'info' end,
      p_natureza := 'operacional',
      p_titulo := case when p_dia is null then 'Exame marcado, sem o dia'
                       else 'Exame marcado para ' || to_char(p_dia, 'DD/MM') end,
      p_ref_tipo := 'pedido_exame',
      p_ref_id := p.id,
      p_chave := case when p_dia is null then 'exame_sem_dia:' else 'exame_marcado:' end || p.id || ':' || coalesce(p_dia::text, to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS')),
      p_texto_familiar := coalesce(v_quem, 'Alguém da rede') ||
        case when p_dia is null
          then ' disse que o exame (' || v_nomes || ') já está marcado, sem informar o dia. Sem o dia não há lembrete nem tarefa: se souber, preencha em Pedidos de exame.'
          else ' marcou o exame (' || v_nomes || ') para ' || to_char(p_dia, 'DD/MM/YYYY') || coalesce(' às ' || v_hora, '') || '.'
        end,
      p_familiar_so_admin := true,
      p_excluir := v_uid
    );
  end if;
end $$;
revoke all on function public.marcar_exame(uuid, date, text, text) from public, anon;
grant execute on function public.marcar_exame(uuid, date, text, text) to authenticated;

create or replace function public.exame_feito(p_pedido uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  p pedido_exame;
begin
  p := public.pedido_exame_da_rede(p_pedido);
  if p.status not in ('falta_marcar', 'marcado') then
    raise exception 'Este pedido já andou.';
  end if;
  update pedido_exame set status = 'feito' where id = p.id;
end $$;
revoke all on function public.exame_feito(uuid) from public, anon;
grant execute on function public.exame_feito(uuid) to authenticated;

create or replace function public.entregar_resultado_exame(p_pedido uuid, p_documento uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  p pedido_exame;
  v_uid uuid := auth.uid();
  v_quem text;
begin
  p := public.pedido_exame_da_rede(p_pedido);
  if p.status in ('concluido', 'cancelado') then
    raise exception 'Este pedido já foi encerrado.';
  end if;
  if not exists (
    select 1 from documento
     where id = p_documento and idoso_id = p.idoso_id and autor_id = v_uid
       and envio = 'resultado_exame' and deleted_at is null
  ) then
    raise exception 'Resultado não encontrado.';
  end if;

  update pedido_exame set resultado_documento_id = p_documento, status = 'resultado_enviado' where id = p.id;

  -- O aviso de "documento enviado" dá lugar a este.
  update alerta_destinatario d set lido_em = now()
    from alerta a
   where a.id = d.alerta_id and a.idoso_id = p.idoso_id and d.lido_em is null
     and a.chave = 'documento_enviado:' || p_documento;

  if not public.is_admin(p.idoso_id) then
    select coalesce(nullif(u.nome, ''), 'Alguém da rede') into v_quem from usuario u where u.id = v_uid;
    perform public.emitir_alerta(
      p_idoso := p.idoso_id,
      p_tipo := 'exame_resultado_enviado',
      p_severidade := 'atencao',
      p_natureza := 'operacional',
      p_titulo := 'Resultado de exame enviado',
      p_ref_tipo := 'pedido_exame',
      p_ref_id := p.id,
      p_chave := 'exame_resultado:' || p.id || ':' || p_documento,
      p_texto_familiar := coalesce(v_quem, 'Alguém da rede') || ' enviou o resultado do exame (' || array_to_string(p.exames, ', ') || '). Leia em Pedidos de exame.',
      p_familiar_so_admin := true,
      p_excluir := v_uid
    );
  end if;
end $$;
revoke all on function public.entregar_resultado_exame(uuid, uuid) from public, anon;
grant execute on function public.entregar_resultado_exame(uuid, uuid) to authenticated;

-- Encerrar (resultado lido) ou cancelar: só o administrador.
create or replace function public.encerrar_exame(p_pedido uuid, p_cancelar boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  p pedido_exame;
  v_texto text;
begin
  p := public.pedido_exame_da_rede(p_pedido);
  if not public.is_admin(p.idoso_id) then
    raise exception 'Só o administrador encerra ou cancela um pedido.';
  end if;
  if p.status in ('concluido', 'cancelado') then
    raise exception 'Este pedido já foi encerrado.';
  end if;
  update pedido_exame set status = case when p_cancelar then 'cancelado' else 'concluido' end where id = p.id;

  if p_cancelar then
    v_texto := 'O pedido de exame (' || array_to_string(p.exames, ', ') || ') foi cancelado pela família.';
    perform public.emitir_alerta(
      p_idoso := p.idoso_id,
      p_tipo := 'pedido_exame_cancelado',
      p_severidade := 'atencao',
      p_natureza := 'operacional',
      p_titulo := 'Pedido de exame cancelado',
      p_ref_tipo := 'pedido_exame',
      p_ref_id := p.id,
      p_chave := 'pedido_cancelado:' || p.id,
      p_texto_cuidador := v_texto,
      p_excluir := auth.uid()
    );
  end if;
end $$;
revoke all on function public.encerrar_exame(uuid, boolean) from public, anon;
grant execute on function public.encerrar_exame(uuid, boolean) to authenticated;

create or replace function public.gerar_alertas_exames(p_idoso uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  p pedido_exame;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_nomes text;
  v_texto text;
begin
  if not public.is_member(p_idoso) then
    return;
  end if;

  for p in select * from pedido_exame
            where idoso_id = p_idoso and status = 'falta_marcar' and falta_desde <= now() - interval '3 days'
  loop
    perform public.emitir_alerta(
      p_idoso := p_idoso,
      p_tipo := 'exame_falta_marcar',
      p_severidade := 'atencao',
      p_natureza := 'operacional',
      p_titulo := 'Exame ainda sem marcar',
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
    v_nomes := array_to_string(p.exames, ', ');
    v_texto := 'Amanhã' || coalesce(' às ' || p.hora, '') || ' tem exame: ' || v_nomes || coalesce(' (' || p.laboratorio || ')', '') || '. '
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
revoke all on function public.gerar_alertas_exames(uuid) from public, anon;
grant execute on function public.gerar_alertas_exames(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Teste (desfeito no fim; se falhar, a migração é recusada)
-- ---------------------------------------------------------------------------
do $$
declare
  adm uuid := gen_random_uuid();
  cui uuid := gen_random_uuid();
  ido uuid;
  doc uuid;
  laudo uuid;
  lei uuid;
  ped uuid;
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
    insert into public.idoso (nome) values ('Teste de exame') returning id into ido;
    insert into public.vinculo (usuario_id, idoso_id, papel, admin) values
      (adm, ido, 'familiar', true), (cui, ido, 'cuidador', false);

    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    insert into public.documento (idoso_id, nome, arquivo_url, autor_id, envio)
      values (ido, 'pedido', ido || '/p', cui, 'pedido_exame') returning id into doc;
    lei := public.confirmar_leitura(doc, jsonb_build_object('exames',
      jsonb_build_object('resposta', 'igual', 'nomes', jsonb_build_array('Hemograma'), 'preparo', 'Jejum de 8 horas')));
    select id into ped from public.pedido_exame where leitura_id = lei;

    -- A. tres dias sem marcar: lembrete so para o admin, uma vez
    set local role postgres;
    update public.pedido_exame set falta_desde = now() - interval '4 days' where id = ped;
    set local role authenticated;
    perform public.gerar_alertas_exames(ido);
    perform public.gerar_alertas_exames(ido);
    set local role postgres;
    select count(*) || ' ' || coalesce(string_agg(case d.usuario_id when adm then 'admin' else 'cuidadora' end, ','), '') into v
      from public.alerta_destinatario d join public.alerta a on a.id = d.alerta_id
     where a.idoso_id = ido and a.tipo = 'exame_falta_marcar';
    res := res || 'lembrete_marcar=' || v || ';';

    -- B. "ja esta marcado", sem dia: sem tarefa, admin avisado, lembrete encerrado
    set local role authenticated;
    perform public.marcar_exame(ped);
    set local role postgres;
    select status || ' ' || coalesce(dia::text, 'sem dia') into v from public.pedido_exame where id = ped;
    select count(*) into n from public.tarefa where pedido_exame_id = ped and deleted_at is null;
    res := res || 'marcado=' || v || ';tarefas=' || n || ';';
    select count(*) into n from public.alerta_destinatario d join public.alerta a on a.id = d.alerta_id
     where a.idoso_id = ido and a.tipo = 'exame_falta_marcar' and d.lido_em is null;
    res := res || 'lembrete_aberto=' || n || ';';

    -- C. dizer o dia: uma tarefa com o que levar e o preparo; vespera avisa as duas
    set local role authenticated;
    perform public.marcar_exame(ped, hoje + 1, '07:30', null);
    set local role postgres;
    select tarefa_id into tar from public.pedido_exame where id = ped;
    select (data - hoje) || ' ' || (instrucao like '%RG%Preparo: Jejum de 8 horas%') into v from public.tarefa where id = tar;
    res := res || 'tarefa=' || v || ';';
    set local role authenticated;
    perform public.gerar_alertas_exames(ido);
    set local role postgres;
    select count(*) into n from public.alerta_destinatario d join public.alerta a on a.id = d.alerta_id
     where a.idoso_id = ido and a.tipo = 'exame_vespera';
    res := res || 'vespera_para=' || n || ';';

    -- D. "nao consegui" volta para falta marcar; desmarcar volta para marcado
    set local role authenticated;
    insert into public.tarefa_registro (tarefa_id, data, status, registrado_por) values (tar, hoje, 'nao_consegui', cui);
    select status || ' ' || coalesce(dia::text, 'sem dia') into v from public.pedido_exame where id = ped;
    res := res || 'nao_consegui=' || v || ';';
    update public.tarefa_registro set deleted_at = now(), registrado_por = cui where tarefa_id = tar;
    select status || ' ' || (dia - hoje) into v from public.pedido_exame where id = ped;
    res := res || 'desmarcou=' || v || ';';

    -- E. "fiz": exame feito
    update public.tarefa_registro set status = 'feito', deleted_at = null, registrado_por = cui where tarefa_id = tar;
    select status into v from public.pedido_exame where id = ped;
    res := res || 'fiz=' || v || ';';

    -- F. quem cuida entrega o resultado e deixa de abri-lo; o admin abre
    insert into public.documento (idoso_id, nome, arquivo_url, autor_id, envio)
      values (ido, 'resultado', ido || '/laudo', cui, 'resultado_exame') returning id into laudo;
    set local role authenticated;
    perform public.entregar_resultado_exame(ped, laudo);
    select count(*) into n from public.documento where id = laudo;
    res := res || 'cuidadora_ve_resultado=' || n || ';';
    set local role authenticated;
    begin
      perform public.encerrar_exame(ped, true);
      res := res || 'cuidadora_cancela=permitido;';
    exception when others then res := res || 'cuidadora_cancela=bloqueado;';
    end;
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    select count(*) into n from public.documento where id = laudo;
    select status into v from public.pedido_exame where id = ped;
    res := res || 'admin_ve=' || n || ' ' || v || ';';
    perform public.encerrar_exame(ped);
    select status into v from public.pedido_exame where id = ped;
    res := res || 'fim=' || v || ';';

    -- G. cancelar um pedido marcado tira a tarefa
    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    insert into public.documento (idoso_id, nome, arquivo_url, autor_id, envio)
      values (ido, 'pedido 2', ido || '/p2', cui, 'pedido_exame') returning id into doc;
    lei := public.confirmar_leitura(doc, jsonb_build_object('exames',
      jsonb_build_object('resposta', 'igual', 'nomes', jsonb_build_array('Eco'))));
    select id into ped from public.pedido_exame where leitura_id = lei;
    perform public.marcar_exame(ped, hoje + 10);
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    perform public.decidir_leitura(lei, false);
    set local role postgres;
    select status into v from public.pedido_exame where id = ped;
    select count(*) into n from public.tarefa where pedido_exame_id = ped and deleted_at is null;
    res := res || 'negado=' || v || ' tarefas ' || n || ';';

    raise exception 'RESULTADO_TESTE|%|%', res,
      'lembrete_marcar=1 admin;marcado=marcado sem dia;tarefas=0;lembrete_aberto=0;tarefa=1 true;vespera_para=2;'
      'nao_consegui=falta_marcar sem dia;desmarcou=marcado 1;fiz=feito;cuidadora_ve_resultado=0;cuidadora_cancela=bloqueado;'
      'admin_ve=1 resultado_enviado;fim=concluido;negado=cancelado tarefas 0;';
  exception when others then
    if sqlerrm like 'RESULTADO_TESTE|%' then r := sqlerrm; else raise; end if;
  end;
  if split_part(r, '|', 2) is distinct from split_part(r, '|', 3) then
    raise exception E'Teste do pedido de exame FALHOU.\nObtido:   %\nEsperado: %', split_part(r, '|', 2), split_part(r, '|', 3);
  end if;
end $$;
