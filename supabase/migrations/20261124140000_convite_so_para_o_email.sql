-- Convite vale só para o e-mail convidado.
-- Antes, quem tivesse o link entrava na rede com qualquer conta: um link repassado dava
-- acesso aos dados de saúde. Agora o e-mail da conta precisa ser o do convite.

create or replace function public.aceitar_convite(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_conv convite;
  v_uid uuid;
  v_email text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'sem sessao';
  end if;

  select * into v_conv from convite where token = p_token;
  if v_conv.id is null then
    raise exception 'Este convite não é válido.';
  end if;
  if v_conv.aceito_em is not null then
    raise exception 'Este convite já foi aceito.';
  end if;
  if v_conv.expira_em is not null and v_conv.expira_em < now() then
    raise exception 'Este convite expirou. Peça um novo.';
  end if;

  select email into v_email from auth.users where id = v_uid;
  if lower(btrim(coalesce(v_email, ''))) <> lower(btrim(v_conv.email)) then
    raise exception 'Este convite foi feito para outro e-mail. Entre com a conta do e-mail convidado.';
  end if;

  insert into vinculo (usuario_id, idoso_id, papel, admin, pode_contribuir, convite_id)
    values (v_uid, v_conv.idoso_id, v_conv.papel, v_conv.admin, true, v_conv.id)
    on conflict (usuario_id, idoso_id)
      do update set deleted_at = null, papel = excluded.papel;

  update convite set aceito_em = now() where id = v_conv.id;

  return v_conv.idoso_id;
end $$;

grant execute on function public.aceitar_convite(text) to authenticated;

-- Teste (desfeito no fim): outra conta é recusada, a conta convidada entra.
do $$
declare
  certo uuid := gen_random_uuid();
  errado uuid := gen_random_uuid();
  ido uuid;
  tok text := gen_random_uuid()::text;
  res text := '';
  r text;
begin
  begin
    insert into auth.users (id, email) values
      (certo, 'Convidada-' || certo || '@exemplo.invalid'),
      (errado, 'outra-' || errado || '@exemplo.invalid');
    insert into public.idoso (nome) values ('Teste de convite') returning id into ido;
    set local role postgres;
    insert into public.convite (idoso_id, email, papel, token)
      values (ido, 'convidada-' || certo || '@exemplo.invalid', 'cuidador', tok);
    reset role;

    begin
      perform set_config('request.jwt.claims', json_build_object('sub', errado, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', errado::text, true);
      set local role authenticated;
      perform public.aceitar_convite(tok);
      reset role;
      res := res || 'outra_conta=entrou;';
    exception when others then
      reset role;
      res := res || 'outra_conta=recusada;';
    end;

    begin
      perform set_config('request.jwt.claims', json_build_object('sub', certo, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', certo::text, true);
      set local role authenticated;
      perform public.aceitar_convite(tok);
      reset role;
      res := res || 'conta_convidada=entrou;';
    exception when others then
      reset role;
      res := res || 'conta_convidada=recusada(' || sqlerrm || ');';
    end;

    raise exception 'RESULTADO_TESTE|%|%', res, 'outra_conta=recusada;conta_convidada=entrou;';
  exception when others then
    if sqlerrm like 'RESULTADO_TESTE|%' then r := sqlerrm; else raise; end if;
  end;

  if split_part(r, '|', 2) is distinct from split_part(r, '|', 3) then
    raise exception E'Teste do convite FALHOU.
Obtido:   %
Esperado: %',
      split_part(r, '|', 2), split_part(r, '|', 3);
  end if;
end $$;
