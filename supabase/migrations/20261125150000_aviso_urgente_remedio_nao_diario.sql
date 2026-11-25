-- Remédio que não é de todo dia (semanal ou de tantos em tantos dias), lido de uma foto,
-- entra como os outros, mas o administrador recebe um aviso URGENTE: se for engano, o
-- risco é maior.

create or replace function public.trg_alerta_remedio_nao_diario()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  it jsonb;
  m medicacao;
  v_quem text;
begin
  -- Revisada: os avisos urgentes desta foto deixam de pedir atenção.
  if new.status <> 'pendente' and old.status = 'pendente' then
    update alerta_destinatario d set lido_em = now()
      from alerta a
     where a.id = d.alerta_id and a.idoso_id = new.idoso_id and d.lido_em is null
       and a.chave like 'nao_diario:' || new.id || ':%';
    return new;
  end if;
  if new.status <> 'pendente' or old.itens = new.itens then
    return new;
  end if;

  select coalesce(nullif(u.nome, ''), 'Alguém da rede') into v_quem from usuario u where u.id = new.enviado_por;
  for it in select * from jsonb_array_elements(new.itens) loop
    continue when it ->> 'tipo' <> 'remedio' or it ->> 'resultado' <> 'entrou';
    select * into m from medicacao where id = (it ->> 'medicacao_id')::uuid;
    continue when m.id is null or m.frequencia not in ('semana', 'intervalo');
    perform public.emitir_alerta(
      p_idoso := new.idoso_id,
      p_tipo := 'remedio_nao_diario',
      p_severidade := 'urgente',
      p_natureza := 'operacional',
      p_titulo := 'Confira já: ' || m.nome || ' não é de todo dia',
      p_ref_tipo := 'medicacao',
      p_ref_id := m.id,
      p_chave := 'nao_diario:' || new.id || ':' || m.id,
      p_texto_familiar := coalesce(v_quem, 'Alguém da rede') || ' confirmou pela foto um remédio '
        || case m.frequencia
             when 'semana' then 'de ' || (select string_agg((array['domingo','segunda','terça','quarta','quinta','sexta','sábado'])[x + 1], ', ' order by x) from unnest(m.dias_semana) x)
             else 'a cada ' || m.intervalo_dias || ' dias'
           end
        || ': ' || m.nome || coalesce(' ' || m.dosagem, '') || '. Já está valendo. Compare com a foto.',
      p_familiar_so_admin := true,
      p_excluir := new.enviado_por
    );
  end loop;
  return new;
end $$;

drop trigger if exists trg_alerta_remedio_nao_diario on public.leitura_papel;
create trigger trg_alerta_remedio_nao_diario
  after update on public.leitura_papel
  for each row execute function public.trg_alerta_remedio_nao_diario();

-- Teste (desfeito no fim; se falhar, a migração é recusada) -------------------------
do $$
declare
  adm uuid := gen_random_uuid();
  cui uuid := gen_random_uuid();
  ido uuid;
  doc uuid;
  lei uuid;
  res text := '';
  r text;
  v text;
  n int;
begin
  begin
    insert into auth.users (id, email) values
      (adm, 'teste-adm-' || adm || '@exemplo.invalid'), (cui, 'teste-cui-' || cui || '@exemplo.invalid');
    insert into public.idoso (nome) values ('Teste semanal') returning id into ido;
    insert into public.vinculo (usuario_id, idoso_id, papel, admin) values
      (adm, ido, 'familiar', true), (cui, ido, 'cuidador', false);

    perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cui::text, true);
    set local role authenticated;
    insert into public.documento (idoso_id, nome, arquivo_url, autor_id, envio)
      values (ido, 'receita', ido || '/r', cui, 'receita') returning id into doc;
    lei := public.confirmar_leitura(doc, jsonb_build_object('remedios', jsonb_build_array(
      jsonb_build_object('resposta', 'igual', 'acao', 'novo', 'nome', 'Semanal', 'novo',
        jsonb_build_object('nome', 'Semanal', 'dosagem', '70 mg', 'frequencia', 'semana', 'dias_semana', jsonb_build_array(1, 4))),
      jsonb_build_object('resposta', 'igual', 'acao', 'novo', 'nome', 'Diario', 'novo',
        jsonb_build_object('nome', 'Diario', 'dosagem', '5 mg', 'frequencia', 'diaria')))));

    set local role postgres;
    select count(*) || ' ' || string_agg(a.severidade || ' ' || case d.usuario_id when adm then 'admin' else 'cuidadora' end || ' ' || (d.texto like '%de segunda, quinta: Semanal 70 mg%'), ',') into v
      from public.alerta a join public.alerta_destinatario d on d.alerta_id = a.id
     where a.idoso_id = ido and a.tipo = 'remedio_nao_diario';
    res := res || 'aviso=' || coalesce(v, 'nenhum') || ';';

    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', adm::text, true);
    set local role authenticated;
    perform public.decidir_leitura(lei, true);
    set local role postgres;
    select count(*) into n from public.alerta a join public.alerta_destinatario d on d.alerta_id = a.id
     where a.idoso_id = ido and a.tipo = 'remedio_nao_diario' and d.lido_em is null;
    res := res || 'aberto_depois=' || n || ';';

    raise exception 'RESULTADO_TESTE|%|%', res, 'aviso=1 urgente admin true;aberto_depois=0;';
  exception when others then
    if sqlerrm like 'RESULTADO_TESTE|%' then r := sqlerrm; else raise; end if;
  end;
  if split_part(r, '|', 2) is distinct from split_part(r, '|', 3) then
    raise exception E'Teste do aviso urgente FALHOU.\nObtido:   %\nEsperado: %', split_part(r, '|', 2), split_part(r, '|', 3);
  end if;
end $$;
