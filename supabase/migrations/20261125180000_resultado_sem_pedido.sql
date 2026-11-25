-- Um resultado pode chegar sem que o pedido tenha sido anotado no aplicativo. Ele entra
-- direto no acompanhamento como "resultado enviado", para a família ler os valores.

create or replace function public.registrar_resultado_avulso(p_documento uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  doc documento;
  v_id uuid;
  v_quem text;
begin
  select * into doc from documento where id = p_documento and deleted_at is null for update;
  if doc.id is null or v_uid is null or not public.is_member(doc.idoso_id)
     or doc.autor_id is distinct from v_uid or doc.envio is distinct from 'resultado_exame' then
    raise exception 'Resultado não encontrado.';
  end if;
  if exists (select 1 from pedido_exame where resultado_documento_id = doc.id) then
    raise exception 'Este resultado já está em um exame.';
  end if;

  insert into pedido_exame (idoso_id, exames, status, resultado_documento_id, criado_por)
  values (doc.idoso_id, array['Resultado de ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM')],
          'resultado_enviado', doc.id, v_uid)
  returning id into v_id;

  update alerta_destinatario d set lido_em = now()
    from alerta a
   where a.id = d.alerta_id and a.idoso_id = doc.idoso_id and d.lido_em is null
     and a.chave = 'documento_enviado:' || doc.id;

  if not public.is_admin(doc.idoso_id) then
    select coalesce(nullif(u.nome, ''), 'Alguém da rede') into v_quem from usuario u where u.id = v_uid;
    perform public.emitir_alerta(
      p_idoso := doc.idoso_id,
      p_tipo := 'exame_resultado_enviado',
      p_severidade := 'atencao',
      p_natureza := 'operacional',
      p_titulo := 'Resultado de exame enviado',
      p_ref_tipo := 'pedido_exame',
      p_ref_id := v_id,
      p_chave := 'exame_resultado:' || v_id || ':' || doc.id,
      p_texto_familiar := coalesce(v_quem, 'Alguém da rede') || ' enviou um resultado de exame. Leia em Pedidos e resultados.',
      p_familiar_so_admin := true,
      p_excluir := v_uid
    );
  end if;
  return v_id;
end $$;

revoke all on function public.registrar_resultado_avulso(uuid) from public, anon;
grant execute on function public.registrar_resultado_avulso(uuid) to authenticated;

do $$
declare
  adm uuid := gen_random_uuid();
  cui uuid := gen_random_uuid();
  ido uuid;
  doc uuid;
  doc_adm uuid;
  res text := '';
  r text;
  v text;
  n int;
begin
  begin
    insert into auth.users (id, email) values
      (adm, 'teste-adm-' || adm || '@exemplo.invalid'), (cui, 'teste-cui-' || cui || '@exemplo.invalid');
    insert into public.idoso (nome) values ('Teste de resultado') returning id into ido;
    insert into public.vinculo (usuario_id, idoso_id, papel, admin) values
      (adm, ido, 'familiar', true), (cui, ido, 'cuidador', false);

    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    insert into public.documento (idoso_id, nome, arquivo_url, autor_id, envio)
      values (ido, 'do admin', ido || '/a', adm, 'resultado_exame') returning id into doc_adm;

    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    begin
      perform public.registrar_resultado_avulso(doc_adm);
      res := res || 'de_outro=permitido;';
    exception when others then res := res || 'de_outro=bloqueado;';
    end;
    set local role authenticated;
    insert into public.documento (idoso_id, nome, arquivo_url, autor_id, envio)
      values (ido, 'laudo', ido || '/l', cui, 'resultado_exame') returning id into doc;
    perform public.registrar_resultado_avulso(doc);
    select status into v from public.pedido_exame where resultado_documento_id = doc;
    select count(*) into n from public.documento where id = doc;
    res := res || 'entrou=' || v || ';cuidadora_abre=' || n || ';';
    begin
      perform public.registrar_resultado_avulso(doc);
      res := res || 'duas_vezes=permitido;';
    exception when others then res := res || 'duas_vezes=bloqueado;';
    end;
    set local role postgres;
    select string_agg(a.tipo, ',') into v from public.alerta a join public.alerta_destinatario d on d.alerta_id = a.id
     where a.idoso_id = ido and d.usuario_id = adm and d.lido_em is null
       and a.tipo in ('exame_resultado_enviado', 'documento_enviado');
    res := res || 'aviso=' || coalesce(v, 'nenhum') || ';';

    raise exception 'RESULTADO_TESTE|%|%', res,
      'de_outro=bloqueado;entrou=resultado_enviado;cuidadora_abre=1;duas_vezes=bloqueado;aviso=exame_resultado_enviado;';
  exception when others then
    if sqlerrm like 'RESULTADO_TESTE|%' then r := sqlerrm; else raise; end if;
  end;
  if split_part(r, '|', 2) is distinct from split_part(r, '|', 3) then
    raise exception E'Teste do resultado sem pedido FALHOU.\nObtido:   %\nEsperado: %', split_part(r, '|', 2), split_part(r, '|', 3);
  end if;
end $$;
