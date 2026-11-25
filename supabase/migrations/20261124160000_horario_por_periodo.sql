-- Além de hora marcada, o remédio pode ser por período do dia: manhã, tarde ou noite.

alter table public.medicacao drop constraint if exists medicacao_agenda_valida;
alter table public.medicacao add constraint medicacao_agenda_valida check (
  frequencia in ('diaria', 'semana', 'intervalo', 'quando_precisar')
  and (frequencia <> 'semana' or cardinality(dias_semana) > 0)
  and dias_semana <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
  and (frequencia <> 'intervalo' or coalesce(intervalo_dias, 0) between 2 and 365)
  and (fim is null or fim >= inicio)
  and (
    cardinality(horarios) = 0
    or array_to_string(horarios, ',') ~
       '^(manha|tarde|noite|([01][0-9]|2[0-3]):[0-5][0-9])(,(manha|tarde|noite|([01][0-9]|2[0-3]):[0-5][0-9]))*$'
  )
);

-- Teste (desfeito no fim)
do $$
declare
  ido uuid;
  res text := '';
  r text;
  caso text[];
begin
  begin
    insert into public.idoso (nome) values ('Teste de periodo') returning id into ido;
    foreach caso slice 1 in array array[array['manha', 'noite'], array['08:00', '20:30'], array['cedo', 'noite'], array['25:00', 'noite']]
    loop
      begin
        insert into public.medicacao (idoso_id, nome, horarios) values (ido, 'x', caso);
        res := res || 'aceito;';
      exception when check_violation then
        res := res || 'recusado;';
      end;
    end loop;
    raise exception 'RESULTADO_TESTE|%|%', res, 'aceito;aceito;recusado;recusado;';
  exception when others then
    if sqlerrm like 'RESULTADO_TESTE|%' then r := sqlerrm; else raise; end if;
  end;
  if split_part(r, '|', 2) is distinct from split_part(r, '|', 3) then
    raise exception E'Teste dos horários FALHOU.\nObtido:   %\nEsperado: %',
      split_part(r, '|', 2), split_part(r, '|', 3);
  end if;
end $$;
