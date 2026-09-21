-- Guardião — bucket de Storage para as fotos do diário do cuidador (card 12).
--
-- Convenção de caminho: "{idoso_id}/{arquivo}". A primeira pasta do objeto e o
-- idoso, e o acesso e mediado por is_member desse idoso (mesma regra do resto).
-- Bucket privado: as fotos so aparecem via URL assinada, nunca por link publico.

insert into storage.buckets (id, name, public)
values ('diario', 'diario', false)
on conflict (id) do nothing;

-- Leitura, escrita e atualizacao restritas a membros do idoso dono da pasta.
drop policy if exists "diario_sel" on storage.objects;
drop policy if exists "diario_ins" on storage.objects;
drop policy if exists "diario_upd" on storage.objects;

create policy "diario_sel" on storage.objects for select to authenticated
  using (
    bucket_id = 'diario'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );

create policy "diario_ins" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'diario'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );

create policy "diario_upd" on storage.objects for update to authenticated
  using (
    bucket_id = 'diario'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'diario'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );
