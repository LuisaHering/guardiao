-- Cria idoso + vínculo do criador (familiar admin) de forma atômica.
-- Resolve o ovo-e-galinha: sem vínculo, o RLS de leitura do idoso bloquearia
-- o RETURNING logo após o insert. SECURITY DEFINER cria os dois de uma vez.
create or replace function public.criar_idoso(
  p_nome text,
  p_como_chamar text default null,
  p_data_nascimento date default null,
  p_tipo_sanguineo text default null,
  p_observacoes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'sem sessao';
  end if;

  insert into idoso (nome, como_chamar, data_nascimento, tipo_sanguineo, observacoes)
    values (p_nome, p_como_chamar, p_data_nascimento, p_tipo_sanguineo, p_observacoes)
    returning id into v_id;

  insert into vinculo (usuario_id, idoso_id, papel, admin, pode_contribuir)
    values (v_uid, v_id, 'familiar', true, true);

  return v_id;
end $$;

grant execute on function public.criar_idoso(text, text, date, text, text) to authenticated;
