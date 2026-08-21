-- Guardião — schema inicial (a partir da modelagem 2.1)
-- Rodar no SQL Editor do Supabase. Idempotente o suficiente para um projeto novo.
--
-- Convenções:
--   . toda tabela de domínio tem created_at; a maioria tem updated_at + editado_por + deleted_at.
--   . acesso mediado por vinculo (RLS). As funções is_member / is_admin evitam recursão
--     porque rodam como SECURITY DEFINER (ignoram RLS ao consultar vinculo).
--   . exclusão pela API é sempre soft (update deleted_at). Não há grant de DELETE.
--   . o perfil de emergência é servido por função SECURITY DEFINER exposta ao papel anon.

create extension if not exists pgcrypto;

-- =====================================================================
-- 1. IDENTIDADE E ACESSO
-- =====================================================================

create table if not exists public.usuario (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  editado_por uuid,
  deleted_at timestamptz
);

create table if not exists public.idoso (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  como_chamar text,
  data_nascimento date,
  foto_url text,
  tipo_sanguineo text,
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  editado_por uuid,
  deleted_at timestamptz
);

create table if not exists public.convite (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  email text not null,
  papel text not null,
  admin boolean not null default false,
  token text not null unique,
  criado_por uuid references public.usuario (id),
  expira_em timestamptz,
  aceito_em timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.vinculo (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuario (id) on delete cascade,
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  papel text not null check (papel in ('idoso', 'familiar', 'cuidador')),
  admin boolean not null default false,
  pode_contribuir boolean not null default true,
  convite_id uuid references public.convite (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  editado_por uuid,
  deleted_at timestamptz,
  unique (usuario_id, idoso_id)
);

create table if not exists public.consentimento (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  versao_termo text not null,
  operado_por uuid references public.usuario (id),
  aceito_em timestamptz not null default now(),
  revogado_em timestamptz,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- 2. EMERGÊNCIA E CONDIÇÕES
-- =====================================================================

create table if not exists public.contato_emergencia (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  nome text not null,
  telefone text,
  relacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  editado_por uuid,
  deleted_at timestamptz
);

create table if not exists public.alergia (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  substancia text not null,
  reacao text,
  gravidade text check (gravidade in ('leve', 'moderada', 'grave')),
  autor_id uuid references public.usuario (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  editado_por uuid,
  deleted_at timestamptz
);

create table if not exists public.condicao (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  nome text not null,
  desde date,
  ativa boolean not null default true,
  autor_id uuid references public.usuario (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  editado_por uuid,
  deleted_at timestamptz
);

create table if not exists public.emergencia_token (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  token text not null unique,
  ativo boolean not null default true,
  criado_por uuid references public.usuario (id),
  revogado_em timestamptz,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- 3. MEDICAÇÃO E RECEITA
-- =====================================================================

create table if not exists public.receita (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  medico text,
  data date,
  arquivo_url text,
  status_processamento text,
  autor_id uuid references public.usuario (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  editado_por uuid,
  deleted_at timestamptz
);

create table if not exists public.medicacao (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  receita_id uuid references public.receita (id),
  nome text not null,
  dosagem text,
  instrucoes text,
  ativo boolean not null default true,
  autor_id uuid references public.usuario (id),
  confirmado boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  editado_por uuid,
  deleted_at timestamptz
);

-- Adesão sob demanda: a linha só existe quando há registro real.
-- Silêncio = ausência de linha (ver modelagem 2.1, 3.5).
create table if not exists public.registro_medicacao (
  id uuid primary key default gen_random_uuid(),
  medicacao_id uuid not null references public.medicacao (id) on delete cascade,
  data date not null,
  status text not null check (status in ('dada', 'nao_dada')),
  motivo text check (motivo in ('esqueceu', 'recusou', 'acabou', 'efeito_adverso', 'outro')),
  observacao text,
  registrado_por uuid references public.usuario (id),
  registrado_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  editado_por uuid,
  deleted_at timestamptz,
  unique (medicacao_id, data)
);

-- =====================================================================
-- 4. REGISTROS DO DIA A DIA
-- =====================================================================

create table if not exists public.sintoma (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  autor_id uuid references public.usuario (id),
  descricao text not null,
  gravidade int check (gravidade between 1 and 5),
  duracao_declarada text check (duracao_declarada in ('hoje', 'alguns_dias', 'algumas_semanas', 'meses_ou_mais')),
  origem text not null default 'manual',
  origem_mensagem_id uuid,
  confirmado boolean not null default true,
  data timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  editado_por uuid,
  deleted_at timestamptz
);

create table if not exists public.humor (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  autor_id uuid references public.usuario (id),
  humor text not null,
  origem text not null default 'manual',
  origem_mensagem_id uuid,
  confirmado boolean not null default true,
  data timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  editado_por uuid,
  deleted_at timestamptz
);

create table if not exists public.entrada_diario (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  autor_id uuid references public.usuario (id),
  data timestamptz not null default now(),
  alimentacao text,
  ocorrencias text,
  foto_url text,
  origem text not null default 'manual',
  confirmado boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  editado_por uuid,
  deleted_at timestamptz
);

create table if not exists public.preferencia (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  autor_id uuid references public.usuario (id),
  categoria text,
  chave text,
  valor text,
  origem text not null default 'manual',
  origem_mensagem_id uuid,
  confirmado boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  editado_por uuid,
  deleted_at timestamptz
);

create table if not exists public.memoria (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  autor_id uuid references public.usuario (id),
  titulo text,
  conteudo text,
  origem text not null default 'manual',
  origem_mensagem_id uuid,
  confirmado boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  editado_por uuid,
  deleted_at timestamptz
);

create table if not exists public.item_pauta (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  titulo text not null,
  detalhe text,
  origem_mensagem_id uuid,
  consulta_id uuid,
  resolvido_em timestamptz,
  resolvido_por uuid references public.usuario (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  editado_por uuid,
  deleted_at timestamptz
);

-- =====================================================================
-- 5. CONVERSA
-- =====================================================================

create table if not exists public.conversa (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  iniciada_por uuid references public.usuario (id),
  tipo text check (tipo in ('checkin_diario', 'livre')),
  data_referencia date,
  status text check (status in ('pendente', 'concluida')),
  created_at timestamptz not null default now()
);

create table if not exists public.mensagem (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.conversa (id) on delete cascade,
  papel_emissor text check (papel_emissor in ('user', 'assistant')),
  conteudo text,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- 6. DOCUMENTOS E EXTRAÇÃO
-- =====================================================================

create table if not exists public.consulta (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  data timestamptz,
  medico text,
  especialidade text,
  audio_url text,
  status_processamento text check (status_processamento in ('pendente', 'processando', 'concluido', 'falhou')),
  transcricao text,
  resumo text,
  autor_id uuid references public.usuario (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  editado_por uuid,
  deleted_at timestamptz
);

create table if not exists public.exame (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  tipo text,
  laboratorio text,
  data timestamptz,
  arquivo_url text,
  confirmado_por uuid not null references public.usuario (id),
  confirmado_em timestamptz not null default now(),
  autor_id uuid references public.usuario (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  editado_por uuid,
  deleted_at timestamptz
);

create table if not exists public.analito (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  nome_canonico text not null,
  unidade_canonica text,
  fundido_em uuid references public.analito (id),
  created_at timestamptz not null default now()
);

create table if not exists public.exame_resultado (
  id uuid primary key default gen_random_uuid(),
  exame_id uuid not null references public.exame (id) on delete cascade,
  analito_id uuid not null references public.analito (id),
  valor numeric,
  unidade text,
  valor_original numeric,
  unidade_original text,
  convertido boolean not null default false,
  ref_min numeric,
  ref_max numeric,
  corrigido_manualmente boolean not null default false
);

create table if not exists public.diretiva (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  respostas jsonb,
  versao_questionario text,
  modo_preenchimento text check (modo_preenchimento in ('titular', 'assistido')),
  assistido_por uuid references public.usuario (id),
  titular_presente boolean,
  pdf_url text,
  vigente boolean not null default true,
  substitui_id uuid references public.diretiva (id),
  gerada_em timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.anexo (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  autor_id uuid references public.usuario (id),
  tipo text check (tipo in ('foto', 'pdf', 'audio')),
  url text,
  referencia_tipo text,
  referencia_id uuid,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- =====================================================================
-- 7. GERADO PELA IA
-- =====================================================================

create table if not exists public.visao_360 (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  conteudo text,
  gerado_em timestamptz not null default now()
);

create table if not exists public.alerta (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  tipo text,
  severidade text check (severidade in ('info', 'atencao', 'urgente')),
  natureza text check (natureza in ('operacional', 'clinico')),
  referencia_tipo text,
  referencia_id uuid,
  gerado_em timestamptz not null default now()
);

create table if not exists public.alerta_destinatario (
  id uuid primary key default gen_random_uuid(),
  alerta_id uuid not null references public.alerta (id) on delete cascade,
  usuario_id uuid not null references public.usuario (id) on delete cascade,
  texto text,
  lido_em timestamptz
);

create table if not exists public.folha_cuidado (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  conteudo text,
  gerado_em timestamptz not null default now()
);

-- =====================================================================
-- 8. FUNÇÕES DE ACESSO (SECURITY DEFINER, evitam recursão de RLS)
-- =====================================================================

create or replace function public.is_member(p_idoso uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from vinculo v
    where v.idoso_id = p_idoso and v.usuario_id = auth.uid() and v.deleted_at is null
  );
$$;

create or replace function public.is_admin(p_idoso uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from vinculo v
    where v.idoso_id = p_idoso and v.usuario_id = auth.uid()
      and v.admin = true and v.deleted_at is null
  );
$$;

create or replace function public.has_any_member(p_idoso uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from vinculo v where v.idoso_id = p_idoso and v.deleted_at is null);
$$;

create or replace function public.shares_idoso(p_other uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from vinculo a join vinculo b on a.idoso_id = b.idoso_id
    where a.usuario_id = auth.uid() and b.usuario_id = p_other
      and a.deleted_at is null and b.deleted_at is null
  );
$$;

-- =====================================================================
-- 9. TRIGGERS
-- =====================================================================

-- Cria a linha em public.usuario quando um auth.users nasce.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.usuario (id, nome, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'nome', new.email), new.email)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- updated_at + editado_por a cada UPDATE (accountability, D25).
create or replace function public.touch_updated()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  new.editado_por = auth.uid();
  return new;
end $$;

-- O vínculo do próprio idoso não pode ser removido do registro (D14).
create or replace function public.protect_idoso_vinculo()
returns trigger language plpgsql as $$
begin
  if new.deleted_at is not null and old.deleted_at is null and old.papel = 'idoso' then
    raise exception 'O vinculo do proprio idoso nao pode ser removido do registro';
  end if;
  return new;
end $$;

drop trigger if exists trg_protect_idoso on public.vinculo;
create trigger trg_protect_idoso
  before update on public.vinculo
  for each row execute function public.protect_idoso_vinculo();

-- Perfil de emergência: função pública que resolve o token e monta os seis campos.
-- Exposta ao papel anon. Não passa por sessão de usuário (exceção deliberada ao RLS).
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
        'nome', m.nome, 'dosagem', m.dosagem)), '[]'::jsonb)
      from medicacao m where m.idoso_id = i.id and m.ativo and m.deleted_at is null),
    'contatos', (select coalesce(jsonb_agg(jsonb_build_object(
        'nome', ce.nome, 'telefone', ce.telefone, 'relacao', ce.relacao)), '[]'::jsonb)
      from contato_emergencia ce where ce.idoso_id = i.id and ce.deleted_at is null)
  ) end
  from emergencia_token et
  join idoso i on i.id = et.idoso_id
  where et.token = p_token and et.ativo = true and et.revogado_em is null and i.deleted_at is null;
$$;

grant execute on function public.emergencia_por_token(text) to anon;

-- =====================================================================
-- 10. RLS, GRANTS E POLICIES
-- =====================================================================

-- Liga RLS em todas as tabelas do schema public.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- Sem grant de DELETE em lugar nenhum: exclusão pela API é sempre soft (update deleted_at).
grant select, update on public.usuario to authenticated;
grant select, insert, update on public.idoso to authenticated;
grant select, insert, update on public.vinculo to authenticated;
grant select, insert, update on public.convite to authenticated;
grant select, insert, update on public.consentimento to authenticated;
grant select, insert, update on public.emergencia_token to authenticated;

-- usuario: eu vejo a mim mesmo e quem compartilha idoso comigo.
create policy usuario_sel on public.usuario for select
  using (id = auth.uid() or public.shares_idoso(id));
create policy usuario_upd on public.usuario for update
  using (id = auth.uid()) with check (id = auth.uid());

-- idoso: membros veem; qualquer autenticado cria (e vira admin via vinculo); admin edita.
create policy idoso_sel on public.idoso for select using (public.is_member(id));
create policy idoso_ins on public.idoso for insert with check (true);
create policy idoso_upd on public.idoso for update
  using (public.is_admin(id)) with check (public.is_admin(id));

-- vinculo: membro vê; o primeiro membro pode se auto-vincular (bootstrap do admin);
-- depois só admin gerencia.
create policy vinculo_sel on public.vinculo for select using (public.is_member(idoso_id));
create policy vinculo_ins on public.vinculo for insert with check (
  (usuario_id = auth.uid() and not public.has_any_member(idoso_id))
  or public.is_admin(idoso_id)
);
create policy vinculo_upd on public.vinculo for update
  using (public.is_admin(idoso_id)) with check (public.is_admin(idoso_id));

-- convite, consentimento, emergencia_token: leitura por membro, escrita por admin.
create policy convite_sel on public.convite for select using (public.is_admin(idoso_id));
create policy convite_ins on public.convite for insert with check (public.is_admin(idoso_id));
create policy convite_upd on public.convite for update
  using (public.is_admin(idoso_id)) with check (public.is_admin(idoso_id));

create policy consent_sel on public.consentimento for select using (public.is_member(idoso_id));
create policy consent_ins on public.consentimento for insert with check (public.is_admin(idoso_id));
create policy consent_upd on public.consentimento for update
  using (public.is_admin(idoso_id)) with check (public.is_admin(idoso_id));

create policy emgtoken_sel on public.emergencia_token for select using (public.is_member(idoso_id));
create policy emgtoken_ins on public.emergencia_token for insert with check (public.is_admin(idoso_id));
create policy emgtoken_upd on public.emergencia_token for update
  using (public.is_admin(idoso_id)) with check (public.is_admin(idoso_id));

-- Tabelas com idoso_id direto: CRUD (sem delete) por qualquer membro do idoso.
do $$
declare t text;
begin
  foreach t in array array[
    'contato_emergencia','alergia','condicao','medicacao','sintoma','humor',
    'entrada_diario','preferencia','memoria','item_pauta','conversa','receita',
    'consulta','exame','analito','diretiva','visao_360','alerta','folha_cuidado'
  ] loop
    execute format('grant select, insert, update on public.%I to authenticated;', t);
    execute format('create policy %1$s_sel on public.%1$s for select using (public.is_member(idoso_id));', t);
    execute format('create policy %1$s_ins on public.%1$s for insert with check (public.is_member(idoso_id));', t);
    execute format('create policy %1$s_upd on public.%1$s for update using (public.is_member(idoso_id)) with check (public.is_member(idoso_id));', t);
  end loop;
end $$;

-- Tabelas filhas: acesso pelo idoso do pai.
grant select, insert, update on public.registro_medicacao to authenticated;
create policy regmed_all on public.registro_medicacao for all
  using (public.is_member((select m.idoso_id from public.medicacao m where m.id = medicacao_id)))
  with check (public.is_member((select m.idoso_id from public.medicacao m where m.id = medicacao_id)));

grant select, insert, update on public.exame_resultado to authenticated;
create policy exres_all on public.exame_resultado for all
  using (public.is_member((select e.idoso_id from public.exame e where e.id = exame_id)))
  with check (public.is_member((select e.idoso_id from public.exame e where e.id = exame_id)));

grant select, insert, update on public.mensagem to authenticated;
create policy msg_all on public.mensagem for all
  using (public.is_member((select c.idoso_id from public.conversa c where c.id = conversa_id)))
  with check (public.is_member((select c.idoso_id from public.conversa c where c.id = conversa_id)));

grant select, insert, update on public.anexo to authenticated;
create policy anexo_all on public.anexo for all
  using (public.is_member(idoso_id)) with check (public.is_member(idoso_id));

-- alerta_destinatario: o destinatário vê e marca como lido o que é dele;
-- membros do idoso também enxergam.
grant select, insert, update on public.alerta_destinatario to authenticated;
create policy alertdest_sel on public.alerta_destinatario for select
  using (usuario_id = auth.uid()
    or public.is_member((select a.idoso_id from public.alerta a where a.id = alerta_id)));
create policy alertdest_upd on public.alerta_destinatario for update
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

-- =====================================================================
-- 11. TRIGGERS DE updated_at (nas tabelas que têm as colunas)
-- =====================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'usuario','idoso','vinculo','contato_emergencia','alergia','condicao','medicacao',
    'registro_medicacao','sintoma','humor','entrada_diario','preferencia','memoria',
    'item_pauta','receita','consulta','exame'
  ] loop
    execute format('drop trigger if exists trg_touch on public.%I;', t);
    execute format('create trigger trg_touch before update on public.%I for each row execute function public.touch_updated();', t);
  end loop;
end $$;
