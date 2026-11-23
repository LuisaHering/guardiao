-- Como se referir a pessoa cuidada (ele ou ela). Sem isso a IA e os textos do sistema
-- teriam de adivinhar o genero; adivinhar errado e desrespeitoso.
alter table public.idoso
  add column if not exists tratamento text check (tratamento in ('ele', 'ela'));
