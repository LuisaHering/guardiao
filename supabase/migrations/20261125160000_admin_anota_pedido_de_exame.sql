-- Quando a leitura de um pedido não é confirmada ("não está igual"), a foto vai para a
-- família. Sem uma forma de anotar o pedido à mão, ele ficaria fora do acompanhamento.

create or replace function public.anotar_pedido_exame(p_idoso uuid, p_exames text[], p_preparo text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_exames text[];
  v_id uuid;
begin
  if auth.uid() is null or not public.is_admin(p_idoso) then
    raise exception 'Só o administrador anota um pedido à mão.';
  end if;
  select array_agg(left(btrim(x), 160)) into v_exames from unnest(coalesce(p_exames, '{}')) x where btrim(x) <> '';
  if v_exames is null then
    raise exception 'Diga ao menos um exame.';
  end if;
  insert into pedido_exame (idoso_id, exames, preparo, criado_por)
  values (p_idoso, v_exames, nullif(btrim(p_preparo), ''), auth.uid())
  returning id into v_id;

  perform public.emitir_alerta(
    p_idoso := p_idoso,
    p_tipo := 'pedido_exame_novo',
    p_severidade := 'atencao',
    p_natureza := 'operacional',
    p_titulo := 'Exame novo para marcar',
    p_ref_tipo := 'pedido_exame',
    p_ref_id := v_id,
    p_chave := 'pedido_novo:' || v_id,
    p_texto_cuidador := 'A família anotou um exame que falta marcar: ' || array_to_string(v_exames, ', ') || '.',
    p_excluir := auth.uid()
  );
  return v_id;
end $$;
revoke all on function public.anotar_pedido_exame(uuid, text[], text) from public, anon;
grant execute on function public.anotar_pedido_exame(uuid, text[], text) to authenticated;

do $$
declare
  adm uuid := gen_random_uuid();
  cui uuid := gen_random_uuid();
  ido uuid;
  res text := '';
  r text;
  v text;
  n int;
begin
  begin
    insert into auth.users (id, email) values
      (adm, 'teste-adm-' || adm || '@exemplo.invalid'), (cui, 'teste-cui-' || cui || '@exemplo.invalid');
    insert into public.idoso (nome) values ('Teste de anotar') returning id into ido;
    insert into public.vinculo (usuario_id, idoso_id, papel, admin) values
      (adm, ido, 'familiar', true), (cui, ido, 'cuidador', false);

    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    begin
      perform public.anotar_pedido_exame(ido, array['X']);
      res := res || 'cuidadora=permitido;';
    exception when others then res := res || 'cuidadora=bloqueado;';
    end;
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    perform public.anotar_pedido_exame(ido, array[' TSH ', '']);
    select array_to_string(exames, ',') || ' ' || status into v from public.pedido_exame where idoso_id = ido;
    res := res || 'pedido=' || v || ';';
    set local role postgres;
    select count(*) into n from public.alerta_destinatario d join public.alerta a on a.id = d.alerta_id
     where a.idoso_id = ido and a.tipo = 'pedido_exame_novo' and d.usuario_id = cui;
    res := res || 'avisou=' || n || ';';

    raise exception 'RESULTADO_TESTE|%|%', res, 'cuidadora=bloqueado;pedido=TSH falta_marcar;avisou=1;';
  exception when others then
    if sqlerrm like 'RESULTADO_TESTE|%' then r := sqlerrm; else raise; end if;
  end;
  if split_part(r, '|', 2) is distinct from split_part(r, '|', 3) then
    raise exception E'Teste de anotar pedido FALHOU.\nObtido:   %\nEsperado: %', split_part(r, '|', 2), split_part(r, '|', 3);
  end if;
end $$;
