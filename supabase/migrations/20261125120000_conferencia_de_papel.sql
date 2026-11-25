-- Receita e pedido de exame lidos da foto.
--
-- Quem envia a foto confere o que a IA leu. O confirmado VALE NA HORA e o administrador
-- recebe um pop-up com a foto para aceitar ou negar o conjunto. Negar desfaz: remédio novo
-- sai, mudança volta ao que era, pedido de exame é cancelado.
--
-- A conferência é gravada de uma vez só (uma função), para nunca ficar pela metade.

create table if not exists public.pedido_exame (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  leitura_id uuid,
  documento_id uuid references public.documento (id),
  exames text[] not null check (cardinality(exames) between 1 and 30),
  -- só o que está escrito no papel; vazio = confirmar com o laboratório
  preparo text check (preparo is null or char_length(preparo) <= 1000),
  status text not null default 'falta_marcar'
    check (status in ('falta_marcar', 'marcado', 'feito', 'resultado_enviado', 'concluido', 'cancelado')),
  -- marcado sem dia = "já está marcado", sem os detalhes
  dia date,
  hora text check (hora is null or hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  laboratorio text check (laboratorio is null or char_length(laboratorio) <= 120),
  falta_desde timestamptz not null default now(),
  resultado_documento_id uuid references public.documento (id),
  criado_por uuid references public.usuario (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  editado_por uuid
);

create table if not exists public.leitura_papel (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  documento_id uuid not null references public.documento (id),
  enviado_por uuid not null references public.usuario (id),
  receita_id uuid references public.receita (id),
  -- o que foi lido, o que a pessoa respondeu e o que aconteceu com cada item
  itens jsonb not null default '[]'::jsonb,
  -- a pessoa disse que há algo no papel que a leitura não mostrou
  faltou boolean not null default false,
  status text not null default 'pendente' check (status in ('pendente', 'aceita', 'negada')),
  decidido_por uuid references public.usuario (id),
  decidido_em timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists leitura_documento_uq on public.leitura_papel (documento_id);
create index if not exists leitura_pendente_idx on public.leitura_papel (idoso_id) where status = 'pendente';
create index if not exists pedido_exame_idoso_idx on public.pedido_exame (idoso_id, status);

alter table public.pedido_exame drop constraint if exists pedido_exame_leitura_fk;
alter table public.pedido_exame add constraint pedido_exame_leitura_fk
  foreign key (leitura_id) references public.leitura_papel (id);

drop trigger if exists trg_touch on public.pedido_exame;
create trigger trg_touch before update on public.pedido_exame
  for each row execute function public.touch_updated();

-- Leitura para quem é da rede; escrita só pelas funções.
alter table public.pedido_exame enable row level security;
alter table public.leitura_papel enable row level security;
revoke all on public.pedido_exame, public.leitura_papel from anon, authenticated;
grant select on public.pedido_exame, public.leitura_papel to authenticated;

drop policy if exists pedido_exame_sel on public.pedido_exame;
create policy pedido_exame_sel on public.pedido_exame for select using (public.is_member(idoso_id));
drop policy if exists leitura_sel on public.leitura_papel;
create policy leitura_sel on public.leitura_papel for select using (public.is_member(idoso_id));

-- ---------------------------------------------------------------------------
-- Gravar a conferência
-- ---------------------------------------------------------------------------
-- p_dados = {
--   receita: { medico, data, arquivo },
--   remedios: [ { resposta: 'igual'|'diferente'|null, acao: 'novo'|'mudar'|'ja_toma'|'duvida'|'parar',
--                 medicacao_id, nome, texto, motivo,
--                 novo: { nome, dosagem, instrucoes, frequencia, horarios, dias_semana, intervalo_dias, inicio, fim },
--                 dados: { dosagem, horarios } } ],
--   exames: { resposta, nomes: [..], preparo },
--   faltou: boolean }
create or replace function public.confirmar_leitura(p_documento uuid, p_dados jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean;
  doc documento;
  v_leitura uuid;
  v_receita uuid;
  v_arquivo text := nullif(p_dados -> 'receita' ->> 'arquivo', '');
  it jsonb;
  n jsonb;
  v_acao text;
  v_igual boolean;
  v_resultado text;
  v_med uuid;
  v_pedido uuid;
  v_itens jsonb := '[]'::jsonb;
  v_exames text[];
  v_pe uuid;
  v_fora int := 0;
  v_faltou boolean := coalesce((p_dados ->> 'faltou')::boolean, false);
  v_quem text;
begin
  select * into doc from documento where id = p_documento and deleted_at is null for update;
  if doc.id is null or v_uid is null or not public.is_member(doc.idoso_id)
     or doc.autor_id is distinct from v_uid or doc.envio is null then
    raise exception 'Só quem enviou a foto pode conferir a leitura.';
  end if;
  if exists (select 1 from leitura_papel where documento_id = doc.id) then
    raise exception 'Esta foto já foi conferida.';
  end if;
  if jsonb_array_length(coalesce(p_dados -> 'remedios', '[]'::jsonb)) > 30 then
    raise exception 'Itens demais para um papel só.';
  end if;
  if v_arquivo is not null and v_arquivo not like doc.idoso_id::text || '/%' then
    raise exception 'Caminho de arquivo inválido.';
  end if;

  v_admin := public.is_admin(doc.idoso_id);
  insert into leitura_papel (idoso_id, documento_id, enviado_por, faltou)
  values (doc.idoso_id, doc.id, v_uid, v_faltou)
  returning id into v_leitura;

  for it in select * from jsonb_array_elements(coalesce(p_dados -> 'remedios', '[]'::jsonb)) loop
    v_acao := it ->> 'acao';
    v_igual := coalesce(it ->> 'resposta', '') = 'igual';
    v_med := nullif(it ->> 'medicacao_id', '')::uuid;
    v_pedido := null;
    if v_med is not null and not exists (select 1 from medicacao where id = v_med and idoso_id = doc.idoso_id) then
      raise exception 'Remédio de outra pessoa.';
    end if;

    if v_acao in ('duvida', 'parar') then
      v_resultado := v_acao;
    elsif not v_igual then
      v_resultado := 'nao_entrou';
    elsif v_acao = 'ja_toma' then
      v_resultado := 'ja_tomava';
    elsif v_acao = 'novo' then
      n := it -> 'novo';
      if coalesce(btrim(n ->> 'nome'), '') = '' then
        raise exception 'Remédio sem nome.';
      end if;
      if v_receita is null then
        insert into receita (idoso_id, autor_id, medico, data, arquivo_url, status_processamento)
        values (doc.idoso_id, v_uid, nullif(btrim(p_dados -> 'receita' ->> 'medico'), ''),
                nullif(p_dados -> 'receita' ->> 'data', '')::date, v_arquivo, 'confirmada')
        returning id into v_receita;
      end if;
      insert into medicacao (idoso_id, receita_id, autor_id, nome, dosagem, instrucoes, frequencia,
                             horarios, dias_semana, intervalo_dias, inicio, fim)
      values (
        doc.idoso_id, v_receita, v_uid, btrim(n ->> 'nome'),
        nullif(btrim(n ->> 'dosagem'), ''), nullif(btrim(n ->> 'instrucoes'), ''),
        coalesce(n ->> 'frequencia', 'diaria'),
        array(select jsonb_array_elements_text(coalesce(n -> 'horarios', '[]'::jsonb))),
        array(select (jsonb_array_elements_text(coalesce(n -> 'dias_semana', '[]'::jsonb)))::smallint),
        (n ->> 'intervalo_dias')::int,
        coalesce(nullif(n ->> 'inicio', '')::date, (now() at time zone 'America/Sao_Paulo')::date),
        nullif(n ->> 'fim', '')::date
      ) returning id into v_med;
      v_resultado := 'entrou';
    elsif v_acao = 'mudar' then
      if v_med is null then
        raise exception 'Mudança sem remédio.';
      end if;
      -- Só dose e horário mudam por leitura de foto.
      perform public.aplicar_mudanca_medicacao(
        v_med, 'alterar',
        jsonb_strip_nulls(jsonb_build_object('dosagem', it -> 'dados' -> 'dosagem', 'horarios', it -> 'dados' -> 'horarios')),
        'Receita lida da foto');
      select id into v_pedido from medicacao_pedido where medicacao_id = v_med and status = 'pendente' limit 1;
      v_resultado := 'mudou';
    else
      raise exception 'Item desconhecido.';
    end if;

    if v_resultado in ('nao_entrou', 'duvida', 'parar') then
      v_fora := v_fora + 1;
    end if;
    v_itens := v_itens || jsonb_build_object(
      'tipo', 'remedio', 'resultado', v_resultado, 'nome', left(it ->> 'nome', 160),
      'texto', left(it ->> 'texto', 500), 'motivo', left(it ->> 'motivo', 300),
      'medicacao_id', v_med, 'pedido_id', v_pedido);
  end loop;

  if p_dados -> 'exames' is not null and jsonb_typeof(p_dados -> 'exames') = 'object' then
    select array_agg(left(btrim(x), 160)) into v_exames
      from jsonb_array_elements_text(coalesce(p_dados -> 'exames' -> 'nomes', '[]'::jsonb)) x
     where btrim(x) <> '';
    if v_exames is not null then
      v_pe := null;
      if coalesce(p_dados -> 'exames' ->> 'resposta', '') = 'igual' then
        insert into pedido_exame (idoso_id, leitura_id, documento_id, exames, preparo, criado_por)
        values (doc.idoso_id, v_leitura, doc.id, v_exames,
                nullif(btrim(p_dados -> 'exames' ->> 'preparo'), ''), v_uid)
        returning id into v_pe;
      else
        v_fora := v_fora + 1;
      end if;
      v_itens := v_itens || jsonb_build_object(
        'tipo', 'exame', 'resultado', case when v_pe is null then 'nao_entrou' else 'entrou' end,
        'nome', array_to_string(v_exames, ', '),
        'texto', nullif(btrim(p_dados -> 'exames' ->> 'preparo'), ''), 'pedido_exame_id', v_pe);
    end if;
  end if;

  update leitura_papel
     set itens = v_itens, receita_id = v_receita,
         status = case when v_admin then 'aceita' else 'pendente' end,
         decidido_por = case when v_admin then v_uid end,
         decidido_em = case when v_admin then now() end
   where id = v_leitura;

  if not v_admin then
    -- O aviso de "documento enviado" dá lugar a este, mais completo.
    update alerta_destinatario d set lido_em = now()
      from alerta a
     where a.id = d.alerta_id and a.idoso_id = doc.idoso_id and d.lido_em is null
       and a.chave = 'documento_enviado:' || doc.id;

    select coalesce(nullif(u.nome, ''), 'Alguém da rede') into v_quem from usuario u where u.id = v_uid;
    perform public.emitir_alerta(
      p_idoso := doc.idoso_id,
      p_tipo := 'leitura_papel',
      p_severidade := 'atencao',
      p_natureza := 'operacional',
      p_titulo := case doc.envio when 'pedido_exame' then 'Pedido de exame para revisar' else 'Receita para revisar' end,
      p_ref_tipo := 'documento',
      p_ref_id := doc.id,
      p_chave := 'leitura:' || v_leitura,
      p_texto_familiar := coalesce(v_quem, 'Alguém da rede') || ' conferiu uma foto lida pela IA. O confirmado já está valendo. Veja a foto e aceite ou negue.'
        || case when v_fora > 0 or v_faltou then ' Há itens que não entraram: leia a foto.' else '' end,
      p_familiar_so_admin := true,
      p_excluir := v_uid
    );
  end if;

  return v_leitura;
end $$;

revoke all on function public.confirmar_leitura(uuid, jsonb) from public, anon;
grant execute on function public.confirmar_leitura(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Aceitar (nada muda) ou negar (desfaz o conjunto)
-- ---------------------------------------------------------------------------
create or replace function public.decidir_leitura(p_leitura uuid, p_aceitar boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  l leitura_papel;
  it jsonb;
  v_med uuid;
  v_pedido uuid;
  pe pedido_exame;
  v_texto text;
begin
  select * into l from leitura_papel where id = p_leitura for update;
  if l.id is null or not public.is_admin(l.idoso_id) then
    raise exception 'Só o administrador decide esta revisão.';
  end if;
  if l.status <> 'pendente' then
    raise exception 'Esta revisão já foi encerrada.';
  end if;

  -- O que o administrador já decidiu item a item (na tela de Medicação) fica como está.
  for it in select * from jsonb_array_elements(l.itens) loop
    v_med := nullif(it ->> 'medicacao_id', '')::uuid;
    v_pedido := nullif(it ->> 'pedido_id', '')::uuid;
    if it ->> 'tipo' = 'remedio' and it ->> 'resultado' = 'entrou' then
      if p_aceitar then
        update medicacao set confirmado = true
         where id = v_med and not confirmado and recusado_em is null and deleted_at is null;
      else
        update medicacao set ativo = false, recusado_em = now()
         where id = v_med and not confirmado and recusado_em is null and deleted_at is null;
      end if;
    elsif it ->> 'tipo' = 'remedio' and it ->> 'resultado' = 'mudou' and v_pedido is not null then
      if exists (select 1 from medicacao_pedido where id = v_pedido and status = 'pendente') then
        perform public.decidir_pedido_medicacao(v_pedido, p_aceitar);
      end if;
    end if;
  end loop;

  if not p_aceitar then
    for pe in
      update pedido_exame set status = 'cancelado'
       where leitura_id = l.id and status not in ('concluido', 'cancelado')
      returning *
    loop
      v_texto := 'O pedido de exame (' || array_to_string(pe.exames, ', ') || ') foi negado pela família e saiu da lista.';
      perform public.emitir_alerta(
        p_idoso := l.idoso_id,
        p_tipo := 'pedido_exame_negado',
        p_severidade := 'atencao',
        p_natureza := 'operacional',
        p_titulo := 'Pedido de exame negado',
        p_ref_tipo := 'documento',
        p_ref_id := l.documento_id,
        p_chave := 'pedido_negado:' || pe.id,
        p_texto_cuidador := v_texto,
        p_excluir := auth.uid()
      );
    end loop;

    if l.receita_id is not null and not exists (
      select 1 from medicacao where receita_id = l.receita_id and recusado_em is null and deleted_at is null
    ) then
      update receita set deleted_at = now() where id = l.receita_id;
    end if;
  end if;

  update leitura_papel
     set status = case when p_aceitar then 'aceita' else 'negada' end,
         decidido_por = auth.uid(), decidido_em = now()
   where id = l.id;

  update alerta_destinatario d set lido_em = now()
    from alerta a
   where a.id = d.alerta_id and a.idoso_id = l.idoso_id and d.lido_em is null
     and a.chave = 'leitura:' || l.id;
end $$;

revoke all on function public.decidir_leitura(uuid, boolean) from public, anon;
grant execute on function public.decidir_leitura(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Teste (desfeito no fim; se falhar, a migração é recusada)
-- ---------------------------------------------------------------------------
do $$
declare
  adm uuid := gen_random_uuid();
  cui uuid := gen_random_uuid();
  fora uuid := gen_random_uuid();
  ido uuid;
  med uuid;
  doc uuid;
  doc2 uuid;
  doc_adm uuid;
  lei uuid;
  lei2 uuid;
  dados jsonb;
  res text := '';
  r text;
  v text;
  n int;
begin
  begin
    insert into auth.users (id, email) values
      (adm, 'teste-adm-' || adm || '@exemplo.invalid'),
      (cui, 'teste-cui-' || cui || '@exemplo.invalid'),
      (fora, 'teste-fora-' || fora || '@exemplo.invalid');
    insert into public.idoso (nome) values ('Teste de leitura') returning id into ido;
    insert into public.vinculo (usuario_id, idoso_id, papel, admin) values
      (adm, ido, 'familiar', true), (cui, ido, 'cuidador', false);

    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    insert into public.medicacao (idoso_id, nome, dosagem, horarios) values (ido, 'Base', '50 mg', array['manha'])
      returning id into med;
    insert into public.documento (idoso_id, nome, arquivo_url, autor_id, envio)
      values (ido, 'do admin', ido || '/do-admin', adm, 'receita') returning id into doc_adm;

    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    insert into public.documento (idoso_id, nome, arquivo_url, autor_id, envio)
      values (ido, 'receita 1', ido || '/r1', cui, 'receita') returning id into doc;

    dados := jsonb_build_object(
      'receita', jsonb_build_object('medico', 'Dra. Ana', 'arquivo', ido || '/r1.jpg'),
      'remedios', jsonb_build_array(
        jsonb_build_object('resposta', 'igual', 'acao', 'novo', 'nome', 'Novo', 'novo',
          jsonb_build_object('nome', 'Novo', 'dosagem', '20 mg', 'frequencia', 'diaria', 'horarios', jsonb_build_array('noite'))),
        jsonb_build_object('resposta', 'igual', 'acao', 'mudar', 'nome', 'Base', 'medicacao_id', med,
          'dados', jsonb_build_object('dosagem', '100 mg')),
        jsonb_build_object('resposta', 'diferente', 'acao', 'novo', 'nome', 'Xarope', 'novo',
          jsonb_build_object('nome', 'Xarope', 'dosagem', '5 ml')),
        jsonb_build_object('resposta', 'igual', 'acao', 'duvida', 'nome', 'Semanal')),
      'exames', jsonb_build_object('resposta', 'igual', 'nomes', jsonb_build_array('Hemograma', 'Glicemia'), 'preparo', 'Jejum de 8 horas'));

    -- A. nao se confere a foto de outra pessoa
    begin
      perform public.confirmar_leitura(doc_adm, dados);
      res := res || 'conferir_de_outro=permitido;';
    exception when others then res := res || 'conferir_de_outro=bloqueado;';
    end;

    -- B. o confirmado vale na hora; o resto nao entra
    set local role authenticated;
    lei := public.confirmar_leitura(doc, dados);
    select string_agg(nome || ' ' || dosagem || ' ' || confirmado, ',' order by nome) into v
      from public.medicacao where idoso_id = ido and ativo;
    res := res || 'lista=' || v || ';';
    select count(*) into n from public.pedido_exame where idoso_id = ido and status = 'falta_marcar';
    res := res || 'pedidos=' || n || ';';
    select status into v from public.leitura_papel where id = lei;
    res := res || 'leitura=' || v || ';';

    set local role authenticated;
    begin
      perform public.confirmar_leitura(doc, dados);
      res := res || 'conferir_duas_vezes=permitido;';
    exception when others then res := res || 'conferir_duas_vezes=bloqueado;';
    end;
    set local role authenticated;
    begin
      insert into public.pedido_exame (idoso_id, exames) values (ido, array['forjado']);
      res := res || 'inserir_direto=permitido;';
    exception when others then res := res || 'inserir_direto=bloqueado;';
    end;
    set local role authenticated;
    begin
      perform public.decidir_leitura(lei, true);
      res := res || 'cuidadora_decide=permitido;';
    exception when others then res := res || 'cuidadora_decide=bloqueado;';
    end;

    -- C. quem e de fora nao le
    perform set_config('request.jwt.claims', json_build_object('sub', fora, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', fora::text, true);
    set local role authenticated;
    select count(*) into n from public.leitura_papel where idoso_id = ido;
    res := res || 'de_fora_le=' || n;
    select count(*) into n from public.pedido_exame where idoso_id = ido;
    res := res || n || ';';

    -- D. avisos do admin: o desta leitura aberto, o de documento enviado fechado
    set local role postgres;
    select string_agg(a.tipo, ',' order by a.tipo) into v from public.alerta a
      join public.alerta_destinatario d on d.alerta_id = a.id
     where a.idoso_id = ido and d.usuario_id = adm and d.lido_em is null
       and a.tipo in ('leitura_papel', 'documento_enviado');
    res := res || 'aviso_admin=' || coalesce(v, 'nenhum') || ';';

    -- E. negar desfaz o conjunto
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    perform public.decidir_leitura(lei, false);
    select string_agg(nome || ' ' || dosagem, ',' order by nome) into v from public.medicacao where idoso_id = ido and ativo;
    res := res || 'apos_negar=' || v || ';';
    select count(*) into n from public.pedido_exame where idoso_id = ido and status = 'cancelado';
    res := res || 'pedido_cancelado=' || n || ';';
    select count(*) into n from public.receita where idoso_id = ido and deleted_at is null;
    res := res || 'receitas=' || n || ';';
    select count(*) into n from public.medicacao_pedido where idoso_id = ido and status = 'pendente';
    res := res || 'revisoes_sobrando=' || n || ';';
    set local role postgres;
    select count(*) into n from public.alerta where idoso_id = ido and tipo = 'pedido_exame_negado';
    res := res || 'aviso_negacao_exame=' || n || ';';

    -- F. aceitar mantem e encerra as revisoes
    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    insert into public.documento (idoso_id, nome, arquivo_url, autor_id, envio)
      values (ido, 'receita 2', ido || '/r2', cui, 'receita') returning id into doc2;
    lei2 := public.confirmar_leitura(doc2, dados);
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    perform public.decidir_leitura(lei2, true);
    select string_agg(nome || ' ' || dosagem || ' ' || confirmado, ',' order by nome) into v
      from public.medicacao where idoso_id = ido and ativo;
    res := res || 'apos_aceitar=' || v || ';';
    select count(*) into n from public.medicacao_pedido where idoso_id = ido and status = 'pendente';
    res := res || 'revisoes_sobrando=' || n || ';';

    -- G. se quem confere e o administrador, nao ha o que revisar
    set local role authenticated;
    lei := public.confirmar_leitura(doc_adm, jsonb_build_object('exames', jsonb_build_object('resposta', 'igual', 'nomes', jsonb_build_array('Eco'))));
    select status into v from public.leitura_papel where id = lei;
    res := res || 'leitura_do_admin=' || v || ';';

    raise exception 'RESULTADO_TESTE|%|%', res,
      'conferir_de_outro=bloqueado;lista=Base 100 mg true,Novo 20 mg false;pedidos=1;leitura=pendente;'
      'conferir_duas_vezes=bloqueado;inserir_direto=bloqueado;cuidadora_decide=bloqueado;de_fora_le=00;'
      'aviso_admin=leitura_papel;apos_negar=Base 50 mg;pedido_cancelado=1;receitas=0;revisoes_sobrando=0;'
      'aviso_negacao_exame=1;apos_aceitar=Base 100 mg true,Novo 20 mg true;revisoes_sobrando=0;leitura_do_admin=aceita;';
  exception when others then
    if sqlerrm like 'RESULTADO_TESTE|%' then r := sqlerrm; else raise; end if;
  end;
  if split_part(r, '|', 2) is distinct from split_part(r, '|', 3) then
    raise exception E'Teste da conferência FALHOU.\nObtido:   %\nEsperado: %', split_part(r, '|', 2), split_part(r, '|', 3);
  end if;
end $$;
