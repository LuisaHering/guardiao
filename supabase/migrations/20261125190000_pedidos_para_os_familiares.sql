-- Quem cuida e a pessoa cuidada pedem algo à família toda ou a uma pessoa.
--
--  * Veem o pedido: quem pediu, a quem foi dirigido (a família toda = quem tem papel de
--    familiar) e o administrador, que vê tudo para nada se perder.
--  * Quem recebe diz "eu resolvo" (os outros ficam sabendo), depois "feito".
--  * O aviso vai só para quem o pedido é dirigido.
--  * Também é por aqui que quem cuida pede a um familiar para conferir um exame.

create table if not exists public.pedido_familia (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  autor_id uuid not null references public.usuario (id),
  tipo text not null check (tipo in ('remedio', 'compra', 'ajuda', 'ligar', 'outro', 'conferir_exame')),
  detalhe text check (detalhe is null or char_length(detalhe) <= 500),
  -- vazio = a família toda
  destinatario_id uuid references public.usuario (id),
  urgente boolean not null default false,
  status text not null default 'aberto' check (status in ('aberto', 'assumido', 'feito', 'cancelado')),
  assumido_por uuid references public.usuario (id),
  assumido_em timestamptz,
  feito_por uuid references public.usuario (id),
  feito_em timestamptz,
  pedido_exame_id uuid references public.pedido_exame (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  editado_por uuid
);
create index if not exists pedido_familia_idx on public.pedido_familia (idoso_id, status);

drop trigger if exists trg_touch on public.pedido_familia;
create trigger trg_touch before update on public.pedido_familia
  for each row execute function public.touch_updated();

alter table public.pedido_familia enable row level security;
revoke all on public.pedido_familia from anon, authenticated;
grant select on public.pedido_familia to authenticated;

drop policy if exists pedido_familia_sel on public.pedido_familia;
create policy pedido_familia_sel on public.pedido_familia for select
  using (
    public.is_member(idoso_id)
    and (
      autor_id = auth.uid()
      or destinatario_id = auth.uid()
      or public.is_admin(idoso_id)
      or (destinatario_id is null and public.papel_em(idoso_id) = 'familiar')
    )
  );

-- Aviso para pessoas escolhidas (os outros avisos do sistema vão por papel).
create or replace function public.avisar_pessoas(
  p_idoso uuid, p_pessoas uuid[], p_tipo text, p_severidade text, p_titulo text, p_texto text,
  p_ref uuid, p_chave text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_alerta uuid;
begin
  if coalesce(cardinality(p_pessoas), 0) = 0 then
    return;
  end if;
  insert into alerta (idoso_id, tipo, severidade, natureza, titulo, referencia_tipo, referencia_id, chave)
  values (p_idoso, p_tipo, p_severidade, 'operacional', p_titulo, 'pedido_familia', p_ref, p_chave)
  on conflict (idoso_id, chave) where chave is not null do nothing
  returning id into v_alerta;
  if v_alerta is null then
    return;
  end if;
  insert into alerta_destinatario (alerta_id, usuario_id, texto)
  select v_alerta, v.usuario_id, p_texto
    from vinculo v
   where v.idoso_id = p_idoso and v.deleted_at is null and v.usuario_id = any (p_pessoas);
end $$;
revoke all on function public.avisar_pessoas(uuid, uuid[], text, text, text, text, uuid, text) from public, anon, authenticated;

create or replace function public.nome_curto(p_usuario uuid)
returns text language sql security definer stable set search_path = public as $$
  select coalesce(nullif(split_part(btrim(nome), ' ', 1), ''), 'Alguém da rede') from usuario where id = p_usuario;
$$;
revoke all on function public.nome_curto(uuid) from public, anon, authenticated;

create or replace function public.frase_pedido(p_tipo text, p_detalhe text)
returns text language sql immutable as $$
  select case p_tipo
      when 'remedio' then 'Está acabando um remédio'
      when 'compra' then 'Preciso que comprem algo'
      when 'ajuda' then 'Preciso de ajuda aqui'
      when 'ligar' then 'Me liguem, por favor'
      when 'conferir_exame' then 'Conferir os valores de um exame'
      else 'Pedido' end
    || coalesce(': ' || nullif(btrim(p_detalhe), ''), '');
$$;

create or replace function public.criar_pedido_familia(
  p_idoso uuid, p_tipo text, p_detalhe text default null, p_destinatario uuid default null,
  p_urgente boolean default false, p_pedido_exame uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_para uuid[];
  v_frase text;
begin
  if v_uid is null or not public.is_member(p_idoso) then
    raise exception 'Sem acesso a este cuidado.';
  end if;
  if p_destinatario is not null and (p_destinatario = v_uid or not exists (
    select 1 from vinculo where idoso_id = p_idoso and usuario_id = p_destinatario and papel = 'familiar' and deleted_at is null
  )) then
    raise exception 'O pedido só pode ir para alguém da família.';
  end if;
  if p_tipo = 'conferir_exame' then
    if not exists (select 1 from pedido_exame where id = p_pedido_exame and idoso_id = p_idoso and status = 'resultado_enviado') then
      raise exception 'Não há resultado esperando conferência.';
    end if;
    if exists (select 1 from pedido_familia where pedido_exame_id = p_pedido_exame and status in ('aberto', 'assumido')) then
      raise exception 'Este exame já foi pedido a alguém.';
    end if;
  elsif p_tipo = 'outro' and coalesce(btrim(p_detalhe), '') = '' then
    raise exception 'Diga o que você precisa.';
  end if;

  insert into pedido_familia (idoso_id, autor_id, tipo, detalhe, destinatario_id, urgente, pedido_exame_id)
  values (p_idoso, v_uid, p_tipo, nullif(btrim(p_detalhe), ''), p_destinatario, coalesce(p_urgente, false),
          case when p_tipo = 'conferir_exame' then p_pedido_exame end)
  returning id into v_id;

  if p_destinatario is not null then
    v_para := array[p_destinatario];
  else
    select array_agg(usuario_id) into v_para from vinculo
     where idoso_id = p_idoso and papel = 'familiar' and deleted_at is null and usuario_id <> v_uid;
  end if;

  v_frase := public.frase_pedido(p_tipo, p_detalhe);
  perform public.avisar_pessoas(
    p_idoso, v_para, 'pedido_familia',
    case when coalesce(p_urgente, false) then 'urgente' else 'atencao' end,
    case when coalesce(p_urgente, false) then 'Pedido urgente de ' else 'Pedido de ' end || public.nome_curto(v_uid),
    v_frase || case when p_destinatario is null then ' (para a família toda)' else ' (para você)' end
      || '. Abra Pedidos da família.',
    v_id, 'pedido_familia:' || v_id);
  return v_id;
end $$;
revoke all on function public.criar_pedido_familia(uuid, text, text, uuid, boolean, uuid) from public, anon;
grant execute on function public.criar_pedido_familia(uuid, text, text, uuid, boolean, uuid) to authenticated;

-- p_acao: 'assumir' (eu resolvo), 'largar' (nao vou conseguir), 'concluir', 'cancelar'
create or replace function public.mudar_pedido_familia(p_pedido uuid, p_acao text)
returns void language plpgsql security definer set search_path = public as $$
declare
  p pedido_familia;
  v_uid uuid := auth.uid();
  v_recebe boolean;
  v_autor boolean;
  v_admin boolean;
  v_texto text;
begin
  select * into p from pedido_familia where id = p_pedido for update;
  if p.id is null or v_uid is null or not public.is_member(p.idoso_id) then
    raise exception 'Sem acesso a este pedido.';
  end if;
  v_autor := p.autor_id = v_uid;
  v_admin := public.is_admin(p.idoso_id);
  v_recebe := not v_autor and (
    v_admin or p.destinatario_id = v_uid
    or (p.destinatario_id is null and public.papel_em(p.idoso_id) = 'familiar'));
  if p.status in ('feito', 'cancelado') then
    raise exception 'Este pedido já foi encerrado.';
  end if;
  v_texto := public.frase_pedido(p.tipo, p.detalhe);

  if p_acao = 'assumir' then
    if not v_recebe or p.status <> 'aberto' then
      raise exception 'Este pedido já tem quem resolva, ou não é para você.';
    end if;
    update pedido_familia set status = 'assumido', assumido_por = v_uid, assumido_em = now() where id = p.id;
    perform public.avisar_pessoas(p.idoso_id, array[p.autor_id], 'pedido_familia_andamento', 'info',
      public.nome_curto(v_uid) || ' vai resolver', v_texto || '.', p.id,
      'pedido_assumido:' || p.id || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'));
  elsif p_acao = 'largar' then
    if p.status <> 'assumido' or p.assumido_por <> v_uid then
      raise exception 'Só quem assumiu pode desistir.';
    end if;
    update pedido_familia set status = 'aberto', assumido_por = null, assumido_em = null where id = p.id;
    perform public.avisar_pessoas(p.idoso_id, array[p.autor_id], 'pedido_familia_andamento', 'atencao',
      public.nome_curto(v_uid) || ' não vai conseguir', v_texto || '. O pedido voltou a ficar em aberto.', p.id,
      'pedido_largado:' || p.id || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'));
  elsif p_acao = 'concluir' then
    if not (v_recebe or v_autor) then
      raise exception 'Este pedido não é para você.';
    end if;
    update pedido_familia set status = 'feito', feito_por = v_uid, feito_em = now() where id = p.id;
    if not v_autor then
      perform public.avisar_pessoas(p.idoso_id, array[p.autor_id], 'pedido_familia_andamento', 'info',
        'Pedido resolvido', public.nome_curto(v_uid) || ' marcou como feito: ' || v_texto || '.', p.id,
        'pedido_feito:' || p.id);
    end if;
  elsif p_acao = 'cancelar' then
    if not (v_autor or v_admin) then
      raise exception 'Só quem pediu ou o administrador cancela.';
    end if;
    update pedido_familia set status = 'cancelado' where id = p.id;
  else
    raise exception 'Ação desconhecida.';
  end if;

  -- Assumido ou encerrado: o aviso de "novo pedido" deixa de pedir atenção.
  if p_acao <> 'largar' then
    update alerta_destinatario d set lido_em = now()
      from alerta a
     where a.id = d.alerta_id and a.idoso_id = p.idoso_id and d.lido_em is null
       and a.chave = 'pedido_familia:' || p.id;
  end if;
end $$;
revoke all on function public.mudar_pedido_familia(uuid, text) from public, anon;
grant execute on function public.mudar_pedido_familia(uuid, text) to authenticated;

-- Exame conferido ou cancelado: o pedido de "conferir" se encerra sozinho.
create or replace function public.trg_encerra_conferencia_pedida()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and new.status in ('concluido', 'cancelado') then
    update pedido_familia
       set status = case when new.status = 'concluido' then 'feito' else 'cancelado' end,
           feito_por = case when new.status = 'concluido' then auth.uid() end,
           feito_em = case when new.status = 'concluido' then now() end
     where pedido_exame_id = new.id and status in ('aberto', 'assumido');
    update alerta_destinatario d set lido_em = now()
      from alerta a
      join pedido_familia f on a.chave = 'pedido_familia:' || f.id
     where a.id = d.alerta_id and f.pedido_exame_id = new.id and d.lido_em is null;
  end if;
  return new;
end $$;
drop trigger if exists trg_encerra_conferencia_pedida on public.pedido_exame;
create trigger trg_encerra_conferencia_pedida
  after update on public.pedido_exame
  for each row execute function public.trg_encerra_conferencia_pedida();

-- Teste (desfeito no fim; se falhar, a migração é recusada) -------------------------
do $$
declare
  adm uuid := gen_random_uuid();
  ana uuid := gen_random_uuid();
  beto uuid := gen_random_uuid();
  cui uuid := gen_random_uuid();
  ido uuid;
  todos uuid;
  so_ana uuid;
  res text := '';
  r text;
  v text;
  n int;
begin
  begin
    insert into auth.users (id, email) values
      (adm, 'teste-adm-' || adm || '@exemplo.invalid'), (ana, 'teste-ana-' || ana || '@exemplo.invalid'),
      (beto, 'teste-beto-' || beto || '@exemplo.invalid'), (cui, 'teste-cui-' || cui || '@exemplo.invalid');
    insert into public.idoso (nome) values ('Teste de pedidos') returning id into ido;
    insert into public.vinculo (usuario_id, idoso_id, papel, admin) values
      (adm, ido, 'familiar', true), (ana, ido, 'familiar', false), (beto, ido, 'familiar', false), (cui, ido, 'cuidador', false);

    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    todos := public.criar_pedido_familia(ido, 'compra', 'fraldas', null, false);
    so_ana := public.criar_pedido_familia(ido, 'ligar', null, ana, true);
    begin
      perform public.criar_pedido_familia(ido, 'ligar', null, cui, false);
      res := res || 'para_nao_familiar=permitido;';
    exception when others then res := res || 'para_nao_familiar=bloqueado;';
    end;
    set local role authenticated;
    begin
      perform public.mudar_pedido_familia(todos, 'assumir');
      res := res || 'autor_assume=permitido;';
    exception when others then res := res || 'autor_assume=bloqueado;';
    end;

    -- quem ve o que
    perform set_config('request.jwt.claims', json_build_object('sub', beto, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', beto::text, true);
    set local role authenticated;
    select count(*) into n from public.pedido_familia where idoso_id = ido;
    res := res || 'beto_ve=' || n || ';';
    begin
      perform public.mudar_pedido_familia(so_ana, 'assumir');
      res := res || 'beto_assume_o_da_ana=permitido;';
    exception when others then res := res || 'beto_assume_o_da_ana=bloqueado;';
    end;
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    select count(*) into n from public.pedido_familia where idoso_id = ido;
    res := res || 'admin_ve=' || n || ';';

    -- avisos: so a quem foi dirigido (o admin nao e avisado do que e so da Ana)
    set local role postgres;
    select count(*) into n from public.alerta_destinatario d join public.alerta a on a.id = d.alerta_id
     where a.chave = 'pedido_familia:' || todos;
    res := res || 'avisados_todos=' || n || ';';
    select string_agg(case d.usuario_id when ana then 'ana' else 'outro' end, ',') || ' ' || min(a.severidade) into v
      from public.alerta_destinatario d join public.alerta a on a.id = d.alerta_id where a.chave = 'pedido_familia:' || so_ana;
    res := res || 'aviso_da_ana=' || v || ';';

    -- assumir, nao poder assumir de novo, desistir, concluir
    perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', ana::text, true);
    set local role authenticated;
    perform public.mudar_pedido_familia(todos, 'assumir');
    perform set_config('request.jwt.claims', json_build_object('sub', beto, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', beto::text, true);
    set local role authenticated;
    begin
      perform public.mudar_pedido_familia(todos, 'assumir');
      res := res || 'assumir_duas_vezes=permitido;';
    exception when others then res := res || 'assumir_duas_vezes=bloqueado;';
    end;
    perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', ana::text, true);
    set local role authenticated;
    perform public.mudar_pedido_familia(todos, 'largar');
    perform public.mudar_pedido_familia(todos, 'assumir');
    perform public.mudar_pedido_familia(todos, 'concluir');
    select status into v from public.pedido_familia where id = todos;
    res := res || 'fim=' || v || ';';
    set local role postgres;
    select count(*) into n from public.alerta_destinatario d join public.alerta a on a.id = d.alerta_id
     where a.idoso_id = ido and a.tipo = 'pedido_familia_andamento' and d.usuario_id = cui;
    res := res || 'andamentos_para_quem_pediu=' || n || ';';

    raise exception 'RESULTADO_TESTE|%|%', res,
      'para_nao_familiar=bloqueado;autor_assume=bloqueado;beto_ve=1;beto_assume_o_da_ana=bloqueado;admin_ve=2;'
      'avisados_todos=3;aviso_da_ana=ana urgente;assumir_duas_vezes=bloqueado;fim=feito;andamentos_para_quem_pediu=4;';
  exception when others then
    if sqlerrm like 'RESULTADO_TESTE|%' then r := sqlerrm; else raise; end if;
  end;
  if split_part(r, '|', 2) is distinct from split_part(r, '|', 3) then
    raise exception E'Teste dos pedidos à família FALHOU.\nObtido:   %\nEsperado: %', split_part(r, '|', 2), split_part(r, '|', 3);
  end if;
end $$;
