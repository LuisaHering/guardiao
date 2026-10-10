-- Guardião — fase P2 (IA e documentos): consultas, receitas, exames, analitos, insights.
-- Idempotente: pode rodar mais de uma vez.

-- =====================================================================
-- 1. STORAGE: um bucket privado por tipo de documento
--    Convenção de caminho: "{idoso_id}/{arquivo}" (mesma regra do bucket diario).
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('consultas', 'consultas', false),
       ('receitas', 'receitas', false),
       ('exames', 'exames', false)
on conflict (id) do nothing;

do $$
declare b text;
begin
  foreach b in array array['consultas', 'receitas', 'exames'] loop
    execute format('drop policy if exists %I on storage.objects', b || '_sel');
    execute format('drop policy if exists %I on storage.objects', b || '_ins');
    execute format('drop policy if exists %I on storage.objects', b || '_upd');

    execute format($f$
      create policy %I on storage.objects for select to authenticated
      using (bucket_id = %L and public.is_member(((storage.foldername(name))[1])::uuid))
    $f$, b || '_sel', b);

    execute format($f$
      create policy %I on storage.objects for insert to authenticated
      with check (bucket_id = %L and public.is_member(((storage.foldername(name))[1])::uuid))
    $f$, b || '_ins', b);

    execute format($f$
      create policy %I on storage.objects for update to authenticated
      using (bucket_id = %L and public.is_member(((storage.foldername(name))[1])::uuid))
      with check (bucket_id = %L and public.is_member(((storage.foldername(name))[1])::uuid))
    $f$, b || '_upd', b, b);
  end loop;
end $$;

-- =====================================================================
-- 2. CONSULTA: resumo estruturado (acoes, remedios, exames, duvidas)
-- =====================================================================

alter table public.consulta add column if not exists resumo_json jsonb;

-- =====================================================================
-- 3. ANALITO: nome unico por idoso entre os que nao foram fundidos
-- =====================================================================

create unique index if not exists analito_nome_ativo_uq
  on public.analito (idoso_id, (lower(nome_canonico)))
  where fundido_em is null;

-- =====================================================================
-- 4. EXAME: confirmacao e etapa do envio, nao estado do exame.
--    Esta funcao grava exame + analitos novos + resultados numa transacao so:
--    ou o exame confirmado existe inteiro, ou nao existe nada.
--    SECURITY INVOKER: o RLS de cada tabela continua valendo.
-- =====================================================================

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

  return v_exame;
end $$;

revoke all on function public.confirmar_exame(uuid, text, text, timestamptz, text, jsonb) from public, anon;
grant execute on function public.confirmar_exame(uuid, text, text, timestamptz, text, jsonb) to authenticated;

-- =====================================================================
-- 5. ANALITO: fusao manual de duplicados (ex: "Glicemia" e "Glicose em jejum").
--    So funde analitos do mesmo idoso e com a mesma unidade, para nao misturar
--    unidades dentro da mesma serie.
-- =====================================================================

create or replace function public.fundir_analitos(p_origem uuid, p_destino uuid)
returns void
language plpgsql security invoker set search_path = public as $$
declare
  o public.analito;
  d public.analito;
begin
  if p_origem = p_destino then
    raise exception 'Escolha dois analitos diferentes';
  end if;
  select * into o from public.analito where id = p_origem and fundido_em is null;
  select * into d from public.analito where id = p_destino and fundido_em is null;
  if o.id is null or d.id is null then
    raise exception 'Analito nao encontrado ou ja fundido';
  end if;
  if o.idoso_id <> d.idoso_id then
    raise exception 'Os analitos sao de idosos diferentes';
  end if;
  if not public.is_member(o.idoso_id) then
    raise exception 'Sem acesso a este idoso';
  end if;
  if lower(coalesce(o.unidade_canonica, '')) is distinct from lower(coalesce(d.unidade_canonica, '')) then
    raise exception 'Unidades diferentes (% e %): nao e seguro fundir', o.unidade_canonica, d.unidade_canonica;
  end if;

  update public.exame_resultado set analito_id = p_destino where analito_id = p_origem;
  update public.analito set fundido_em = p_destino where id = p_origem;
end $$;

revoke all on function public.fundir_analitos(uuid, uuid) from public, anon;
grant execute on function public.fundir_analitos(uuid, uuid) to authenticated;

-- =====================================================================
-- 6. INSIGHT: o que a IA observou nos registros. Guardado para nao gastar
--    uma chamada a cada abertura da tela e para o resultado ser auditavel.
-- =====================================================================

create table if not exists public.insight (
  id uuid primary key default gen_random_uuid(),
  idoso_id uuid not null references public.idoso (id) on delete cascade,
  periodo_dias int not null,
  itens jsonb not null,
  base jsonb,
  gerado_por uuid references public.usuario (id),
  gerado_em timestamptz not null default now()
);

alter table public.insight enable row level security;
grant select, insert on public.insight to authenticated;

drop policy if exists insight_sel on public.insight;
drop policy if exists insight_ins on public.insight;
create policy insight_sel on public.insight for select using (public.is_member(idoso_id));
create policy insight_ins on public.insight for insert with check (public.is_member(idoso_id));
