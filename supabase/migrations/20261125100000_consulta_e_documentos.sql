-- Documentos para quem cuida e ida ao médico.
--
-- Documentos:
--  * a permissão passa a ser por DOCUMENTO ("levar nas consultas"), e não mais por pasta;
--    quem cuida não vê pastas: vê só o que foi marcado e o que ela mesma enviou;
--  * quem cuida (e qualquer membro) pode ENVIAR a foto de um papel, que chega ao
--    administrador para guardar numa pasta;
--  * um registro nunca aponta para o arquivo de outro (senão daria acesso ao arquivo).
-- Consultas:
--  * a volta marcada vira uma tarefa "Consulta de volta" e avisa o administrador;
--  * consulta gravada ou contada por quem não administra avisa o administrador.
--
-- A coluna documento_pasta.visivel_cuidador deixa de ser usada. Não é apagada para não
-- quebrar uma versão do site ainda não atualizada.

-- 1. Documentos -----------------------------------------------------------------

alter table public.documento
  add column if not exists levar_consulta boolean not null default false,
  add column if not exists envio text check (envio in ('receita', 'pedido_exame', 'atestado', 'outro')),
  add column if not exists guardado_em timestamptz;

-- Quem já era visível a quem cuida (por pasta) continua visível.
update public.documento
   set levar_consulta = true
 where pasta_id is not null and deleted_at is null and public.pasta_visivel_cuidador(pasta_id);

create unique index if not exists documento_arquivo_uq on public.documento (arquivo_url);

create or replace function public.documento_guarda()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and (new.arquivo_url is distinct from old.arquivo_url
                           or new.idoso_id is distinct from old.idoso_id
                           or new.autor_id is distinct from old.autor_id) then
    raise exception 'O arquivo, a pessoa e o autor de um documento não mudam.';
  end if;
  if tg_op = 'INSERT' and new.arquivo_url not like new.idoso_id::text || '/%' then
    raise exception 'Caminho de arquivo inválido.';
  end if;
  return new;
end $$;

drop trigger if exists trg_documento_guarda on public.documento;
create trigger trg_documento_guarda
  before insert or update on public.documento
  for each row execute function public.documento_guarda();

drop policy if exists docpasta_sel on public.documento_pasta;
create policy docpasta_sel on public.documento_pasta for select
  using (public.is_member(idoso_id) and public.papel_em(idoso_id) <> 'cuidador');

drop policy if exists documento_sel on public.documento;
create policy documento_sel on public.documento for select
  using (
    public.is_member(idoso_id)
    and (public.papel_em(idoso_id) <> 'cuidador' or levar_consulta or autor_id = auth.uid())
  );

drop policy if exists documento_ins on public.documento;
create policy documento_ins on public.documento for insert
  with check (
    (public.is_admin(idoso_id) and public.pasta_do_idoso(pasta_id, idoso_id))
    or (
      public.is_member(idoso_id) and autor_id = auth.uid() and envio is not null
      and pasta_id is null and not levar_consulta and guardado_em is null
    )
  );

-- Quem enviou só mexe no próprio envio enquanto ninguém guardou (ex: desfazer um envio errado).
drop policy if exists documento_upd_envio on public.documento;
create policy documento_upd_envio on public.documento for update
  using (
    public.is_member(idoso_id) and autor_id = auth.uid() and envio is not null
    and guardado_em is null and not levar_consulta
  )
  with check (
    public.is_member(idoso_id) and autor_id = auth.uid() and envio is not null
    and pasta_id is null and guardado_em is null and not levar_consulta
  );

-- Só envia arquivo quem criou o registro dele (o registro vem antes do envio).
drop policy if exists documentos_ins on storage.objects;
create policy documentos_ins on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documentos'
    and exists (
      select 1 from public.documento d
       where d.arquivo_url = storage.objects.name and d.autor_id = auth.uid() and d.deleted_at is null
    )
  );

create or replace function public.trg_alerta_documento_enviado()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_quem text;
  v_tipo text;
begin
  if new.envio is null or auth.uid() is null or public.is_admin(new.idoso_id) then
    return new;
  end if;
  select coalesce(nullif(u.nome, ''), 'Alguém da rede') into v_quem from usuario u where u.id = new.autor_id;
  v_tipo := case new.envio when 'receita' then 'uma receita' when 'pedido_exame' then 'um pedido de exame'
                           when 'atestado' then 'um atestado' else 'um documento' end;
  perform public.emitir_alerta(
    p_idoso := new.idoso_id,
    p_tipo := 'documento_enviado',
    p_severidade := 'info',
    p_natureza := 'operacional',
    p_titulo := 'Documento enviado',
    p_ref_tipo := 'documento',
    p_ref_id := new.id,
    p_chave := 'documento_enviado:' || new.id,
    p_texto_familiar := coalesce(v_quem, 'Alguém da rede') || ' enviou ' || v_tipo || '. Veja em Documentos.',
    p_familiar_so_admin := true,
    p_excluir := auth.uid()
  );
  return new;
end $$;

drop trigger if exists trg_alerta_documento_enviado on public.documento;
create trigger trg_alerta_documento_enviado
  after insert on public.documento
  for each row execute function public.trg_alerta_documento_enviado();

-- 2. Consultas --------------------------------------------------------------------

alter table public.consulta add column if not exists retorno_em date;
alter table public.tarefa add column if not exists consulta_id uuid references public.consulta (id) on delete set null;
create unique index if not exists tarefa_consulta_uq on public.tarefa (consulta_id)
  where consulta_id is not null and deleted_at is null;

create or replace function public.trg_alerta_consulta()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_quem text;
begin
  if auth.uid() is null or public.is_admin(new.idoso_id) or new.deleted_at is not null then
    return new;
  end if;
  if new.audio_url is null and coalesce(btrim(new.transcricao), '') = '' then
    return new;
  end if;
  select coalesce(nullif(u.nome, ''), 'Alguém da rede') into v_quem from usuario u where u.id = auth.uid();
  perform public.emitir_alerta(
    p_idoso := new.idoso_id,
    p_tipo := 'consulta_registrada',
    p_severidade := 'info',
    p_natureza := 'operacional',
    p_titulo := 'Consulta registrada',
    p_ref_tipo := 'consulta',
    p_ref_id := new.id,
    p_chave := 'consulta_registrada:' || new.id,
    p_texto_familiar := coalesce(v_quem, 'Alguém da rede') || ' registrou uma consulta. Veja em Consultas o áudio ou o relato.',
    p_familiar_so_admin := true,
    p_excluir := auth.uid()
  );
  return new;
end $$;

drop trigger if exists trg_alerta_consulta on public.consulta;
create trigger trg_alerta_consulta
  after insert or update of audio_url, transcricao on public.consulta
  for each row execute function public.trg_alerta_consulta();

-- Volta marcada. SECURITY DEFINER porque quem cuida não cria tarefas diretamente;
-- esta função só cria (ou ajusta) a tarefa "Consulta de volta" daquela consulta.
create or replace function public.registrar_volta(p_consulta uuid, p_data date)
returns void language plpgsql security definer set search_path = public as $$
declare
  c consulta;
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_titulo text;
  v_tarefa uuid;
  v_quem text;
begin
  select * into c from consulta where id = p_consulta and deleted_at is null;
  if c.id is null or v_uid is null or not public.is_member(c.idoso_id) then
    raise exception 'Sem acesso a esta consulta.';
  end if;
  if p_data is not null and (p_data < v_hoje or p_data > v_hoje + 730) then
    raise exception 'A volta precisa ser uma data de hoje em diante (até 2 anos).';
  end if;

  update consulta set retorno_em = p_data where id = c.id;
  select id into v_tarefa from tarefa where consulta_id = c.id and deleted_at is null;

  if p_data is null then
    if v_tarefa is not null then
      update tarefa set deleted_at = now() where id = v_tarefa;
    end if;
    return;
  end if;

  v_titulo := left('Consulta de volta' || coalesce(' com ' || nullif(btrim(c.medico), ''), ''), 120);
  if v_tarefa is null then
    insert into tarefa (idoso_id, titulo, instrucao, frequencia, data, criado_por, consulta_id)
    values (c.idoso_id, v_titulo, 'Confirme o horário com a família.', 'uma_vez', p_data, v_uid, c.id);
  else
    update tarefa set titulo = v_titulo, data = p_data where id = v_tarefa;
  end if;

  select coalesce(nullif(u.nome, ''), 'Alguém da rede') into v_quem from usuario u where u.id = v_uid;
  perform public.emitir_alerta(
    p_idoso := c.idoso_id,
    p_tipo := 'consulta_volta',
    p_severidade := 'atencao',
    p_natureza := 'operacional',
    p_titulo := 'Volta ao médico: ' || to_char(p_data, 'DD/MM'),
    p_ref_tipo := 'consulta',
    p_ref_id := c.id,
    p_chave := 'consulta_volta:' || c.id || ':' || p_data,
    p_texto_familiar := coalesce(v_quem, 'Alguém da rede') || ' marcou a volta para ' || to_char(p_data, 'DD/MM/YYYY')
      || '. Criei a tarefa "' || v_titulo || '". Confirme o horário.',
    p_familiar_so_admin := true,
    p_excluir := v_uid
  );
end $$;

revoke all on function public.registrar_volta(uuid, date) from public, anon;
grant execute on function public.registrar_volta(uuid, date) to authenticated;

-- 3. Teste (desfeito no fim; se falhar, a migração é recusada) --------------------

do $$
declare
  adm uuid := gen_random_uuid();
  cui uuid := gen_random_uuid();
  ido uuid;
  pasta uuid;
  d_oculto uuid;
  d_envio uuid;
  cons uuid;
  res text := '';
  r text;
  n int;
  v text;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  begin
    insert into auth.users (id, email) values
      (adm, 'teste-adm-' || adm || '@exemplo.invalid'), (cui, 'teste-cui-' || cui || '@exemplo.invalid');
    insert into public.idoso (nome) values ('Teste de consulta') returning id into ido;
    insert into public.vinculo (usuario_id, idoso_id, papel, admin) values
      (adm, ido, 'familiar', true), (cui, ido, 'cuidador', false);

    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    insert into public.documento_pasta (idoso_id, nome, criado_por) values (ido, 'Identificacao', adm) returning id into pasta;
    insert into public.documento (idoso_id, pasta_id, nome, arquivo_url, autor_id)
      values (ido, pasta, 'escritura', ido || '/escritura', adm) returning id into d_oculto;
    insert into public.documento (idoso_id, pasta_id, nome, arquivo_url, autor_id, levar_consulta)
      values (ido, pasta, 'carteirinha', ido || '/carteirinha', adm, true);

    -- A. quem cuida: nenhuma pasta, so o marcado para levar
    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    select count(*) into n from public.documento_pasta where idoso_id = ido;
    select string_agg(nome, ',' order by nome) into v from public.documento where idoso_id = ido;
    res := res || 'pastas=' || n || ';ve=' || v || ';';

    -- B. envia foto; nao consegue se auto-marcar nem entrar em pasta
    insert into public.documento (idoso_id, nome, arquivo_url, autor_id, envio)
      values (ido, 'receita nova', ido || '/foto1', cui, 'receita') returning id into d_envio;
    res := res || 'envio=ok;';
    begin
      insert into public.documento (idoso_id, nome, arquivo_url, autor_id, envio, levar_consulta)
        values (ido, 'x', ido || '/foto2', cui, 'outro', true);
      res := res || 'envio_ja_marcado=permitido;';
    exception when others then res := res || 'envio_ja_marcado=bloqueado;';
    end;
    set local role authenticated;
    begin
      insert into public.documento (idoso_id, pasta_id, nome, arquivo_url, autor_id, envio)
        values (ido, pasta, 'x', ido || '/foto3', cui, 'outro');
      res := res || 'envio_em_pasta=permitido;';
    exception when others then res := res || 'envio_em_pasta=bloqueado;';
    end;

    -- C. nao consegue apontar para o arquivo escondido (o que daria acesso a ele)
    set local role authenticated;
    begin
      insert into public.documento (idoso_id, nome, arquivo_url, autor_id, envio)
        values (ido, 'copia', ido || '/escritura', cui, 'outro');
      res := res || 'apontar_para_oculto=permitido;';
    exception when others then res := res || 'apontar_para_oculto=bloqueado;';
    end;
    set local role authenticated;
    begin
      update public.documento set arquivo_url = ido || '/escritura2' where id = d_envio;
      res := res || 'trocar_arquivo=permitido;';
    exception when others then res := res || 'trocar_arquivo=bloqueado;';
    end;
    set local role authenticated;
    update public.documento set nome = 'invadido' where id = d_oculto;
    set local role postgres;
    select nome into v from public.documento where id = d_oculto;
    res := res || 'oculto_continua=' || v || ';';
    select string_agg(case d.usuario_id when adm then 'admin' else 'cuidadora' end, ',') into v
      from public.alerta_destinatario d join public.alerta a on a.id = d.alerta_id
     where a.chave = 'documento_enviado:' || d_envio;
    res := res || 'aviso_envio=' || coalesce(v, 'ninguem') || ';';

    -- D. consulta contada duas vezes gera um aviso so; volta cria uma tarefa so
    set local role authenticated;
    insert into public.consulta (idoso_id, autor_id, data, medico, status_processamento)
      values (ido, cui, now(), 'Dra. Ana', 'pendente') returning id into cons;
    update public.consulta set transcricao = 'pediu exame' where id = cons;
    update public.consulta set transcricao = 'pediu exame e voltar' where id = cons;
    perform public.registrar_volta(cons, hoje + 30);
    perform public.registrar_volta(cons, hoje + 45);
    set local role postgres;
    select count(*) into n from public.alerta where idoso_id = ido and tipo = 'consulta_registrada';
    res := res || 'avisos_consulta=' || n || ';';
    select count(*) into n from public.tarefa where consulta_id = cons and deleted_at is null;
    select titulo || ' em ' || (data - hoje) into v from public.tarefa where consulta_id = cons and deleted_at is null;
    res := res || 'tarefas=' || n || ';' || v || ';';
    set local role authenticated;
    begin
      perform public.registrar_volta(cons, hoje - 1);
      res := res || 'volta_no_passado=permitida;';
    exception when others then res := res || 'volta_no_passado=recusada;';
    end;
    set local role authenticated;
    perform public.registrar_volta(cons, null);
    set local role postgres;
    select count(*) into n from public.tarefa where consulta_id = cons and deleted_at is null;
    res := res || 'tarefas_apos_desmarcar=' || n || ';';

    raise exception 'RESULTADO_TESTE|%|%', res,
      'pastas=0;ve=carteirinha;envio=ok;envio_ja_marcado=bloqueado;envio_em_pasta=bloqueado;apontar_para_oculto=bloqueado;'
      'trocar_arquivo=bloqueado;oculto_continua=escritura;aviso_envio=admin;avisos_consulta=1;tarefas=1;'
      'Consulta de volta com Dra. Ana em 45;volta_no_passado=recusada;tarefas_apos_desmarcar=0;';
  exception when others then
    if sqlerrm like 'RESULTADO_TESTE|%' then r := sqlerrm; else raise; end if;
  end;
  if split_part(r, '|', 2) is distinct from split_part(r, '|', 3) then
    raise exception E'Teste de consulta e documentos FALHOU.
Obtido:   %
Esperado: %', split_part(r, '|', 2), split_part(r, '|', 3);
  end if;
end $$;
