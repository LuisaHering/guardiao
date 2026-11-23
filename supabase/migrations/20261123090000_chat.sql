-- Chat de cuidado (cards GRD-37, GRD-38 e GRD-39)
--
-- Regras:
--  * toda mensagem do usuário guarda quem a escreveu (autor_id), porque "quem afirmou"
--    é o que dá valor ao registro extraído dela;
--  * mensagem não se edita depois de enviada (o rastro da origem não pode mudar);
--  * todo registro nascido de uma conversa aponta, por chave estrangeira, para a
--    mensagem de onde saiu. Se a mensagem sumir, o registro fica e perde só o apontador.

-- 1. Autoria da mensagem ---------------------------------------------------

alter table public.mensagem
  add column if not exists autor_id uuid references public.usuario (id);

-- Uma conversa registra qual dia de cuidado ela cobre e quem a abriu.
create index if not exists mensagem_conversa_idx
  on public.mensagem (conversa_id, created_at);

create index if not exists conversa_idoso_idx
  on public.conversa (idoso_id, created_at desc);

-- 2. Mensagem não se edita; mensagem do usuário só pode ser escrita por ele --------

revoke update on public.mensagem from authenticated;

drop policy if exists msg_all on public.mensagem;

create policy msg_sel on public.mensagem for select
  using (public.is_member((select c.idoso_id from public.conversa c where c.id = conversa_id)));

create policy msg_ins on public.mensagem for insert
  with check (
    public.is_member((select c.idoso_id from public.conversa c where c.id = conversa_id))
    and (
      (papel_emissor = 'user' and autor_id = auth.uid())
      or (papel_emissor = 'assistant' and autor_id is null)
    )
  );

-- 3. Origem rastreável nos registros ---------------------------------------

alter table public.entrada_diario
  add column if not exists origem_mensagem_id uuid;

do $$
declare
  t text;
begin
  foreach t in array array['sintoma','humor','entrada_diario','preferencia','memoria','item_pauta'] loop
    if not exists (
      select 1 from pg_constraint
      where conname = t || '_origem_mensagem_fk'
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (origem_mensagem_id) references public.mensagem (id) on delete set null',
        t, t || '_origem_mensagem_fk'
      );
    end if;
  end loop;
end $$;
