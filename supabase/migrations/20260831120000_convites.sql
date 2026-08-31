-- Convites: o convidado ainda não tem vínculo, então não pode ler o convite
-- (convite_sel é só admin). Estas funções SECURITY DEFINER deixam o convidado
-- ver o convite pelo token e aceitá-lo, criando o próprio vínculo.

-- Mostra os dados do convite para a tela de aceite.
create or replace function public.convite_info(p_token text)
returns jsonb language sql security definer stable set search_path = public as $$
  select case when c.id is null then null else jsonb_build_object(
    'idoso_nome', i.nome,
    'papel', c.papel,
    'aceito', c.aceito_em is not null,
    'expirado', (c.expira_em is not null and c.expira_em < now())
  ) end
  from convite c
  join idoso i on i.id = c.idoso_id
  where c.token = p_token;
$$;

grant execute on function public.convite_info(text) to authenticated;

-- Aceita o convite: cria (ou reativa) o vínculo do usuário logado e marca o
-- convite como aceito. Retorna o idoso_id.
create or replace function public.aceitar_convite(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_conv convite;
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'sem sessao';
  end if;

  select * into v_conv from convite where token = p_token;
  if v_conv.id is null then
    raise exception 'convite invalido';
  end if;
  if v_conv.aceito_em is not null then
    raise exception 'convite ja aceito';
  end if;
  if v_conv.expira_em is not null and v_conv.expira_em < now() then
    raise exception 'convite expirado';
  end if;

  insert into vinculo (usuario_id, idoso_id, papel, admin, pode_contribuir, convite_id)
    values (v_uid, v_conv.idoso_id, v_conv.papel, v_conv.admin, true, v_conv.id)
    on conflict (usuario_id, idoso_id)
      do update set deleted_at = null, papel = excluded.papel;

  update convite set aceito_em = now() where id = v_conv.id;

  return v_conv.idoso_id;
end $$;

grant execute on function public.aceitar_convite(text) to authenticated;
