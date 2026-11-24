-- Testes das regras que vivem no banco (passe geral antes da entrega).
--
-- Esta migração não altera o esquema. Ela cria um idoso e duas pessoas de teste, executa
-- cada regra como o usuário logado faria, confere o resultado e desfaz tudo no final.
-- Se alguma regra não se comportar como o documentado, a migração inteira é recusada.
--
-- Regras conferidas:
--  A  alerta automático de alergia e de medicação chega à cuidadora (operacional)
--  B  usuário logado não cria nem reescreve alerta; só marca o próprio como lido
--  C  diretiva gerada é imutável (só pode deixar de ser vigente); usuário não a insere
--  D  mensagem de chat não se edita e só pode ser escrita com o próprio id como autor
--  E  quem é de fora não escreve no cuidado de um idoso que não é seu

do $$
declare
  fam uuid := gen_random_uuid();
  cui uuid := gen_random_uuid();
  fora uuid := gen_random_uuid();
  ido uuid;
  res text := '';
  esperado text;
  n_antes int;
  n_depois int;
  n_dest int;
  conv uuid;
  d uuid;
  alvo uuid;
  r text;
begin
  begin
    insert into auth.users (id, email) values
      (fam, 'teste-fam-' || fam || '@exemplo.invalid'),
      (cui, 'teste-cui-' || cui || '@exemplo.invalid'),
      (fora, 'teste-fora-' || fora || '@exemplo.invalid');
    insert into public.idoso (nome) values ('Teste de regras') returning id into ido;
    insert into public.vinculo (usuario_id, idoso_id, papel, admin) values
      (fam, ido, 'familiar', true),
      (cui, ido, 'cuidador', false);

    -- A. alertas automaticos ------------------------------------------------
    select count(*) into n_antes from public.alerta where idoso_id = ido;
    insert into public.alergia (idoso_id, substancia, reacao, gravidade, autor_id)
      values (ido, 'dipirona', 'urticaria', 'grave', fam);
    select count(*) into n_depois from public.alerta where idoso_id = ido;
    res := res || 'A_alergia_gera_alerta=' || (n_depois > n_antes) || ';';

    select count(*) into n_dest from public.alerta_destinatario d
      join public.alerta a on a.id = d.alerta_id
      where a.idoso_id = ido and d.usuario_id = cui;
    res := res || 'A_cuidadora_recebe=' || (n_dest > 0) || ';';

    select count(*) into n_antes from public.alerta where idoso_id = ido;
    insert into public.medicacao (idoso_id, nome, dosagem, autor_id)
      values (ido, 'Teste 10mg', '10mg', fam);
    select count(*) into n_depois from public.alerta where idoso_id = ido;
    res := res || 'A_medicacao_gera_alerta=' || (n_depois > n_antes) || ';';

    -- B. alerta: so o sistema escreve ---------------------------------------
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', fam, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', fam::text, true);
      set local role authenticated;
      insert into public.alerta (idoso_id, tipo, severidade, natureza, titulo)
        values (ido, 'forjado', 'info', 'clinico', 'forjado');
      reset role;
      res := res || 'B_insere_alerta=permitido;';
    exception when others then
      reset role;
      res := res || 'B_insere_alerta=bloqueado;';
    end;

    begin
      perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', cui::text, true);
      set local role authenticated;
      update public.alerta_destinatario set texto = 'reescrito' where usuario_id = cui;
      reset role;
      res := res || 'B_reescreve_texto=permitido;';
    exception when others then
      reset role;
      res := res || 'B_reescreve_texto=bloqueado;';
    end;

    begin
      perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', cui::text, true);
      set local role authenticated;
      update public.alerta_destinatario set lido_em = now() where usuario_id = cui;
      reset role;
      res := res || 'B_marca_lido=permitido;';
    exception when others then
      reset role;
      res := res || 'B_marca_lido=bloqueado;';
    end;

    -- C. diretiva imutavel ---------------------------------------------------
    begin
      set local role postgres;
      insert into public.diretiva (idoso_id, respostas, versao_questionario, modo_preenchimento, titular_presente, vigente)
        values (ido, '{"a":1}', 'teste', 'assistido', true, true) returning id into d;
      reset role;
    exception when others then
      reset role;
      res := res || 'SETUP_DIRETIVA_FALHOU(' || current_user || ',' || session_user || ',' || sqlerrm || ');';
    end;

    begin
      set local role postgres;
      update public.diretiva set respostas = '{"a":2}' where id = d;
      reset role;
      res := res || 'C_altera_conteudo=permitido;';
    exception when others then
      reset role;
      res := res || 'C_altera_conteudo=bloqueado;';
    end;

    begin
      set local role postgres;
      update public.diretiva set vigente = false where id = d;
      reset role;
      res := res || 'C_deixa_de_ser_vigente=permitido;';
    exception when others then
      reset role;
      res := res || 'C_deixa_de_ser_vigente=bloqueado;';
    end;

    begin
      perform set_config('request.jwt.claims', json_build_object('sub', fam, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', fam::text, true);
      set local role authenticated;
      insert into public.diretiva (idoso_id, respostas) values (ido, '{}');
      reset role;
      res := res || 'C_usuario_insere=permitido;';
    exception when others then
      reset role;
      res := res || 'C_usuario_insere=bloqueado;';
    end;

    -- D. mensagens -----------------------------------------------------------
    begin
      set local role postgres;
      insert into public.conversa (idoso_id, iniciada_por, tipo, status)
        values (ido, cui, 'livre', 'pendente') returning id into conv;
      reset role;
    exception when others then
      reset role;
      res := res || 'SETUP_CONVERSA_FALHOU(' || current_user || ',' || session_user || ',' || sqlerrm || ');';
    end;

    begin
      perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', cui::text, true);
      set local role authenticated;
      insert into public.mensagem (conversa_id, papel_emissor, conteudo, autor_id)
        values (conv, 'user', 'falei eu', cui);
      reset role;
      res := res || 'D_mensagem_propria=permitido;';
    exception when others then
      reset role;
      res := res || 'D_mensagem_propria=bloqueado;';
    end;

    begin
      perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', cui::text, true);
      set local role authenticated;
      insert into public.mensagem (conversa_id, papel_emissor, conteudo, autor_id)
        values (conv, 'user', 'finjo ser outra pessoa', fam);
      reset role;
      res := res || 'D_mensagem_em_nome_de_outro=permitido;';
    exception when others then
      reset role;
      res := res || 'D_mensagem_em_nome_de_outro=bloqueado;';
    end;

    begin
      perform set_config('request.jwt.claims', json_build_object('sub', cui, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', cui::text, true);
      set local role authenticated;
      update public.mensagem set conteudo = 'editada' where conversa_id = conv;
      reset role;
      res := res || 'D_edita_mensagem=permitido;';
    exception when others then
      reset role;
      res := res || 'D_edita_mensagem=bloqueado;';
    end;

    -- E. quem e de fora nao escreve num idoso alheio ------------------------------
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', fora, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', fora::text, true);
      set local role authenticated;
      insert into public.sintoma (idoso_id, descricao, autor_id) values (ido, 'invasao', fora);
      reset role;
      res := res || 'E_fora_escreve_sintoma=permitido;';
    exception when others then
      reset role;
      res := res || 'E_fora_escreve_sintoma=bloqueado;';
    end;

    begin
      perform set_config('request.jwt.claims', json_build_object('sub', fora, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', fora::text, true);
      set local role authenticated;
      select count(*) into n_depois from public.sintoma where idoso_id = ido;
      reset role;
      res := res || 'E_fora_le_sintoma=' || (n_depois > 0) || ';';
    exception when others then
      reset role;
      res := res || 'E_fora_le_sintoma=erro;';
    end;

    esperado :=
      'A_alergia_gera_alerta=true;A_cuidadora_recebe=true;A_medicacao_gera_alerta=true;'
      'B_insere_alerta=bloqueado;B_reescreve_texto=bloqueado;B_marca_lido=permitido;'
      'C_altera_conteudo=bloqueado;C_deixa_de_ser_vigente=permitido;C_usuario_insere=bloqueado;'
      'D_mensagem_propria=permitido;D_mensagem_em_nome_de_outro=bloqueado;D_edita_mensagem=bloqueado;'
      'E_fora_escreve_sintoma=bloqueado;E_fora_le_sintoma=false;';
    raise exception 'RESULTADO_TESTE|%|%', res, esperado;
  exception when others then
    if sqlerrm like 'RESULTADO_TESTE|%' then
      r := sqlerrm;
    else
      raise;
    end if;
  end;

  if split_part(r, '|', 2) is distinct from split_part(r, '|', 3) then
    raise exception E'Teste das regras do banco FALHOU.\nObtido:   %\nEsperado: %',
      split_part(r, '|', 2), split_part(r, '|', 3);
  end if;
  raise notice 'Testes das regras do banco: todos conferem.';
end $$;
