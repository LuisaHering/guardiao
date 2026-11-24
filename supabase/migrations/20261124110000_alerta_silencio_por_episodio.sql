-- Alerta de silêncio por período de silêncio, e não por dia.
--
-- Antes: a chave mudava todo dia, então cada dia sem registro criava um alerta novo
-- ("faz 62 dias", "faz 63 dias"...), e nada os fechava quando alguém voltava a registrar.
-- Agora: um alerta por período de silêncio (a chave é a data do último registro), com
-- texto que não envelhece ("desde 22/09"). Quando surge um registro novo, os alertas de
-- silêncio antigos são marcados como lidos para todos.

create or replace function public.gerar_alertas_silencio(p_idoso uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ultimo timestamptz;
  v_dias int;
  v_ep text;
  v_desde text;
begin
  if not public.is_member(p_idoso) then
    return;
  end if;

  if not exists (
    select 1 from medicacao where idoso_id = p_idoso and ativo and deleted_at is null
  ) then
    return;
  end if;

  select max(rm.registrado_em) into v_ultimo
  from registro_medicacao rm
  join medicacao m on m.id = rm.medicacao_id
  where m.idoso_id = p_idoso and m.ativo and m.deleted_at is null and rm.deleted_at is null;

  -- Sem nenhum registro anterior não é silêncio (cadastro novo não dispara alarme).
  if v_ultimo is null then
    return;
  end if;

  v_dias := floor(extract(epoch from (now() - v_ultimo)) / 86400);
  v_ep := to_char(v_ultimo at time zone 'America/Sao_Paulo', 'YYYY-MM-DD');
  v_desde := to_char(v_ultimo at time zone 'America/Sao_Paulo', 'DD/MM');

  -- Fecha os alertas de silêncio que já não valem: voltou a haver registro (menos de
  -- 3 dias) ou o período de silêncio é outro (houve registro depois daquele alerta).
  update alerta_destinatario d
     set lido_em = now()
    from alerta a
   where a.id = d.alerta_id
     and a.idoso_id = p_idoso
     and a.tipo in ('silencio_registro', 'silencio_escalado')
     and d.lido_em is null
     and (v_dias < 3 or a.chave not in ('silencio:' || v_ep, 'silencio_escalado:' || v_ep));

  if v_dias >= 3 then
    perform public.emitir_alerta(
      p_idoso := p_idoso,
      p_tipo := 'silencio_registro',
      p_severidade := 'info',
      p_natureza := 'operacional',
      p_titulo := 'Sem registro de medicação desde ' || v_desde,
      p_ref_tipo := 'silencio',
      p_ref_id := null,
      p_chave := 'silencio:' || v_ep,
      p_texto_cuidador := 'Ninguém registra a medicação desde ' || v_desde || '. Quando puder, marque o que foi dado.'
    );
  end if;

  if v_dias >= 5 then
    perform public.emitir_alerta(
      p_idoso := p_idoso,
      p_tipo := 'silencio_escalado',
      p_severidade := 'atencao',
      p_natureza := 'operacional',
      p_titulo := 'Sem registro de medicação desde ' || v_desde,
      p_ref_tipo := 'silencio',
      p_ref_id := null,
      p_chave := 'silencio_escalado:' || v_ep,
      p_texto_familiar := 'Não há registro de medicação desde ' || v_desde || ', e o aviso já tinha ido para quem cuida. Isto é sobre o registro, não necessariamente sobre a saúde: pode valer um contato para saber se está tudo bem.',
      p_familiar_so_admin := true
    );
  end if;
end $$;

revoke all on function public.gerar_alertas_silencio(uuid) from public, anon;
grant execute on function public.gerar_alertas_silencio(uuid) to authenticated;

-- Teste: um alerta por período, sem repetir, e fecha quando volta a haver registro -----

do $$
declare
  fam uuid := gen_random_uuid();
  cui uuid := gen_random_uuid();
  ido uuid;
  med uuid;
  res text := '';
  r text;
  n int;
  n_abertos int;
begin
  begin
    insert into auth.users (id, email) values
      (fam, 'teste-fam-' || fam || '@exemplo.invalid'),
      (cui, 'teste-cui-' || cui || '@exemplo.invalid');
    insert into public.idoso (nome) values ('Teste de silencio') returning id into ido;
    insert into public.vinculo (usuario_id, idoso_id, papel, admin) values
      (fam, ido, 'familiar', true),
      (cui, ido, 'cuidador', false);
    insert into public.medicacao (idoso_id, nome, autor_id) values (ido, 'Teste', fam) returning id into med;
    set local role postgres;
    insert into public.registro_medicacao (medicacao_id, data, status, registrado_em)
      values (med, (now() - interval '6 days')::date, 'dada', now() - interval '6 days');
    reset role;

    perform set_config('request.jwt.claims', json_build_object('sub', fam, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', fam::text, true);

    set local role authenticated;
    perform public.gerar_alertas_silencio(ido);
    perform public.gerar_alertas_silencio(ido);
    perform public.gerar_alertas_silencio(ido);
    reset role;
    set local role postgres;
    select count(*) into n from public.alerta
      where idoso_id = ido and tipo in ('silencio_registro', 'silencio_escalado');
    reset role;
    res := res || 'varias_chamadas_geram=' || n || ';';

    -- um registro novo fecha os alertas de silencio
    set local role postgres;
    insert into public.registro_medicacao (medicacao_id, data, status, registrado_em)
      values (med, now()::date, 'dada', now());
    reset role;
    set local role authenticated;
    perform public.gerar_alertas_silencio(ido);
    reset role;
    set local role postgres;
    select count(*) into n_abertos from public.alerta_destinatario d
      join public.alerta a on a.id = d.alerta_id
      where a.idoso_id = ido and a.tipo in ('silencio_registro', 'silencio_escalado') and d.lido_em is null;
    reset role;
    res := res || 'abertos_apos_registro=' || n_abertos || ';';

    set local role authenticated;
    perform public.gerar_alertas_silencio(ido);
    reset role;
    set local role postgres;
    select count(*) into n from public.alerta
      where idoso_id = ido and tipo in ('silencio_registro', 'silencio_escalado');
    reset role;
    res := res || 'nao_recria_apos_registro=' || n || ';';

    raise exception 'RESULTADO_TESTE|%|%', res,
      'varias_chamadas_geram=2;abertos_apos_registro=0;nao_recria_apos_registro=2;';
  exception when others then
    if sqlerrm like 'RESULTADO_TESTE|%' then r := sqlerrm; else raise; end if;
  end;

  if split_part(r, '|', 2) is distinct from split_part(r, '|', 3) then
    raise exception E'Teste do alerta de silêncio FALHOU.\nObtido:   %\nEsperado: %',
      split_part(r, '|', 2), split_part(r, '|', 3);
  end if;
end $$;
