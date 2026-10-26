-- Guardião — diretivas antecipadas (cards 23 e 24).
-- Idempotente: pode rodar mais de uma vez.
--
-- Regras de negócio que o BANCO garante (não só a tela):
--   1. Diretiva é imutável depois de gerada. Mudança vira uma linha nova.
--   2. Só se gera diretiva pela função gerar_diretiva(), nunca por INSERT direto.
--   3. Gerar exige que quem digita declare que o titular estava presente.
--   4. O modo de preenchimento é decidido pelo vínculo de quem gera, não pelo cliente.

-- =====================================================================
-- 1. STORAGE: PDFs das diretivas (privado, mesma regra dos outros buckets)
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('diretivas', 'diretivas', false)
on conflict (id) do nothing;

drop policy if exists diretivas_sel on storage.objects;
drop policy if exists diretivas_ins on storage.objects;

create policy diretivas_sel on storage.objects for select to authenticated
  using (bucket_id = 'diretivas' and public.is_member(((storage.foldername(name))[1])::uuid));

-- Sem política de UPDATE e sem DELETE: um PDF gerado não é sobrescrito nem apagado.
create policy diretivas_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'diretivas' and public.is_member(((storage.foldername(name))[1])::uuid));

-- =====================================================================
-- 2. TABELA: sem INSERT e sem UPDATE diretos para usuários logados
-- =====================================================================

revoke insert, update on public.diretiva from authenticated;
drop policy if exists diretiva_ins on public.diretiva;
drop policy if exists diretiva_upd on public.diretiva;

-- Defesa em profundidade: mesmo com o privilégio de volta por engano, a única
-- mudança aceita numa linha existente é vigente passar de true para false.
create or replace function public.diretiva_imutavel()
returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - 'vigente') is distinct from (to_jsonb(old) - 'vigente')
     or not (old.vigente = true and new.vigente = false) then
    raise exception 'Diretiva gerada não pode ser alterada. Gere uma nova.';
  end if;
  return new;
end $$;

drop trigger if exists trg_diretiva_imutavel on public.diretiva;
create trigger trg_diretiva_imutavel
  before update on public.diretiva
  for each row execute function public.diretiva_imutavel();

-- =====================================================================
-- 3. FUNÇÃO: única porta de entrada para criar uma diretiva
--    SECURITY DEFINER porque quem chama não tem INSERT/UPDATE na tabela;
--    por isso TODAS as checagens de permissão estão aqui dentro.
-- =====================================================================

create or replace function public.gerar_diretiva(
  p_id uuid,
  p_idoso uuid,
  p_respostas jsonb,
  p_versao text,
  p_titular_presente boolean,
  p_gerada_em timestamptz,
  p_pdf_url text,
  p_substitui uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_papel text;
  v_admin boolean;
  v_atual uuid;
  v_modo text;
begin
  if auth.uid() is null then
    raise exception 'Sessão necessária';
  end if;

  select papel, admin into v_papel, v_admin
  from vinculo
  where idoso_id = p_idoso and usuario_id = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'Sem acesso a este idoso.';
  end if;

  -- Cuidador contribui com registros do dia a dia, mas não redige a vontade do titular.
  if not (v_admin or v_papel = 'idoso') then
    raise exception 'Somente o titular ou um administrador pode gerar diretivas.';
  end if;

  if p_titular_presente is not true then
    raise exception 'É preciso declarar que o titular estava presente durante o preenchimento.';
  end if;

  -- Dado de saude exige consentimento ativo antes de qualquer registro.
  if not exists (
    select 1 from consentimento
    where idoso_id = p_idoso and revogado_em is null
  ) then
    raise exception 'O titular precisa registrar o consentimento (em Perfil do idoso) antes de gerar diretivas.';
  end if;

  if jsonb_typeof(p_respostas -> 'itens') is distinct from 'array'
     or jsonb_array_length(p_respostas -> 'itens') = 0 then
    raise exception 'A diretiva está sem respostas.';
  end if;

  -- O modo vem do vinculo, nao do cliente: o proprio idoso preenche como titular;
  -- qualquer outra pessoa preenche como assistida, e fica registrada.
  v_modo := case when v_papel = 'idoso' then 'titular' else 'assistido' end;

  -- A diretiva que este PDF diz substituir tem que ser a vigente agora.
  select id into v_atual
  from diretiva
  where idoso_id = p_idoso and vigente
  order by gerada_em desc
  limit 1;
  if v_atual is distinct from p_substitui then
    raise exception 'Outra diretiva foi gerada nesse intervalo. Recarregue a página e tente de novo.';
  end if;

  update diretiva set vigente = false where idoso_id = p_idoso and vigente;

  insert into diretiva (
    id, idoso_id, respostas, versao_questionario, modo_preenchimento,
    assistido_por, titular_presente, pdf_url, vigente, substitui_id, gerada_em
  ) values (
    p_id, p_idoso, p_respostas, p_versao, v_modo,
    case when v_modo = 'assistido' then auth.uid() end,
    true, p_pdf_url, true, v_atual, p_gerada_em
  );

  return p_id;
end $$;

revoke all on function public.gerar_diretiva(uuid, uuid, jsonb, text, boolean, timestamptz, text, uuid) from public, anon;
grant execute on function public.gerar_diretiva(uuid, uuid, jsonb, text, boolean, timestamptz, text, uuid) to authenticated;
