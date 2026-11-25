-- Apagar o que foi enviado errado: receita, pedido de exame, resultado e outros papéis.
--
--  * Quem enviou apaga. Cada pessoa só apaga o que ela mesma colocou; o administrador, tudo.
--  * Antes de o administrador aceitar: apaga na hora, e a família NÃO é notificada.
--  * Depois do aceite: vira um pedido. O administrador é avisado e nada sai antes de ele
--    confirmar.
--  * Apagar desfaz o que veio daquele arquivo. A tela mostra a lista antes (a simulação roda
--    as mesmas instruções e desfaz, então a lista é a do que vai acontecer de fato).
--  * Nada é removido fisicamente: os registros ficam escondidos, como no resto do sistema.
--
-- Pedido para os familiares é outra coisa: quem pediu apaga sempre, em qualquer situação.

alter table public.documento
  add column if not exists exclusao_pedida_em timestamptz,
  add column if not exists exclusao_pedida_por uuid references public.usuario (id);

alter table public.pedido_exame
  -- qual arquivo de valores veio deste resultado (para sair junto com ele)
  add column if not exists exame_arquivo text,
  -- como o pedido estava antes de o resultado chegar (para voltar se o resultado for apagado)
  add column if not exists status_antes_resultado text
    check (status_antes_resultado in ('falta_marcar', 'marcado', 'feito')),
  -- criado só porque um resultado chegou sem pedido
  add column if not exists avulso boolean not null default false;

update public.pedido_exame p
   set avulso = true
 where not p.avulso and p.leitura_id is null and p.documento_id is null
   and p.resultado_documento_id is not null and p.exames[1] like 'Resultado de %';

update public.pedido_exame p
   set exame_arquivo = e.arquivo_url
  from public.leitura_papel l
  cross join lateral jsonb_array_elements(l.itens) i
  join public.exame e on e.id = (i ->> 'exame_id')::uuid
 where p.exame_arquivo is null and i ->> 'tipo' = 'valores'
   and p.id = (i ->> 'pedido_exame_id')::uuid and l.status <> 'negada';

-- ---------------------------------------------------------------------------
-- Guarda: envio com algo ligado a ele só some pelas funções abaixo
-- ---------------------------------------------------------------------------
create or replace function public.documento_guarda()
returns trigger language plpgsql as $$
declare
  v_modo text := coalesce(current_setting('guardiao.modo', true), '');
begin
  if tg_op = 'UPDATE' and (new.arquivo_url is distinct from old.arquivo_url
                           or new.idoso_id is distinct from old.idoso_id
                           or new.autor_id is distinct from old.autor_id) then
    raise exception 'O arquivo, a pessoa e o autor de um documento não mudam.';
  end if;
  if tg_op = 'INSERT' and new.arquivo_url not like new.idoso_id::text || '/%' then
    raise exception 'Caminho de arquivo inválido.';
  end if;
  if auth.uid() is not null and v_modo <> 'exclusao' then
    if tg_op = 'INSERT' then
      new.exclusao_pedida_em := null;
      new.exclusao_pedida_por := null;
    else
      if new.exclusao_pedida_em is distinct from old.exclusao_pedida_em
         or new.exclusao_pedida_por is distinct from old.exclusao_pedida_por then
        raise exception 'A exclusão é pedida pelo botão de apagar.';
      end if;
      if new.deleted_at is distinct from old.deleted_at and not public.is_admin(new.idoso_id)
         and (exists (select 1 from public.leitura_papel where documento_id = old.id)
              or exists (select 1 from public.pedido_exame
                          where documento_id = old.id or resultado_documento_id = old.id)) then
        raise exception 'Para apagar, use o botão de apagar.';
      end if;
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- As funções que já existiam passam a anotar o que é preciso para desfazer
-- ---------------------------------------------------------------------------
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

  update pedido_exame
     set resultado_documento_id = p_documento, status = 'resultado_enviado',
         status_antes_resultado = case when p.status in ('falta_marcar', 'marcado', 'feito') then p.status
                                       else status_antes_resultado end
   where id = p.id;

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

create or replace function public.registrar_resultado_avulso(p_documento uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  doc documento;
  v_id uuid;
  v_quem text;
begin
  select * into doc from documento where id = p_documento and deleted_at is null for update;
  if doc.id is null or v_uid is null or not public.is_member(doc.idoso_id)
     or doc.autor_id is distinct from v_uid or doc.envio is distinct from 'resultado_exame' then
    raise exception 'Resultado não encontrado.';
  end if;
  if exists (select 1 from pedido_exame where resultado_documento_id = doc.id) then
    raise exception 'Este resultado já está em um exame.';
  end if;

  insert into pedido_exame (idoso_id, exames, status, resultado_documento_id, criado_por, avulso)
  values (doc.idoso_id, array['Resultado de ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM')],
          'resultado_enviado', doc.id, v_uid, true)
  returning id into v_id;

  update alerta_destinatario d set lido_em = now()
    from alerta a
   where a.id = d.alerta_id and a.idoso_id = doc.idoso_id and d.lido_em is null
     and a.chave = 'documento_enviado:' || doc.id;

  if not public.is_admin(doc.idoso_id) then
    select coalesce(nullif(u.nome, ''), 'Alguém da rede') into v_quem from usuario u where u.id = v_uid;
    perform public.emitir_alerta(
      p_idoso := doc.idoso_id,
      p_tipo := 'exame_resultado_enviado',
      p_severidade := 'atencao',
      p_natureza := 'operacional',
      p_titulo := 'Resultado de exame enviado',
      p_ref_tipo := 'pedido_exame',
      p_ref_id := v_id,
      p_chave := 'exame_resultado:' || v_id || ':' || doc.id,
      p_texto_familiar := coalesce(v_quem, 'Alguém da rede') || ' enviou um resultado de exame. Leia em Pedidos e resultados.',
      p_familiar_so_admin := true,
      p_excluir := v_uid
    );
  end if;
  return v_id;
end $$;

create or replace function public.confirmar_valores(p_pedido uuid, p_exame jsonb, p_resultados jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  p pedido_exame;
  v_uid uuid := auth.uid();
  v_arquivo text := nullif(p_exame ->> 'arquivo', '');
  v_data timestamptz := nullif(p_exame ->> 'data', '')::timestamptz;
  v_tipo text := nullif(btrim(p_exame ->> 'tipo'), '');
  v_exame uuid;
  v_leitura uuid;
  v_n int;
  v_quem text;
begin
  p := public.pedido_exame_da_rede(p_pedido);
  if p.status <> 'resultado_enviado' or p.resultado_documento_id is null then
    raise exception 'Não há resultado esperando conferência.';
  end if;
  if v_data is null then
    raise exception 'Falta o dia da coleta.';
  end if;
  if v_arquivo is null or v_arquivo not like p.idoso_id::text || '/%' then
    raise exception 'Caminho de arquivo inválido.';
  end if;
  v_n := coalesce(jsonb_array_length(p_resultados), 0);
  if v_n < 1 or v_n > 200 then
    raise exception 'O exame precisa ter de 1 a 200 resultados.';
  end if;

  v_exame := public.confirmar_exame(p.idoso_id, v_tipo, nullif(btrim(p_exame ->> 'laboratorio'), ''), v_data, v_arquivo, p_resultados);
  update pedido_exame set status = 'concluido', exame_arquivo = v_arquivo where id = p.id;

  if not public.is_admin(p.idoso_id) then
    insert into leitura_papel (idoso_id, documento_id, enviado_por, itens, status)
    values (p.idoso_id, p.resultado_documento_id, v_uid,
      jsonb_build_array(jsonb_build_object(
        'tipo', 'valores', 'resultado', 'entrou', 'nome', coalesce(v_tipo, array_to_string(p.exames, ', ')),
        'texto', v_n || case when v_n = 1 then ' valor' else ' valores' end,
        'exame_id', v_exame, 'pedido_exame_id', p.id)),
      'pendente')
    returning id into v_leitura;

    select coalesce(nullif(u.nome, ''), 'Alguém da rede') into v_quem from usuario u where u.id = v_uid;
    perform public.emitir_alerta(
      p_idoso := p.idoso_id,
      p_tipo := 'leitura_papel',
      p_severidade := 'atencao',
      p_natureza := 'operacional',
      p_titulo := 'Valores de exame para revisar',
      p_ref_tipo := 'documento',
      p_ref_id := p.resultado_documento_id,
      p_chave := 'leitura:' || v_leitura,
      p_texto_familiar := coalesce(v_quem, 'Alguém da rede') || ' conferiu os valores de um exame. Já estão valendo. Veja o arquivo e aceite ou negue.',
      p_familiar_so_admin := true,
      p_excluir := v_uid
    );
  end if;
  return v_exame;
end $$;

-- Ganha o arquivo dos valores lidos. Quem chama sem ele continua funcionando.
drop function if exists public.encerrar_exame(uuid, boolean);
create or replace function public.encerrar_exame(p_pedido uuid, p_cancelar boolean default false, p_arquivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  p pedido_exame;
  v_texto text;
begin
  p := public.pedido_exame_da_rede(p_pedido);
  if p_cancelar and not public.is_admin(p.idoso_id) then
    raise exception 'Só o administrador cancela um pedido.';
  end if;
  if not p_cancelar and not (public.is_admin(p.idoso_id) or public.papel_em(p.idoso_id) = 'familiar') then
    raise exception 'Só a família conclui um exame por aqui.';
  end if;
  if p.status in ('concluido', 'cancelado') then
    raise exception 'Este pedido já foi encerrado.';
  end if;
  if p_arquivo is not null and p_arquivo not like p.idoso_id::text || '/%' then
    raise exception 'Caminho de arquivo inválido.';
  end if;
  update pedido_exame
     set status = case when p_cancelar then 'cancelado' else 'concluido' end,
         exame_arquivo = coalesce(p_arquivo, exame_arquivo)
   where id = p.id;

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
revoke all on function public.encerrar_exame(uuid, boolean, text) from public, anon;
grant execute on function public.encerrar_exame(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Apagar
-- ---------------------------------------------------------------------------
create or replace function public.marcar_avisos_lidos(p_idoso uuid, p_chaves text[])
returns void language sql security definer set search_path = public as $$
  update alerta_destinatario d set lido_em = now()
    from alerta a
   where a.id = d.alerta_id and a.idoso_id = p_idoso and d.lido_em is null
     and a.chave like any (p_chaves);
$$;
revoke all on function public.marcar_avisos_lidos(uuid, text[]) from public, anon, authenticated;

-- "Depois do aceite": a família já aceitou, corrigiu, guardou ou concluiu a partir deste papel.
create or replace function public.envio_aceito(p_documento uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    exists (select 1 from leitura_papel where documento_id = p_documento and status = 'aceita')
    -- remédio da foto que o administrador aprovou pela tela de Medicação
    or exists (
      select 1 from leitura_papel l
       cross join lateral jsonb_array_elements(l.itens) i
        join medicacao m on m.id = nullif(i ->> 'medicacao_id', '')::uuid
       where l.documento_id = p_documento and l.status <> 'negada'
         and i ->> 'tipo' = 'remedio' and i ->> 'resultado' = 'entrou'
         and m.confirmado and m.recusado_em is null and m.deleted_at is null)
    or exists (
      select 1 from leitura_papel l
       cross join lateral jsonb_array_elements(l.itens) i
        join medicacao_pedido p on p.id = nullif(i ->> 'pedido_id', '')::uuid
       where l.documento_id = p_documento and l.status <> 'negada' and p.status = 'aprovado')
    or exists (select 1 from remedio_pendente where documento_id = p_documento and status = 'cadastrado')
    -- exame concluído a partir dele, sem revisão esperando o administrador
    or (
      exists (select 1 from pedido_exame
               where (resultado_documento_id = p_documento or documento_id = p_documento) and status = 'concluido')
      and not exists (select 1 from leitura_papel where documento_id = p_documento and status = 'pendente'))
    or exists (select 1 from documento where id = p_documento and (guardado_em is not null or levar_consulta));
$$;
revoke all on function public.envio_aceito(uuid) from public, anon, authenticated;

-- Faz a exclusão e conta o que fez, em frases para a tela. Só as funções abaixo chamam.
create or replace function public.apagar_envio_executar(p_documento uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_modo text := coalesce(current_setting('guardiao.modo', true), '');
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  doc documento;
  l leitura_papel;
  it jsonb;
  m medicacao;
  pm medicacao_pedido;
  pe pedido_exame;
  v_efeitos text[] := array[]::text[];
  v_mexeu boolean := false;
  v_nome text;
  v_nomes text;
  v_doses boolean;
  v_dose boolean;
  v_hora boolean;
  v_exames uuid[];
  v_volta text;
  v_receitas uuid[] := array[]::uuid[];
begin
  select * into doc from documento where id = p_documento and deleted_at is null for update;
  if doc.id is null then
    raise exception 'Isto já foi apagado.';
  end if;
  v_efeitos := array_append(v_efeitos,
    case when doc.tipo = 'application/pdf' then 'O PDF sai do aplicativo.' else 'A foto sai do aplicativo.' end);

  -- 1. Remédios que vieram desta foto -------------------------------------------
  for l in select * from leitura_papel where documento_id = doc.id and status <> 'negada' order by created_at loop
    if l.receita_id is not null then
      v_receitas := array_append(v_receitas, l.receita_id);
    end if;
    for it in select * from jsonb_array_elements(l.itens) loop
      continue when it ->> 'tipo' <> 'remedio';
      select * into m from medicacao where id = nullif(it ->> 'medicacao_id', '')::uuid and idoso_id = doc.idoso_id;
      continue when m.id is null or m.deleted_at is not null or m.recusado_em is not null;
      v_nome := concat_ws(' ', m.nome, nullif(m.dosagem, ''));

      if it ->> 'resultado' = 'entrou' then
        continue when not m.ativo;
        v_doses := exists (select 1 from registro_medicacao
                            where medicacao_id = m.id and status = 'dada' and deleted_at is null);
        -- 'negacao': passa pela guarda de revisão e não gera o aviso genérico.
        perform set_config('guardiao.modo', 'negacao', true);
        if m.confirmado or v_doses then
          update medicacao set ativo = false where id = m.id;
        else
          update medicacao set deleted_at = now() where id = m.id;
        end if;
        perform set_config('guardiao.modo', v_modo, true);
        update medicacao_pedido set status = 'recusado', decidido_por = v_uid, decidido_em = now()
         where medicacao_id = m.id and status = 'pendente';
        v_mexeu := true;
        v_efeitos := array_append(v_efeitos, 'Sai da lista de remédios: ' || v_nome ||
          case when v_doses then ' (as doses já marcadas ficam no histórico).' else '.' end);

      elsif it ->> 'resultado' = 'mudou' then
        select * into pm from medicacao_pedido
         where id = nullif(it ->> 'pedido_id', '')::uuid and idoso_id = doc.idoso_id;
        continue when pm.id is null or pm.status = 'recusado' or pm.antes is null;
        -- Foto só muda dose e horário. O que foi mudado depois fica como está.
        v_dose := coalesce(pm.dados ? 'dosagem' and m.dosagem is not distinct from nullif(pm.dados ->> 'dosagem', '')
                  and m.dosagem is distinct from (pm.antes ->> 'dosagem'), false);
        v_hora := coalesce(pm.dados ? 'horarios' and to_jsonb(m.horarios) = pm.dados -> 'horarios'
                  and to_jsonb(m.horarios) is distinct from pm.antes -> 'horarios', false);
        if v_dose or v_hora then
          perform set_config('guardiao.modo', 'negacao', true);
          update medicacao set
            dosagem = case when v_dose then pm.antes ->> 'dosagem' else dosagem end,
            horarios = case when v_hora then array(select jsonb_array_elements_text(pm.antes -> 'horarios')) else horarios end
          where id = m.id;
          perform set_config('guardiao.modo', v_modo, true);
          v_mexeu := true;
          v_efeitos := array_append(v_efeitos, m.nome || ' volta a ser como antes' ||
            case when v_dose then coalesce(' (' || nullif(pm.antes ->> 'dosagem', '') || ')', '') else ' (no horário)' end || '.');
        else
          v_efeitos := array_append(v_efeitos, m.nome || ' foi mudado de novo depois desta foto e fica como está.');
        end if;
        update medicacao_pedido set status = 'recusado', decidido_por = v_uid, decidido_em = now()
         where id = pm.id and status = 'pendente';
      else
        continue;
      end if;

      update alerta_destinatario d set lido_em = now()
        from alerta a
       where a.id = d.alerta_id and a.idoso_id = doc.idoso_id and d.lido_em is null
         and a.referencia_id in (m.id, nullif(it ->> 'pedido_id', '')::uuid)
         and a.tipo in ('medicacao_a_confirmar', 'medicacao_alterada', 'medicacao_pedido', 'remedio_nao_diario');
      perform public.marcar_avisos_lidos(doc.idoso_id, array['medicacao_confirmar:' || m.id,
        'medicacao_pedido:' || coalesce(it ->> 'pedido_id', '-')]);
    end loop;

    update leitura_papel set status = 'negada', decidido_por = v_uid, decidido_em = now() where id = l.id;
    perform public.marcar_avisos_lidos(doc.idoso_id, array['leitura:' || l.id, 'nao_diario:' || l.id || ':%']);
  end loop;

  select string_agg(nome, ', ' order by nome) into v_nomes
    from remedio_pendente where documento_id = doc.id and status = 'esperando';
  if v_nomes is not null then
    perform public.marcar_avisos_lidos(doc.idoso_id, array(
      select 'remedio_pede:' || id || ':%' from remedio_pendente where documento_id = doc.id and status = 'esperando'));
    update remedio_pendente set status = 'descartado', resolvido_por = v_uid, resolvido_em = now()
     where documento_id = doc.id and status = 'esperando';
    v_efeitos := array_append(v_efeitos, 'Sai de "Esperando a família": ' || v_nomes || '.');
  end if;

  update receita r set deleted_at = now()
   where r.id = any (v_receitas) and r.deleted_at is null
     and not exists (select 1 from medicacao x where x.receita_id = r.id and x.ativo and x.deleted_at is null);

  -- 2. Era a foto de um pedido de exame -----------------------------------------
  for pe in select * from pedido_exame where documento_id = doc.id and status <> 'cancelado' for update loop
    v_nomes := array_to_string(pe.exames, ', ');
    if pe.resultado_documento_id is null and pe.status <> 'concluido' then
      update pedido_exame set status = 'cancelado' where id = pe.id;
      update alerta_destinatario d set lido_em = now()
        from alerta a
       where a.id = d.alerta_id and a.idoso_id = doc.idoso_id and d.lido_em is null and a.referencia_id = pe.id;
      v_efeitos := array_append(v_efeitos, 'O pedido de exame (' || v_nomes || ') sai da lista' ||
        case when pe.tarefa_id is not null then ', junto com a tarefa do dia e o lembrete.' else '.' end);
    else
      update pedido_exame set documento_id = null where id = pe.id;
      v_efeitos := array_append(v_efeitos,
        'O exame (' || v_nomes || ') continua em Exames, porque já tem resultado ou já foi concluído. Sai só a foto do pedido.');
    end if;
  end loop;

  -- 3. Era um resultado ---------------------------------------------------------
  for pe in select * from pedido_exame where resultado_documento_id = doc.id for update loop
    v_nomes := array_to_string(pe.exames, ', ');
    v_exames := array(
      select e.id from exame e
       where e.idoso_id = doc.idoso_id and e.deleted_at is null
         and (e.arquivo_url = pe.exame_arquivo
              or e.id in (select (i ->> 'exame_id')::uuid
                            from leitura_papel lp cross join lateral jsonb_array_elements(lp.itens) i
                           where lp.documento_id = doc.id and i ->> 'exame_id' is not null)));
    if cardinality(v_exames) > 0 then
      perform public.marcar_avisos_lidos(doc.idoso_id,
        array(select 'exame_fora:' || r.id from exame_resultado r where r.exame_id = any (v_exames)));
      update exame set deleted_at = now() where id = any (v_exames);
      v_efeitos := array_append(v_efeitos, 'Os valores deste resultado saem de Resultados e das tendências.');
    elsif pe.status = 'concluido' then
      v_efeitos := array_append(v_efeitos,
        'Se os valores deste exame já foram digitados, eles continuam em Resultados: apague por lá.');
    end if;

    if exists (select 1 from pedido_familia where pedido_exame_id = pe.id and status in ('aberto', 'assumido')) then
      perform public.marcar_avisos_lidos(doc.idoso_id,
        array(select 'pedido_familia:' || f.id from pedido_familia f
               where f.pedido_exame_id = pe.id and f.status in ('aberto', 'assumido')));
      update pedido_familia set status = 'cancelado' where pedido_exame_id = pe.id and status in ('aberto', 'assumido');
      v_efeitos := array_append(v_efeitos, 'O pedido para alguém conferir os valores é cancelado.');
    end if;

    if pe.avulso or pe.status = 'cancelado' then
      update pedido_exame set resultado_documento_id = null, exame_arquivo = null, status = 'cancelado' where id = pe.id;
      if pe.status <> 'cancelado' then
        v_efeitos := array_append(v_efeitos, 'O resultado sai da lista de exames.');
      end if;
    else
      v_volta := coalesce(pe.status_antes_resultado, case when pe.dia > v_hoje then 'marcado' else 'feito' end);
      update pedido_exame
         set resultado_documento_id = null, exame_arquivo = null, status_antes_resultado = null, status = v_volta
       where id = pe.id;
      -- A tarefa do dia saiu quando o resultado chegou: volta junto, se ninguém respondeu.
      if v_volta = 'marcado' and pe.tarefa_id is not null then
        update tarefa set deleted_at = null
         where id = pe.tarefa_id
           and not exists (select 1 from tarefa_registro r where r.tarefa_id = pe.tarefa_id and r.deleted_at is null);
      end if;
      v_efeitos := array_append(v_efeitos, 'O exame (' || v_nomes || ') continua na lista, como ' ||
        case v_volta when 'falta_marcar' then '"falta marcar"' when 'marcado' then '"marcado"' else '"feito, falta o resultado"' end || '.');
    end if;
    update alerta_destinatario d set lido_em = now()
      from alerta a
     where a.id = d.alerta_id and a.idoso_id = doc.idoso_id and d.lido_em is null
       and a.chave like 'exame_resultado:%:' || doc.id;
  end loop;

  -- 4. O arquivo ----------------------------------------------------------------
  update alerta_destinatario d set lido_em = now()
    from alerta a
   where a.id = d.alerta_id and a.idoso_id = doc.idoso_id and d.lido_em is null
     and a.referencia_tipo = 'documento' and a.referencia_id = doc.id;
  perform set_config('guardiao.modo', 'exclusao', true);
  update documento set deleted_at = now(), exclusao_pedida_em = null, exclusao_pedida_por = null where id = doc.id;
  perform set_config('guardiao.modo', v_modo, true);

  return jsonb_build_object('efeitos', to_jsonb(v_efeitos), 'mexeu_remedios', v_mexeu);
end $$;
revoke all on function public.apagar_envio_executar(uuid) from public, anon, authenticated;

-- Conta a quem cuida (e, se for o caso, a quem enviou) o que saiu. A família não entra aqui.
create or replace function public.avisar_exclusao(
  p_idoso uuid, p_autor uuid, p_doc uuid, p_tipo text, p_titulo text, p_texto text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_para uuid[];
  v_alerta uuid;
begin
  v_para := array(
    select v.usuario_id from vinculo v
     where v.idoso_id = p_idoso and v.deleted_at is null
       and v.usuario_id is distinct from auth.uid()
       and (v.papel = 'cuidador' or v.usuario_id = p_autor));
  if coalesce(cardinality(v_para), 0) = 0 then
    return;
  end if;
  insert into alerta (idoso_id, tipo, severidade, natureza, titulo, referencia_tipo, referencia_id, chave)
  values (p_idoso, p_tipo, 'atencao', 'operacional', p_titulo, 'documento', p_doc,
          p_tipo || ':' || p_doc || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'))
  returning id into v_alerta;
  insert into alerta_destinatario (alerta_id, usuario_id, texto)
  select v_alerta, x, left(p_texto, 900) from unnest(v_para) x;
end $$;
revoke all on function public.avisar_exclusao(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;

create or replace function public.frases(p jsonb)
returns text language sql immutable as $$
  select string_agg(x, ' ' order by n) from jsonb_array_elements_text(p) with ordinality t(x, n);
$$;

-- p_simular = true só responde o que aconteceria.
-- Devolve { efeitos: [...], precisa_confirmar: bool }.
create or replace function public.apagar_envio(p_documento uuid, p_simular boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_modo text := coalesce(current_setting('guardiao.modo', true), '');
  doc documento;
  v_admin boolean;
  v_confirmar boolean;
  v_feito jsonb;
  v_quem text;
begin
  select * into doc from documento where id = p_documento and deleted_at is null for update;
  if doc.id is null then
    raise exception 'Isto já foi apagado.';
  end if;
  if v_uid is null or not public.is_member(doc.idoso_id) or doc.envio is null then
    raise exception 'Sem acesso a este envio.';
  end if;
  v_admin := public.is_admin(doc.idoso_id);
  if not v_admin and doc.autor_id is distinct from v_uid then
    raise exception 'Só quem enviou pode apagar.';
  end if;
  v_confirmar := not v_admin and public.envio_aceito(doc.id);

  if not p_simular and v_confirmar and doc.exclusao_pedida_em is not null then
    raise exception 'A exclusão já foi pedida. Falta a família confirmar.';
  end if;

  -- Roda a exclusão; se for só para mostrar, ou se precisar de confirmação, desfaz.
  begin
    v_feito := public.apagar_envio_executar(doc.id);
    if p_simular or v_confirmar then
      raise exception 'SIMULACAO';
    end if;
  exception when others then
    if sqlerrm <> 'SIMULACAO' then
      raise;
    end if;
  end;

  if not p_simular then
    if v_confirmar then
      perform set_config('guardiao.modo', 'exclusao', true);
      update documento set exclusao_pedida_em = now(), exclusao_pedida_por = v_uid where id = doc.id;
      perform set_config('guardiao.modo', v_modo, true);
      select coalesce(nullif(u.nome, ''), 'Alguém da rede') into v_quem from usuario u where u.id = v_uid;
      perform public.emitir_alerta(
        p_idoso := doc.idoso_id,
        p_tipo := 'pedido_de_exclusao',
        p_severidade := 'atencao',
        p_natureza := 'operacional',
        p_titulo := 'Pedido para apagar: ' || doc.nome,
        p_ref_tipo := 'documento',
        p_ref_id := doc.id,
        p_chave := 'exclusao:' || doc.id || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'),
        p_texto_familiar := coalesce(v_quem, 'Alguém da rede') || ' quer apagar "' || doc.nome
          || '", que você já tinha aceitado. Nada foi apagado: confirme ou não.',
        p_familiar_so_admin := true,
        p_excluir := v_uid
      );
    elsif doc.autor_id is distinct from v_uid then
      -- O administrador apagando o envio de outra pessoa: ela precisa saber.
      perform public.avisar_exclusao(doc.idoso_id, doc.autor_id, doc.id, 'envio_apagado',
        'A família apagou: ' || doc.nome,
        public.frases(v_feito -> 'efeitos') || ' Confira a lista de hoje antes da próxima dose.');
    elsif (v_feito ->> 'mexeu_remedios')::boolean and public.papel_em(doc.idoso_id) <> 'cuidador' then
      -- Sem avisar a família; mas quem cuida precisa saber se a lista de remédios mudou.
      perform public.avisar_exclusao(doc.idoso_id, null, doc.id, 'envio_apagado',
        'A lista de remédios mudou', public.frases(v_feito -> 'efeitos') || ' Confira antes da próxima dose.');
    end if;
  end if;

  return jsonb_build_object('efeitos', v_feito -> 'efeitos', 'precisa_confirmar', v_confirmar);
end $$;
revoke all on function public.apagar_envio(uuid, boolean) from public, anon;
grant execute on function public.apagar_envio(uuid, boolean) to authenticated;

create or replace function public.decidir_exclusao(p_documento uuid, p_confirmar boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_modo text := coalesce(current_setting('guardiao.modo', true), '');
  doc documento;
  v_feito jsonb;
begin
  select * into doc from documento where id = p_documento and deleted_at is null for update;
  if doc.id is null or not public.is_admin(doc.idoso_id) then
    raise exception 'Só o administrador decide esta exclusão.';
  end if;
  if doc.exclusao_pedida_em is null then
    raise exception 'Não há exclusão esperando confirmação.';
  end if;
  perform public.marcar_avisos_lidos(doc.idoso_id, array['exclusao:' || doc.id || ':%']);

  if p_confirmar then
    v_feito := public.apagar_envio_executar(doc.id);
    perform public.avisar_exclusao(doc.idoso_id, doc.exclusao_pedida_por, doc.id, 'exclusao_confirmada',
      'Apagado: ' || doc.nome,
      'A família confirmou. ' || public.frases(v_feito -> 'efeitos')
        || case when (v_feito ->> 'mexeu_remedios')::boolean then ' Confira a lista de hoje antes da próxima dose.' else '' end);
  else
    perform set_config('guardiao.modo', 'exclusao', true);
    update documento set exclusao_pedida_em = null, exclusao_pedida_por = null where id = doc.id;
    perform set_config('guardiao.modo', v_modo, true);
    perform public.avisar_pessoas_do_documento(doc.idoso_id, doc.exclusao_pedida_por, doc.id,
      'Não foi apagado: ' || doc.nome, 'A família decidiu não apagar "' || doc.nome || '". Continua valendo como estava.');
  end if;
end $$;
revoke all on function public.decidir_exclusao(uuid, boolean) from public, anon;
grant execute on function public.decidir_exclusao(uuid, boolean) to authenticated;

-- Aviso só para quem pediu a exclusão.
create or replace function public.avisar_pessoas_do_documento(
  p_idoso uuid, p_pessoa uuid, p_doc uuid, p_titulo text, p_texto text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_alerta uuid;
begin
  insert into alerta (idoso_id, tipo, severidade, natureza, titulo, referencia_tipo, referencia_id, chave)
  values (p_idoso, 'exclusao_recusada', 'atencao', 'operacional', p_titulo, 'documento', p_doc,
          'exclusao_recusada:' || p_doc || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'))
  returning id into v_alerta;
  insert into alerta_destinatario (alerta_id, usuario_id, texto)
  select v_alerta, v.usuario_id, p_texto from vinculo v
   where v.idoso_id = p_idoso and v.deleted_at is null and v.usuario_id = p_pessoa;
end $$;
revoke all on function public.avisar_pessoas_do_documento(uuid, uuid, uuid, text, text) from public, anon, authenticated;

create or replace function public.desistir_exclusao(p_documento uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_modo text := coalesce(current_setting('guardiao.modo', true), '');
  doc documento;
begin
  select * into doc from documento where id = p_documento and deleted_at is null for update;
  if doc.id is null or doc.exclusao_pedida_em is null or doc.exclusao_pedida_por is distinct from auth.uid() then
    raise exception 'Não há pedido seu esperando confirmação.';
  end if;
  perform set_config('guardiao.modo', 'exclusao', true);
  update documento set exclusao_pedida_em = null, exclusao_pedida_por = null where id = doc.id;
  perform set_config('guardiao.modo', v_modo, true);
  perform public.marcar_avisos_lidos(doc.idoso_id, array['exclusao:' || doc.id || ':%']);
end $$;
revoke all on function public.desistir_exclusao(uuid) from public, anon;
grant execute on function public.desistir_exclusao(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Pedido para os familiares: quem pediu apaga sempre
-- ---------------------------------------------------------------------------
alter table public.pedido_familia add column if not exists deleted_at timestamptz;

drop policy if exists pedido_familia_sel on public.pedido_familia;
create policy pedido_familia_sel on public.pedido_familia for select
  using (
    deleted_at is null
    and public.is_member(idoso_id)
    and (
      autor_id = auth.uid()
      or destinatario_id = auth.uid()
      or public.is_admin(idoso_id)
      or (destinatario_id is null and public.papel_em(idoso_id) = 'familiar')
    )
  );

create or replace function public.apagar_pedido_familia(p_pedido uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  p pedido_familia;
  v_uid uuid := auth.uid();
begin
  select * into p from pedido_familia where id = p_pedido and deleted_at is null for update;
  if p.id is null or v_uid is null or not public.is_member(p.idoso_id) then
    raise exception 'Sem acesso a este pedido.';
  end if;
  if p.autor_id <> v_uid and not public.is_admin(p.idoso_id) then
    raise exception 'Só quem pediu ou o administrador apaga.';
  end if;
  update pedido_familia
     set deleted_at = now(), status = case when status in ('aberto', 'assumido') then 'cancelado' else status end
   where id = p.id;
  update alerta_destinatario d set lido_em = now()
    from alerta a
   where a.id = d.alerta_id and a.idoso_id = p.idoso_id and d.lido_em is null
     and a.referencia_tipo = 'pedido_familia' and a.referencia_id = p.id;
end $$;
revoke all on function public.apagar_pedido_familia(uuid) from public, anon;
grant execute on function public.apagar_pedido_familia(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Teste (desfeito no fim; se falhar, a migração é recusada)
-- ---------------------------------------------------------------------------
do $$
declare
  adm uuid := gen_random_uuid();
  cui uuid := gen_random_uuid();
  fam uuid := gen_random_uuid();
  ido uuid;
  base uuid;
  d1 uuid;
  d2 uuid;
  d3 uuid;
  d4 uuid;
  lei uuid;
  lei2 uuid;
  ped uuid;
  ped2 uuid;
  pf uuid;
  pf2 uuid;
  exa uuid;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  dados jsonb;
  j jsonb;
  res text := '';
  r text;
  v text;
  n int;
  n2 int;
  valores jsonb := jsonb_build_array(jsonb_build_object('nome', 'Glicose', 'valor', 130, 'unidade', 'mg/dL', 'ref_max', 99));
begin
  begin
    insert into auth.users (id, email) values
      (adm, 'teste-adm-' || adm || '@exemplo.invalid'), (cui, 'teste-cui-' || cui || '@exemplo.invalid'),
      (fam, 'teste-fam-' || fam || '@exemplo.invalid');
    insert into public.idoso (nome) values ('Teste de apagar') returning id into ido;
    insert into public.vinculo (usuario_id, idoso_id, papel, admin) values
      (adm, ido, 'familiar', true), (cui, ido, 'cuidador', false), (fam, ido, 'familiar', false);

    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    insert into public.medicacao (idoso_id, nome, dosagem, horarios) values (ido, 'Base', '50 mg', array['manha'])
      returning id into base;

    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    insert into public.documento (idoso_id, nome, arquivo_url, autor_id, envio)
      values (ido, 'receita 1', ido || '/r1', cui, 'receita') returning id into d1;
    dados := jsonb_build_object(
      'receita', jsonb_build_object('arquivo', ido || '/r1.jpg'),
      'remedios', jsonb_build_array(
        jsonb_build_object('resposta', 'igual', 'acao', 'novo', 'nome', 'Novo', 'novo',
          jsonb_build_object('nome', 'Novo', 'dosagem', '20 mg', 'horarios', jsonb_build_array('noite'))),
        jsonb_build_object('resposta', 'igual', 'acao', 'novo', 'nome', 'Dado', 'novo',
          jsonb_build_object('nome', 'Dado', 'dosagem', '5 mg', 'horarios', jsonb_build_array('manha'))),
        jsonb_build_object('resposta', 'igual', 'acao', 'mudar', 'nome', 'Base', 'medicacao_id', base,
          'dados', jsonb_build_object('dosagem', '100 mg')),
        jsonb_build_object('resposta', 'igual', 'acao', 'duvida', 'nome', 'Dúvida')),
      'exames', jsonb_build_object('resposta', 'igual', 'nomes', jsonb_build_array('Hemograma')));
    lei := public.confirmar_leitura(d1, dados);
    insert into public.registro_medicacao (medicacao_id, data, status)
      select id, hoje, 'dada' from public.medicacao where idoso_id = ido and nome = 'Dado';

    -- A. apagar direto pela tabela nao pode; outra pessoa tambem nao
    begin
      update public.documento set deleted_at = now() where id = d1;
      res := res || 'direto=permitido;';
    exception when others then res := res || 'direto=bloqueado;';
    end;
    perform set_config('request.jwt.claims', json_build_object('sub', fam, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', fam::text, true);
    set local role authenticated;
    begin
      perform public.apagar_envio(d1);
      res := res || 'outra_pessoa=permitido;';
    exception when others then res := res || 'outra_pessoa=bloqueado;';
    end;

    -- B. a simulacao nao muda nada
    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    j := public.apagar_envio(d1, true);
    select string_agg(nome || ' ' || dosagem, ',' order by nome) into v from public.medicacao where idoso_id = ido and ativo and deleted_at is null;
    select count(*) into n from public.documento where id = d1 and deleted_at is null;
    res := res || 'simula=' || (j ->> 'precisa_confirmar') || ' ' || jsonb_array_length(j -> 'efeitos') || ' ' || v || ' ' || n || ';';

    -- C. antes do aceite: apaga na hora, e a familia nao recebe nada
    set local role postgres;
    select count(*) into n from public.alerta_destinatario d join public.alerta a on a.id = d.alerta_id
     where a.idoso_id = ido and d.usuario_id in (adm, fam);
    set local role authenticated;
    perform public.apagar_envio(d1);
    set local role postgres;
    select count(*) - n into n from public.alerta_destinatario d join public.alerta a on a.id = d.alerta_id
     where a.idoso_id = ido and d.usuario_id in (adm, fam);
    select count(*) into n2 from public.alerta_destinatario d join public.alerta a on a.id = d.alerta_id
     where a.idoso_id = ido and d.usuario_id = adm and d.lido_em is null;
    res := res || 'familia_avisos_novos=' || n || ';admin_nao_lidos=' || n2 || ';';
    select string_agg(nome || ' ' || dosagem, ',' order by nome) into v from public.medicacao where idoso_id = ido and ativo and deleted_at is null;
    res := res || 'lista=' || v || ';';
    select string_agg(nome || ' ' || (deleted_at is not null), ',' order by nome) into v from public.medicacao where idoso_id = ido and nome <> 'Base';
    res := res || 'escondidos=' || v || ';';
    select (select status from public.pedido_exame where documento_id = d1) || ' ' ||
           (select status from public.remedio_pendente where documento_id = d1) || ' ' ||
           (select status from public.leitura_papel where id = lei) || ' ' ||
           (select count(*) from public.receita where idoso_id = ido and deleted_at is null) || ' ' ||
           (select count(*) from public.documento where id = d1 and deleted_at is not null) || ' ' ||
           (select count(*) from public.medicacao_pedido where idoso_id = ido and status = 'pendente')
      into v;
    res := res || 'resto=' || v || ';';

    -- D. depois do aceite: vira pedido e nada sai; o admin pode recusar
    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    insert into public.documento (idoso_id, nome, arquivo_url, autor_id, envio)
      values (ido, 'receita 2', ido || '/r2', cui, 'receita') returning id into d2;
    lei2 := public.confirmar_leitura(d2, dados);
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    perform public.decidir_leitura(lei2, true);
    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    j := public.apagar_envio(d2);
    select string_agg(nome || ' ' || dosagem, ',' order by nome) into v from public.medicacao where idoso_id = ido and ativo and deleted_at is null;
    select count(*) into n from public.documento where id = d2 and deleted_at is null and exclusao_pedida_em is not null;
    res := res || 'depois=' || (j ->> 'precisa_confirmar') || ' ' || v || ' ' || n || ';';
    set local role postgres;
    select count(*) into n from public.alerta_destinatario d join public.alerta a on a.id = d.alerta_id
     where a.idoso_id = ido and a.tipo = 'pedido_de_exclusao' and d.usuario_id = adm and d.lido_em is null;
    res := res || 'admin_avisado=' || n || ';';
    set local role authenticated;
    begin
      perform public.apagar_envio(d2);
      res := res || 'pedir_duas=permitido;';
    exception when others then res := res || 'pedir_duas=bloqueado;';
    end;
    set local role authenticated;
    begin
      perform public.decidir_exclusao(d2, true);
      res := res || 'cuidadora_confirma=permitido;';
    exception when others then res := res || 'cuidadora_confirma=bloqueado;';
    end;
    set local role authenticated;
    begin
      update public.documento set exclusao_pedida_em = null where id = d2;
      res := res || 'mexer_no_pedido=permitido;';
    exception when others then res := res || 'mexer_no_pedido=bloqueado;';
    end;
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    perform public.decidir_exclusao(d2, false);
    select count(*) into n from public.documento where id = d2 and deleted_at is null and exclusao_pedida_em is null;
    set local role postgres;
    select count(*) into n2 from public.alerta_destinatario d join public.alerta a on a.id = d.alerta_id
     where a.idoso_id = ido and a.tipo = 'exclusao_recusada' and d.usuario_id = cui;
    res := res || 'recusou=' || n || ' ' || n2 || ';';

    -- E. pede de novo e o admin confirma
    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    perform public.apagar_envio(d2);
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    perform public.decidir_exclusao(d2, true);
    select string_agg(nome || ' ' || dosagem, ',' order by nome) into v from public.medicacao where idoso_id = ido and ativo and deleted_at is null;
    set local role postgres;
    select count(*) into n from public.alerta_destinatario d join public.alerta a on a.id = d.alerta_id
     where a.idoso_id = ido and a.tipo = 'exclusao_confirmada' and d.usuario_id = cui;
    select count(*) into n2 from public.alerta_destinatario d join public.alerta a on a.id = d.alerta_id
     where a.idoso_id = ido and d.usuario_id = adm and d.lido_em is null;
    res := res || 'confirmou=' || v || ' ' || n || ' ' || n2 || ';';

    -- F. resultado errado num pedido sem marcar: volta a "falta marcar", valores e avisos saem
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    perform public.anotar_pedido_exame(ido, array['Glicemia'], null);
    select id into ped from public.pedido_exame where idoso_id = ido and exames = array['Glicemia'];
    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    insert into public.documento (idoso_id, nome, arquivo_url, autor_id, envio)
      values (ido, 'resultado errado', ido || '/res', cui, 'resultado_exame') returning id into d3;
    perform public.entregar_resultado_exame(ped, d3);
    exa := public.confirmar_valores(ped, jsonb_build_object('data', '2026-11-20T12:00:00-03:00', 'arquivo', ido || '/x.pdf'), valores);
    j := public.apagar_envio(d3);
    select (j ->> 'precisa_confirmar') || ' ' || status || ' ' || (resultado_documento_id is null) into v
      from public.pedido_exame where id = ped;
    select count(*) into n from public.exame where id = exa and deleted_at is null;
    set local role postgres;
    select count(*) into n2 from public.alerta_destinatario d join public.alerta a on a.id = d.alerta_id
     where a.idoso_id = ido and a.tipo in ('exame_fora_da_faixa', 'exame_resultado_enviado', 'leitura_papel') and d.lido_em is null;
    res := res || 'resultado=' || v || ' ' || n || ' ' || n2 || ';';

    -- G. resultado sem pedido, ja concluido pela familia: precisa de confirmacao e sai tudo
    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    insert into public.documento (idoso_id, nome, arquivo_url, autor_id, envio)
      values (ido, 'resultado solto', ido || '/solto', cui, 'resultado_exame') returning id into d4;
    ped2 := public.registrar_resultado_avulso(d4);
    pf := public.criar_pedido_familia(ido, 'conferir_exame', null, adm, false, ped2);
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    exa := public.confirmar_exame(ido, 'Glicose', null, now(), ido || '/y.pdf', valores);
    perform public.encerrar_exame(ped2, false, ido || '/y.pdf');
    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    j := public.apagar_envio(d4);
    res := res || 'solto=' || (j ->> 'precisa_confirmar') || ';';
    perform public.desistir_exclusao(d4);
    perform public.apagar_envio(d4);
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    perform public.decidir_exclusao(d4, true);
    select (select count(*) from public.exame where id = exa and deleted_at is null) || ' ' ||
           (select status from public.pedido_exame where id = ped2) into v;
    res := res || 'solto_confirmado=' || v || ';';

    -- H. pedido para a familia: quem pediu apaga sempre, mesmo resolvido
    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    pf := public.criar_pedido_familia(ido, 'compra', 'fralda', null, false, null);
    pf2 := public.criar_pedido_familia(ido, 'ligar', null, null, false, null);
    perform set_config('request.jwt.claims', json_build_object('sub', fam, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', fam::text, true);
    set local role authenticated;
    perform public.mudar_pedido_familia(pf, 'concluir');
    begin
      perform public.apagar_pedido_familia(pf);
      res := res || 'outro_apaga=permitido;';
    exception when others then res := res || 'outro_apaga=bloqueado;';
    end;
    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    perform public.apagar_pedido_familia(pf);
    perform public.apagar_pedido_familia(pf2);
    select count(*) into n from public.pedido_familia where id in (pf, pf2);
    set local role postgres;
    select count(*) into n2 from public.alerta_destinatario d join public.alerta a on a.id = d.alerta_id
     where a.idoso_id = ido and a.referencia_id in (pf, pf2) and d.lido_em is null;
    res := res || 'familia_apagados=' || n || ' ' || n2 || ';';

    raise exception 'RESULTADO_TESTE|%|%', res,
      'direto=bloqueado;outra_pessoa=bloqueado;simula=false 6 Base 100 mg,Dado 5 mg,Novo 20 mg 1;'
      'familia_avisos_novos=0;admin_nao_lidos=0;lista=Base 50 mg;escondidos=Dado false,Novo true;'
      'resto=cancelado descartado negada 0 1 0;'
      'depois=true Base 100 mg,Dado 5 mg,Novo 20 mg 1;admin_avisado=1;pedir_duas=bloqueado;cuidadora_confirma=bloqueado;'
      'mexer_no_pedido=bloqueado;recusou=1 1;confirmou=Base 50 mg 1 0;'
      'resultado=false falta_marcar true 0 0;solto=true;solto_confirmado=0 cancelado;'
      'outro_apaga=bloqueado;familia_apagados=0 0;';
  exception when others then
    if sqlerrm like 'RESULTADO_TESTE|%' then r := sqlerrm; else raise; end if;
  end;
  if split_part(r, '|', 2) is distinct from split_part(r, '|', 3) then
    raise exception E'Teste de apagar FALHOU.\nObtido:   %\nEsperado: %', split_part(r, '|', 2), split_part(r, '|', 3);
  end if;
end $$;
