-- Dose registrada a partir de uma conversa guarda a fala de origem, como os demais registros.
alter table public.registro_medicacao
  add column if not exists origem_mensagem_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'registro_medicacao_origem_mensagem_fk') then
    alter table public.registro_medicacao
      add constraint registro_medicacao_origem_mensagem_fk
      foreign key (origem_mensagem_id) references public.mensagem (id) on delete set null;
  end if;
end $$;
