-- Tarefas que o administrador pede a quem cuida (card da tela Hoje).
--
--  * Podem ser de todo dia, de alguns dias da semana ou de uma vez só.
--  * Só o administrador cria, edita e remove (remover esconde; o histórico fica).
--  * Quem cuida responde "fiz" ou "não consegui", com uma anotação opcional. Cada resposta é
--    de um dia, e fica no nome de quem respondeu.
--  * "Não consegui" avisa o administrador. Tarefa nova avisa quem cuida.

create table if not exists public.tarefa (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  titulo text not null check (char_length(btrim(titulo)) between 1 and 120),
  instrucao text check (instrucao is null or char_length(instrucao) <= 300),
  frequencia text not null default 'diaria' check (frequencia in ('diaria', 'semana', 'uma_vez')),
  dias_semana smallint[] not null default '{}',
  -- de uma vez só: o dia para fazer. Nas demais: a partir de quando vale.
  data date not null default ((now() at time zone 'America/Sao_Paulo')::date),
  criado_por uuid references public.usuario (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  editado_por uuid,
  deleted_at timestamptz,
  check (frequencia <> 'semana' or cardinality(dias_semana) > 0),
  check (dias_semana <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[])
);

create table if not exists public.tarefa_registro (
  id uuid primary key default gen_random_uuid(),
  tarefa_id uuid not null references public.tarefa (id) on delete cascade,
  data date not null,
  status text not null check (status in ('feito', 'nao_consegui')),
  nota text check (nota is null or char_length(nota) <= 300),
  registrado_por uuid references public.usuario (id),
  registrado_em timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  editado_por uuid,
  deleted_at timestamptz,
  unique (tarefa_id, data)
);

create index if not exists tarefa_idoso_idx on public.tarefa (idoso_id) where deleted_at is null;
create index if not exists tarefa_registro_idx on public.tarefa_registro (tarefa_id, data desc);

drop trigger if exists trg_touch on public.tarefa;
create trigger trg_touch before update on public.tarefa
  for each row execute function public.touch_updated();
drop trigger if exists trg_touch on public.tarefa_registro;
create trigger trg_touch before update on public.tarefa_registro
  for each row execute function public.touch_updated();

alter table public.tarefa enable row level security;
alter table public.tarefa_registro enable row level security;
grant select, insert, update on public.tarefa to authenticated;
grant select, insert, update on public.tarefa_registro to authenticated;

drop policy if exists tarefa_sel on public.tarefa;
create policy tarefa_sel on public.tarefa for select using (public.is_member(idoso_id));
drop policy if exists tarefa_ins on public.tarefa;
create policy tarefa_ins on public.tarefa for insert
  with check (public.is_admin(idoso_id) and criado_por = auth.uid());
drop policy if exists tarefa_upd on public.tarefa;
create policy tarefa_upd on public.tarefa for update
  using (public.is_admin(idoso_id)) with check (public.is_admin(idoso_id));

drop policy if exists tarefareg_sel on public.tarefa_registro;
create policy tarefareg_sel on public.tarefa_registro for select
  using (public.is_member((select t.idoso_id from public.tarefa t where t.id = tarefa_id)));
drop policy if exists tarefareg_ins on public.tarefa_registro;
create policy tarefareg_ins on public.tarefa_registro for insert
  with check (
    registrado_por = auth.uid()
    and public.is_member((select t.idoso_id from public.tarefa t where t.id = tarefa_id))
  );
drop policy if exists tarefareg_upd on public.tarefa_registro;
create policy tarefareg_upd on public.tarefa_registro for update
  using (public.is_member((select t.idoso_id from public.tarefa t where t.id = tarefa_id)))
  with check (
    registrado_por = auth.uid()
    and public.is_member((select t.idoso_id from public.tarefa t where t.id = tarefa_id))
  );

-- Avisos ------------------------------------------------------------------------

create or replace function public.trg_alerta_tarefa_nova()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.emitir_alerta(
    p_idoso := new.idoso_id,
    p_tipo := 'tarefa_nova',
    p_severidade := 'info',
    p_natureza := 'operacional',
    p_titulo := 'Tarefa nova: ' || new.titulo,
    p_ref_tipo := 'tarefa',
    p_ref_id := new.id,
    p_chave := 'tarefa_nova:' || new.id,
    p_texto_cuidador := 'Há uma tarefa nova para você: ' || new.titulo
      || case when new.frequencia = 'uma_vez' then ', para ' || to_char(new.data, 'DD/MM') else '' end || '.',
    p_excluir := auth.uid()
  );
  return new;
end $$;

drop trigger if exists trg_alerta_tarefa_nova on public.tarefa;
create trigger trg_alerta_tarefa_nova
  after insert on public.tarefa
  for each row execute function public.trg_alerta_tarefa_nova();

create or replace function public.trg_alerta_tarefa_resposta()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t tarefa;
  v_quem text;
  v_chave text;
begin
  select * into t from tarefa where id = new.tarefa_id;
  v_chave := 'tarefa_nao:' || new.tarefa_id || ':' || new.data;

  -- Passou a "feito" ou foi desmarcada: o aviso de "não consegui" deixa de pedir atenção.
  if new.status = 'feito' or new.deleted_at is not null then
    update alerta_destinatario d set lido_em = now()
      from alerta a
     where a.id = d.alerta_id and a.idoso_id = t.idoso_id and a.chave = v_chave and d.lido_em is null;
    return new;
  end if;

  select coalesce(nullif(u.nome, ''), 'Quem cuida') into v_quem from usuario u where u.id = new.registrado_por;
  perform public.emitir_alerta(
    p_idoso := t.idoso_id,
    p_tipo := 'tarefa_nao_feita',
    p_severidade := 'atencao',
    p_natureza := 'operacional',
    p_titulo := 'Não foi possível: ' || t.titulo,
    p_ref_tipo := 'tarefa',
    p_ref_id := t.id,
    p_chave := v_chave,
    p_texto_familiar := coalesce(v_quem, 'Quem cuida') || ' não conseguiu fazer: ' || t.titulo
      || coalesce('. Anotação: ' || nullif(btrim(new.nota), ''), '') || '.',
    p_familiar_so_admin := true,
    p_excluir := new.registrado_por
  );
  return new;
end $$;

drop trigger if exists trg_alerta_tarefa_resposta on public.tarefa_registro;
create trigger trg_alerta_tarefa_resposta
  after insert or update on public.tarefa_registro
  for each row execute function public.trg_alerta_tarefa_resposta();

-- Teste (desfeito no fim; se falhar, a migração é recusada) -------------------------

do $$
declare
  adm uuid := gen_random_uuid();
  fam uuid := gen_random_uuid();
  cui uuid := gen_random_uuid();
  fora uuid := gen_random_uuid();
  ido uuid;
  tar uuid;
  res text := '';
  r text;
  v text;
  n int;
  quem uuid;
  rotulo text;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  begin
    insert into auth.users (id, email) values
      (adm, 'teste-adm-' || adm || '@exemplo.invalid'),
      (fam, 'teste-fam-' || fam || '@exemplo.invalid'),
      (cui, 'teste-cui-' || cui || '@exemplo.invalid'),
      (fora, 'teste-fora-' || fora || '@exemplo.invalid');
    insert into public.idoso (nome) values ('Teste de tarefas') returning id into ido;
    insert into public.vinculo (usuario_id, idoso_id, papel, admin) values
      (adm, ido, 'familiar', true), (fam, ido, 'familiar', false), (cui, ido, 'cuidador', false);

    -- A. so o admin cria
    for quem, rotulo in select cui, 'cuidadora' union all select fam, 'familiar'
    loop
      perform set_config('request.jwt.claims', json_build_object('sub', quem, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', quem::text, true);
      begin
        set local role authenticated;
        insert into public.tarefa (idoso_id, titulo, criado_por) values (ido, 'x', quem);
        set local role postgres;
        res := res || 'cria_' || rotulo || '=sim;';
      exception when others then
        res := res || 'cria_' || rotulo || '=nao;';
      end;
    end loop;

    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    insert into public.tarefa (idoso_id, titulo, criado_por) values (ido, 'Medir a pressao', adm) returning id into tar;
    set local role postgres;
    select count(*) into n from public.alerta_destinatario d join public.alerta a on a.id = d.alerta_id
     where a.chave = 'tarefa_nova:' || tar and d.usuario_id = cui;
    res := res || 'cuidadora_sabe_da_nova=' || n || ';';

    -- B. cuidadora nao edita a tarefa; responde so em nome proprio
    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    update public.tarefa set titulo = 'mudei' where id = tar;
    select titulo into v from public.tarefa where id = tar;
    res := res || 'titulo_apos_tentativa=' || v || ';';
    begin
      insert into public.tarefa_registro (tarefa_id, data, status, registrado_por) values (tar, hoje, 'feito', adm);
      res := res || 'responder_por_outro=permitido;';
    exception when others then res := res || 'responder_por_outro=bloqueado;';
    end;

    -- C. nao consegui avisa so o admin; virar "feito" fecha o aviso
    set local role authenticated;
    insert into public.tarefa_registro (tarefa_id, data, status, nota, registrado_por)
      values (tar, hoje, 'nao_consegui', 'aparelho sem pilha', cui);
    set local role postgres;
    select string_agg(case d.usuario_id when adm then 'admin' when fam then 'familiar' else 'cuidadora' end, ',')
      into v from public.alerta_destinatario d join public.alerta a on a.id = d.alerta_id
     where a.chave = 'tarefa_nao:' || tar || ':' || hoje;
    res := res || 'aviso_nao_consegui=' || coalesce(v, 'ninguem') || ';';
    set local role authenticated;
    update public.tarefa_registro set status = 'feito', registrado_por = cui where tarefa_id = tar and data = hoje;
    set local role postgres;
    select count(*) into n from public.alerta_destinatario d join public.alerta a on a.id = d.alerta_id
     where a.chave = 'tarefa_nao:' || tar || ':' || hoje and d.lido_em is null;
    res := res || 'aviso_aberto_apos_feito=' || n || ';';

    -- D. de fora nao ve nem responde
    perform set_config('request.jwt.claims', json_build_object('sub', fora, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', fora::text, true);
    set local role authenticated;
    select count(*) into n from public.tarefa where idoso_id = ido;
    res := res || 'fora_ve=' || n || ';';
    begin
      insert into public.tarefa_registro (tarefa_id, data, status, registrado_por) values (tar, hoje - 1, 'feito', fora);
      res := res || 'fora_responde=permitido;';
    exception when others then res := res || 'fora_responde=bloqueado;';
    end;

    raise exception 'RESULTADO_TESTE|%|%', res,
      'cria_cuidadora=nao;cria_familiar=nao;cuidadora_sabe_da_nova=1;titulo_apos_tentativa=Medir a pressao;'
      'responder_por_outro=bloqueado;aviso_nao_consegui=admin;aviso_aberto_apos_feito=0;fora_ve=0;fora_responde=bloqueado;';
  exception when others then
    if sqlerrm like 'RESULTADO_TESTE|%' then r := sqlerrm; else raise; end if;
  end;
  if split_part(r, '|', 2) is distinct from split_part(r, '|', 3) then
    raise exception E'Teste das tarefas FALHOU.\nObtido:   %\nEsperado: %', split_part(r, '|', 2), split_part(r, '|', 3);
  end if;
end $$;
