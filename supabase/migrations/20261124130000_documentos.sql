-- Documentos do idoso: pastas e arquivos que o administrador guarda (certidão de
-- nascimento, carteirinha do plano de saúde, RG e outros).
--
-- Regras:
--  * só o administrador cria pastas e envia arquivos; os demais membros apenas veem;
--  * o cuidador só vê o que estiver em pasta marcada como "visível para quem cuida"
--    (e cujas pastas-mãe também estejam); arquivo solto na raiz não é visível a ele;
--  * arquivos ficam num bucket privado, abertos por link temporário;
--  * não há DELETE: "remover" esconde (deleted_at), como no resto do sistema.
-- As pastas automáticas (exames, receitas, consultas, diretivas) não são gravadas aqui:
-- a tela as monta a partir das tabelas que já existem, sem duplicar arquivo.

-- 1. Bucket privado, com limite de tamanho e de tipo ----------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documentos', 'documentos', false, 15 * 1024 * 1024,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. Tabelas ---------------------------------------------------------------------------

create table if not exists public.documento_pasta (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  pai_id uuid references public.documento_pasta (id),
  nome text not null check (char_length(btrim(nome)) between 1 and 80),
  visivel_cuidador boolean not null default false,
  criado_por uuid references public.usuario (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  editado_por uuid,
  deleted_at timestamptz
);

create table if not exists public.documento (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  pasta_id uuid references public.documento_pasta (id),
  nome text not null check (char_length(btrim(nome)) between 1 and 120),
  arquivo_url text not null,
  tipo text,
  tamanho bigint,
  autor_id uuid references public.usuario (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  editado_por uuid,
  deleted_at timestamptz
);

create index if not exists documento_pasta_idoso_idx on public.documento_pasta (idoso_id, pai_id);
create index if not exists documento_idoso_idx on public.documento (idoso_id, pasta_id);

drop trigger if exists trg_touch on public.documento_pasta;
create trigger trg_touch before update on public.documento_pasta
  for each row execute function public.touch_updated();
drop trigger if exists trg_touch on public.documento;
create trigger trg_touch before update on public.documento
  for each row execute function public.touch_updated();

alter table public.documento_pasta enable row level security;
alter table public.documento enable row level security;

grant select, insert, update on public.documento_pasta to authenticated;
grant select, insert, update on public.documento to authenticated;

-- 3. Quem vê o quê ---------------------------------------------------------------------

-- Uma pasta é visível ao cuidador se ela e todas as pastas-mãe estiverem marcadas.
create or replace function public.pasta_visivel_cuidador(p_pasta uuid)
returns boolean language sql security definer stable set search_path = public as $$
  with recursive cadeia as (
    select id, pai_id, visivel_cuidador, 1 as nivel
      from documento_pasta where id = p_pasta and deleted_at is null
    union all
    select p.id, p.pai_id, p.visivel_cuidador, c.nivel + 1
      from documento_pasta p join cadeia c on p.id = c.pai_id
     where p.deleted_at is null and c.nivel < 10
  )
  select coalesce(
    (select bool_and(visivel_cuidador) from cadeia)
      and exists (select 1 from cadeia where id = p_pasta),
    false
  );
$$;

grant execute on function public.pasta_visivel_cuidador(uuid) to authenticated;

-- A pasta de destino de um documento precisa ser do mesmo idoso.
create or replace function public.pasta_do_idoso(p_pasta uuid, p_idoso uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select p_pasta is null or exists (
    select 1 from documento_pasta where id = p_pasta and idoso_id = p_idoso
  );
$$;

grant execute on function public.pasta_do_idoso(uuid, uuid) to authenticated;

drop policy if exists docpasta_sel on public.documento_pasta;
create policy docpasta_sel on public.documento_pasta for select
  using (
    public.is_member(idoso_id)
    and (public.papel_em(idoso_id) <> 'cuidador' or public.pasta_visivel_cuidador(id))
  );

drop policy if exists docpasta_ins on public.documento_pasta;
create policy docpasta_ins on public.documento_pasta for insert
  with check (public.is_admin(idoso_id) and public.pasta_do_idoso(pai_id, idoso_id));

drop policy if exists docpasta_upd on public.documento_pasta;
create policy docpasta_upd on public.documento_pasta for update
  using (public.is_admin(idoso_id))
  with check (public.is_admin(idoso_id) and public.pasta_do_idoso(pai_id, idoso_id));

drop policy if exists documento_sel on public.documento;
create policy documento_sel on public.documento for select
  using (
    public.is_member(idoso_id)
    and (
      public.papel_em(idoso_id) <> 'cuidador'
      or (pasta_id is not null and public.pasta_visivel_cuidador(pasta_id))
    )
  );

drop policy if exists documento_ins on public.documento;
create policy documento_ins on public.documento for insert
  with check (public.is_admin(idoso_id) and public.pasta_do_idoso(pasta_id, idoso_id));

drop policy if exists documento_upd on public.documento;
create policy documento_upd on public.documento for update
  using (public.is_admin(idoso_id))
  with check (public.is_admin(idoso_id) and public.pasta_do_idoso(pasta_id, idoso_id));

-- 4. Arquivos no Storage: só abre quem pode ver o documento; só o admin envia -------------

drop policy if exists documentos_sel on storage.objects;
create policy documentos_sel on storage.objects for select to authenticated
  using (
    bucket_id = 'documentos'
    and exists (
      select 1 from public.documento d
       where d.arquivo_url = storage.objects.name and d.deleted_at is null
    )
  );

drop policy if exists documentos_ins on storage.objects;
create policy documentos_ins on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documentos'
    and public.is_admin(((storage.foldername(name))[1])::uuid)
  );

-- 5. Teste das regras (desfeito no fim; se falhar, a migração é recusada) ------------------

do $$
declare
  adm uuid := gen_random_uuid();
  fam uuid := gen_random_uuid();
  cui uuid := gen_random_uuid();
  fora uuid := gen_random_uuid();
  ido uuid;
  p_vis uuid;
  p_oculta uuid;
  p_filha uuid;
  res text := '';
  r text;
  n int;
  quem uuid;
  rotulo text;
begin
  begin
    insert into auth.users (id, email) values
      (adm, 'teste-adm-' || adm || '@exemplo.invalid'),
      (fam, 'teste-fam-' || fam || '@exemplo.invalid'),
      (cui, 'teste-cui-' || cui || '@exemplo.invalid'),
      (fora, 'teste-fora-' || fora || '@exemplo.invalid');
    insert into public.idoso (nome) values ('Teste de documentos') returning id into ido;
    insert into public.vinculo (usuario_id, idoso_id, papel, admin) values
      (adm, ido, 'familiar', true),
      (fam, ido, 'familiar', false),
      (cui, ido, 'cuidador', false);

    -- montagem como dono: uma pasta visivel, uma oculta e uma filha da visivel
    set local role postgres;
    insert into public.documento_pasta (idoso_id, nome, visivel_cuidador)
      values (ido, 'Plano de saude', true) returning id into p_vis;
    insert into public.documento_pasta (idoso_id, nome, visivel_cuidador)
      values (ido, 'Identificacao', false) returning id into p_oculta;
    insert into public.documento_pasta (idoso_id, pai_id, nome, visivel_cuidador)
      values (ido, p_vis, 'Filha oculta', false) returning id into p_filha;
    insert into public.documento (idoso_id, pasta_id, nome, arquivo_url) values
      (ido, p_vis, 'carteirinha.pdf', ido || '/a'),
      (ido, p_oculta, 'rg.pdf', ido || '/b'),
      (ido, p_filha, 'filha.pdf', ido || '/c'),
      (ido, null, 'solto.pdf', ido || '/d');
    reset role;

    -- o que cada pessoa ve (pastas, documentos)
    for quem, rotulo in
      select adm, 'admin' union all select fam, 'familiar' union all
      select cui, 'cuidador' union all select fora, 'fora'
    loop
      perform set_config('request.jwt.claims', json_build_object('sub', quem, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', quem::text, true);
      set local role authenticated;
      res := res || rotulo || '=' ||
        (select count(*) from public.documento_pasta where idoso_id = ido) || ',' ||
        (select count(*) from public.documento where idoso_id = ido) || ';';
      reset role;
    end loop;

    -- quem pode criar pasta e documento
    for quem, rotulo in
      select adm, 'admin' union all select fam, 'familiar' union all select cui, 'cuidador'
    loop
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', quem, 'role', 'authenticated')::text, true);
        perform set_config('request.jwt.claim.sub', quem::text, true);
        set local role authenticated;
        insert into public.documento_pasta (idoso_id, nome) values (ido, 'nova ' || rotulo);
        reset role;
        res := res || 'cria_pasta_' || rotulo || '=sim;';
      exception when others then
        reset role;
        res := res || 'cria_pasta_' || rotulo || '=nao;';
      end;
    end loop;

    -- documento em pasta de outro idoso nao entra
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', adm::text, true);
      set local role authenticated;
      insert into public.documento (idoso_id, pasta_id, nome, arquivo_url)
        values (ido, gen_random_uuid(), 'x.pdf', ido || '/e');
      reset role;
      res := res || 'pasta_inexistente=aceita;';
    exception when others then
      reset role;
      res := res || 'pasta_inexistente=recusada;';
    end;

    raise exception 'RESULTADO_TESTE|%|%', res,
      -- admin e familiar: 3 pastas e 4 documentos; cuidador: so a visivel (a filha herda a restricao da propria marca) e 1 documento; fora: nada
      'admin=3,4;familiar=3,4;cuidador=1,1;fora=0,0;'
      'cria_pasta_admin=sim;cria_pasta_familiar=nao;cria_pasta_cuidador=nao;pasta_inexistente=recusada;';
  exception when others then
    if sqlerrm like 'RESULTADO_TESTE|%' then r := sqlerrm; else raise; end if;
  end;

  if split_part(r, '|', 2) is distinct from split_part(r, '|', 3) then
    raise exception E'Teste dos documentos FALHOU.\nObtido:   %\nEsperado: %',
      split_part(r, '|', 2), split_part(r, '|', 3);
  end if;
end $$;
