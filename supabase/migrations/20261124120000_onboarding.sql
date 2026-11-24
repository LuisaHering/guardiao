-- Onboarding por papel: guarda se a pessoa já viu as boas-vindas e se dispensou o cartão
-- de primeiros passos. Cada pessoa só altera o próprio registro (política usuario_upd).
alter table public.usuario
  add column if not exists onboarding_visto_em timestamptz,
  add column if not exists onboarding_dispensado_em timestamptz;
