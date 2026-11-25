-- Quem cuida pode conferir os valores de um exame. Só é guardado se TODOS conferirem; vale
-- na hora e o administrador recebe o pop-up com o arquivo para aceitar ou negar. Negar tira
-- os valores e devolve o exame para a família ler.

-- Para guardar o laudo junto do exame.
drop policy if exists exames_ins on storage.objects;
create policy exames_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'exames' and public.is_member(((storage.foldername(name))[1])::uuid));

-- Depois de uma conferência negada, o mesmo arquivo pode ser conferido de novo.
drop index if exists public.leitura_documento_uq;
create unique index if not exists leitura_documento_uq on public.leitura_papel (documento_id) where status <> 'negada';

create or replace function public.confirmar_valores(p_pedido uuid, p_exame jsonb, p_resultados jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  p pedido_exame;
  v_uid uuid := auth.uid();
  v_arquivo text := nullif(p_exame ->> 'arquivo', '');
  v_data timestamptz := nullif(p_exame ->> 'data', '')::timestamptz;
  v_tipo text := nullif(btrim(p_exame ->> 'tipo'), '');
  v_exame uuid;
  v_leitura uuid;
  v_n int;
  v_quem text;
begin
  p := public.pedido_exame_da_rede(p_pedido);
  if p.status <> 'resultado_enviado' or p.resultado_documento_id is null then
    raise exception 'Não há resultado esperando conferência.';
  end if;
  if v_data is null then
    raise exception 'Falta o dia da coleta.';
  end if;
  if v_arquivo is null or v_arquivo not like p.idoso_id::text || '/%' then
    raise exception 'Caminho de arquivo inválido.';
  end if;
  v_n := coalesce(jsonb_array_length(p_resultados), 0);
  if v_n < 1 or v_n > 200 then
    raise exception 'O exame precisa ter de 1 a 200 resultados.';
  end if;

  v_exame := public.confirmar_exame(p.idoso_id, v_tipo, nullif(btrim(p_exame ->> 'laboratorio'), ''), v_data, v_arquivo, p_resultados);
  update pedido_exame set status = 'concluido' where id = p.id;

  if not public.is_admin(p.idoso_id) then
    insert into leitura_papel (idoso_id, documento_id, enviado_por, itens, status)
    values (p.idoso_id, p.resultado_documento_id, v_uid,
      jsonb_build_array(jsonb_build_object(
        'tipo', 'valores', 'resultado', 'entrou', 'nome', coalesce(v_tipo, array_to_string(p.exames, ', ')),
        'texto', v_n || case when v_n = 1 then ' valor' else ' valores' end,
        'exame_id', v_exame, 'pedido_exame_id', p.id)),
      'pendente')
    returning id into v_leitura;

    select coalesce(nullif(u.nome, ''), 'Alguém da rede') into v_quem from usuario u where u.id = v_uid;
    perform public.emitir_alerta(
      p_idoso := p.idoso_id,
      p_tipo := 'leitura_papel',
      p_severidade := 'atencao',
      p_natureza := 'operacional',
      p_titulo := 'Valores de exame para revisar',
      p_ref_tipo := 'documento',
      p_ref_id := p.resultado_documento_id,
      p_chave := 'leitura:' || v_leitura,
      p_texto_familiar := coalesce(v_quem, 'Alguém da rede') || ' conferiu os valores de um exame. Já estão valendo. Veja o arquivo e aceite ou negue.',
      p_familiar_so_admin := true,
      p_excluir := v_uid
    );
  end if;
  return v_exame;
end $$;
revoke all on function public.confirmar_valores(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.confirmar_valores(uuid, jsonb, jsonb) to authenticated;

-- Um familiar chamado para conferir também conclui o exame; cancelar continua só do admin.
create or replace function public.encerrar_exame(p_pedido uuid, p_cancelar boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  p pedido_exame;
  v_texto text;
begin
  p := public.pedido_exame_da_rede(p_pedido);
  if p_cancelar and not public.is_admin(p.idoso_id) then
    raise exception 'Só o administrador cancela um pedido.';
  end if;
  if not p_cancelar and not (public.is_admin(p.idoso_id) or public.papel_em(p.idoso_id) = 'familiar') then
    raise exception 'Só a família conclui um exame por aqui.';
  end if;
  if p.status in ('concluido', 'cancelado') then
    raise exception 'Este pedido já foi encerrado.';
  end if;
  update pedido_exame set status = case when p_cancelar then 'cancelado' else 'concluido' end where id = p.id;

  if p_cancelar then
    v_texto := 'O pedido de exame (' || array_to_string(p.exames, ', ') || ') foi cancelado pela família.';
    perform public.emitir_alerta(
      p_idoso := p.idoso_id,
      p_tipo := 'pedido_exame_cancelado',
      p_severidade := 'atencao',
      p_natureza := 'operacional',
      p_titulo := 'Pedido de exame cancelado',
      p_ref_tipo := 'pedido_exame',
      p_ref_id := p.id,
      p_chave := 'pedido_cancelado:' || p.id,
      p_texto_cuidador := v_texto,
      p_excluir := auth.uid()
    );
  end if;
end $$;

-- A decisão do administrador passa a saber desfazer valores conferidos.
create or replace function public.decidir_leitura(p_leitura uuid, p_aceitar boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  l leitura_papel;
  it jsonb;
  v_med uuid;
  v_pedido uuid;
  v_exame uuid;
  pe pedido_exame;
  v_texto text;
begin
  select * into l from leitura_papel where id = p_leitura for update;
  if l.id is null or not public.is_admin(l.idoso_id) then
    raise exception 'Só o administrador decide esta revisão.';
  end if;
  if l.status <> 'pendente' then
    raise exception 'Esta revisão já foi encerrada.';
  end if;

  -- O que o administrador já decidiu item a item (na tela de Medicação) fica como está.
  for it in select * from jsonb_array_elements(l.itens) loop
    v_med := nullif(it ->> 'medicacao_id', '')::uuid;
    v_pedido := nullif(it ->> 'pedido_id', '')::uuid;
    if it ->> 'tipo' = 'remedio' and it ->> 'resultado' = 'entrou' then
      if p_aceitar then
        update medicacao set confirmado = true
         where id = v_med and not confirmado and recusado_em is null and deleted_at is null;
      else
        update medicacao set ativo = false, recusado_em = now()
         where id = v_med and not confirmado and recusado_em is null and deleted_at is null;
      end if;
    elsif it ->> 'tipo' = 'remedio' and it ->> 'resultado' = 'mudou' and v_pedido is not null then
      if exists (select 1 from medicacao_pedido where id = v_pedido and status = 'pendente') then
        perform public.decidir_pedido_medicacao(v_pedido, p_aceitar);
      end if;
    elsif it ->> 'tipo' = 'valores' and not p_aceitar then
      v_exame := (it ->> 'exame_id')::uuid;
      update exame set deleted_at = now() where id = v_exame and idoso_id = l.idoso_id and deleted_at is null;
      update pedido_exame set status = 'resultado_enviado'
       where id = (it ->> 'pedido_exame_id')::uuid and idoso_id = l.idoso_id and status = 'concluido';
      -- Os avisos de "fora da faixa" desses valores deixam de valer.
      update alerta_destinatario d set lido_em = now()
        from alerta a
       where a.id = d.alerta_id and a.idoso_id = l.idoso_id and d.lido_em is null
         and a.chave in (select 'exame_fora:' || r.id from exame_resultado r where r.exame_id = v_exame);
      perform public.emitir_alerta(
        p_idoso := l.idoso_id,
        p_tipo := 'valores_negados',
        p_severidade := 'atencao',
        p_natureza := 'operacional',
        p_titulo := 'Valores de exame negados',
        p_ref_tipo := 'documento',
        p_ref_id := l.documento_id,
        p_chave := 'valores_negados:' || l.id,
        p_texto_cuidador := 'A família negou os valores conferidos de ' || (it ->> 'nome') || '. Eles saíram de Resultados e a família vai ler o arquivo.',
        p_excluir := auth.uid()
      );
    end if;
  end loop;

  if not p_aceitar then
    for pe in
      update pedido_exame set status = 'cancelado'
       where leitura_id = l.id and status not in ('concluido', 'cancelado')
      returning *
    loop
      v_texto := 'O pedido de exame (' || array_to_string(pe.exames, ', ') || ') foi negado pela família e saiu da lista.';
      perform public.emitir_alerta(
        p_idoso := l.idoso_id,
        p_tipo := 'pedido_exame_negado',
        p_severidade := 'atencao',
        p_natureza := 'operacional',
        p_titulo := 'Pedido de exame negado',
        p_ref_tipo := 'documento',
        p_ref_id := l.documento_id,
        p_chave := 'pedido_negado:' || pe.id,
        p_texto_cuidador := v_texto,
        p_excluir := auth.uid()
      );
    end loop;

    if l.receita_id is not null and not exists (
      select 1 from medicacao where receita_id = l.receita_id and recusado_em is null and deleted_at is null
    ) then
      update receita set deleted_at = now() where id = l.receita_id;
    end if;
  end if;

  update leitura_papel
     set status = case when p_aceitar then 'aceita' else 'negada' end,
         decidido_por = auth.uid(), decidido_em = now()
   where id = l.id;

  update alerta_destinatario d set lido_em = now()
    from alerta a
   where a.id = d.alerta_id and a.idoso_id = l.idoso_id and d.lido_em is null
     and a.chave = 'leitura:' || l.id;
end $$;

-- Teste (desfeito no fim; se falhar, a migração é recusada) -------------------------
do $$
declare
  adm uuid := gen_random_uuid();
  cui uuid := gen_random_uuid();
  ido uuid;
  laudo uuid;
  ped uuid;
  lei uuid;
  exa uuid;
  pf uuid;
  res text := '';
  r text;
  v text;
  n int;
  valores jsonb := jsonb_build_array(jsonb_build_object('nome', 'Glicose', 'valor', 130, 'unidade', 'mg/dL', 'ref_max', 99));
begin
  begin
    insert into auth.users (id, email) values
      (adm, 'teste-adm-' || adm || '@exemplo.invalid'), (cui, 'teste-cui-' || cui || '@exemplo.invalid');
    insert into public.idoso (nome) values ('Teste de valores') returning id into ido;
    insert into public.vinculo (usuario_id, idoso_id, papel, admin) values
      (adm, ido, 'familiar', true), (cui, ido, 'cuidador', false);

    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    insert into public.documento (idoso_id, nome, arquivo_url, autor_id, envio)
      values (ido, 'laudo', ido || '/laudo', cui, 'resultado_exame') returning id into laudo;
    ped := public.registrar_resultado_avulso(laudo);
    pf := public.criar_pedido_familia(ido, 'conferir_exame', null, adm, false, ped);

    -- A. sem o dia da coleta nao guarda
    begin
      perform public.confirmar_valores(ped, jsonb_build_object('arquivo', ido || '/x.pdf'), valores);
      res := res || 'sem_data=permitido;';
    exception when others then res := res || 'sem_data=bloqueado;';
    end;

    -- B. conferido: vale na hora, conclui, fecha o pedido de conferir
    set local role authenticated;
    exa := public.confirmar_valores(ped, jsonb_build_object('tipo', 'Glicose', 'data', '2026-11-20T12:00:00-03:00', 'arquivo', ido || '/x.pdf'), valores);
    select count(*) into n from public.exame_resultado where exame_id = exa;
    select status into v from public.pedido_exame where id = ped;
    res := res || 'valores=' || n || ';exame=' || v || ';';
    select status into v from public.pedido_familia where id = pf;
    res := res || 'pedido_conferir=' || v || ';';
    select id into lei from public.leitura_papel where idoso_id = ido and status = 'pendente';
    res := res || 'popup=' || (lei is not null) || ';';

    -- C. admin nega: valores saem, exame volta para ler, e pode ser conferido de novo
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    perform public.decidir_leitura(lei, false);
    select count(*) into n from public.exame where idoso_id = ido and deleted_at is null;
    select status into v from public.pedido_exame where id = ped;
    res := res || 'apos_negar=' || n || ' ' || v || ';';
    set local role postgres;
    select count(*) into n from public.alerta_destinatario d join public.alerta a on a.id = d.alerta_id
     where a.idoso_id = ido and a.tipo = 'exame_fora_da_faixa' and d.lido_em is null;
    res := res || 'avisos_fora_abertos=' || n || ';';
    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    perform public.confirmar_valores(ped, jsonb_build_object('data', '2026-11-20T12:00:00-03:00', 'arquivo', ido || '/y.pdf'), valores);
    select status into v from public.pedido_exame where id = ped;
    res := res || 'conferir_de_novo=' || v || ';';

    raise exception 'RESULTADO_TESTE|%|%', res,
      'sem_data=bloqueado;valores=1;exame=concluido;pedido_conferir=feito;popup=true;'
      'apos_negar=0 resultado_enviado;avisos_fora_abertos=0;conferir_de_novo=concluido;';
  exception when others then
    if sqlerrm like 'RESULTADO_TESTE|%' then r := sqlerrm; else raise; end if;
  end;
  if split_part(r, '|', 2) is distinct from split_part(r, '|', 3) then
    raise exception E'Teste dos valores FALHOU.\nObtido:   %\nEsperado: %', split_part(r, '|', 2), split_part(r, '|', 3);
  end if;
end $$;
