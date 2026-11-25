-- Foto do dia: a legenda tem campo proprio, para nao ir parar em "ocorrencias".
-- Quem ve e quem escreve continuam sendo as regras do diario e do bucket "diario".
alter table public.entrada_diario
  add column if not exists legenda text
  check (legenda is null or char_length(legenda) <= 200);
