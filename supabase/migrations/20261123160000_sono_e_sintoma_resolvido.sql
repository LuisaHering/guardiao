-- 1. Sono tem campo proprio no diario (antes ia misturado em "ocorrencias").
alter table public.entrada_diario
  add column if not exists sono text;

-- 2. Sintoma pode ser dado como resolvido, sem apagar o historico.
--    Guarda quando, por quem e, se veio de uma conversa, de qual fala.
alter table public.sintoma
  add column if not exists resolvido_em timestamptz,
  add column if not exists resolvido_por uuid references public.usuario (id),
  add column if not exists resolvido_mensagem_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sintoma_resolvido_mensagem_fk') then
    alter table public.sintoma
      add constraint sintoma_resolvido_mensagem_fk
      foreign key (resolvido_mensagem_id) references public.mensagem (id) on delete set null;
  end if;
end $$;
