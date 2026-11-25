// Testes das regras de agenda e dose. Rodar com: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  descreverAgenda,
  doseParaRegistrar,
  dosesDoDia,
  resumoDoDia,
  sugerirAgenda,
  validarAgenda,
  valeNoDia,
} from "../src/lib/medicacao.ts";

const HOJE = "2026-11-24"; // terça-feira
const agora = (hora) => ({ dia: HOJE, hora });

const remedio = (extra = {}) => ({
  id: "m1",
  nome: "Remédio",
  dosagem: null,
  instrucoes: null,
  ativo: true,
  confirmado: true,
  autor_id: null,
  frequencia: "diaria",
  horarios: ["08:00", "20:00"],
  dias_semana: [],
  intervalo_dias: null,
  inicio: "2026-11-01",
  fim: null,
  ...extra,
});

const registro = (horario, extra = {}) => ({
  medicacao_id: "m1",
  data: HOJE,
  horario,
  status: "dada",
  motivo: null,
  ...extra,
});

test("cada horário vira uma dose", () => {
  const d = dosesDoDia([remedio()], [], HOJE, agora("07:00"));
  assert.deepEqual(d.map((x) => x.horario), ["08:00", "20:00"]);
});

test("dose só fica atrasada depois da tolerância", () => {
  assert.equal(dosesDoDia([remedio()], [], HOJE, agora("08:30"))[0].atrasada, false);
  assert.equal(dosesDoDia([remedio()], [], HOJE, agora("08:31"))[0].atrasada, true);
  assert.equal(dosesDoDia([remedio()], [], HOJE, agora("08:31"))[1].atrasada, false);
});

test("SEGURANÇA: mudar o horário não faz a dose já dada voltar a ficar pendente", () => {
  const mudado = remedio({ horarios: ["09:00", "21:00"] });
  const d = dosesDoDia([mudado], [registro("08:00")], HOJE, agora("12:00"));
  assert.equal(d[0].registro?.horario, "08:00");
  assert.equal(d[0].horarioAntigo, true);
  assert.equal(d[1].registro, null);
});

test("SEGURANÇA: registro antigo sem horário cobre uma dose do dia", () => {
  const d = dosesDoDia([remedio()], [registro("")], HOJE, agora("12:00"));
  assert.equal(d.filter((x) => x.registro).length, 1);
});

test("SEGURANÇA: de duas para uma dose, o dia já registrado continua resolvido", () => {
  const d = dosesDoDia([remedio({ horarios: ["12:00"] })], [registro("08:00")], HOJE, agora("13:00"));
  assert.equal(d.length, 1);
  assert.ok(d[0].registro);
});

test("sem horário: uma dose por dia, nunca atrasada", () => {
  const d = dosesDoDia([remedio({ horarios: [] })], [], HOJE, agora("23:59"));
  assert.equal(d.length, 1);
  assert.equal(d[0].atrasada, false);
});

test("dias da semana, intervalo, período e quando precisar", () => {
  assert.equal(valeNoDia(remedio({ frequencia: "semana", dias_semana: [2] }), HOJE), true);
  assert.equal(valeNoDia(remedio({ frequencia: "semana", dias_semana: [1, 3] }), HOJE), false);
  const alternado = remedio({ frequencia: "intervalo", intervalo_dias: 2, inicio: "2026-11-22" });
  assert.equal(valeNoDia(alternado, "2026-11-24"), true);
  assert.equal(valeNoDia(alternado, "2026-11-23"), false);
  assert.equal(valeNoDia(remedio({ fim: "2026-11-23" }), HOJE), false);
  assert.equal(valeNoDia(remedio({ inicio: "2026-11-25" }), HOJE), false);
  assert.equal(valeNoDia(remedio({ frequencia: "quando_precisar" }), HOJE), false);
  assert.equal(valeNoDia(remedio({ ativo: false }), HOJE), false);
});

test("dose da conversa: a que já chegou, não a da noite", () => {
  const d = dosesDoDia([remedio()], [], HOJE, agora("10:00"));
  assert.equal(doseParaRegistrar(d, "10:00")?.horario, "08:00");
  assert.equal(doseParaRegistrar(d, "22:00")?.horario, "20:00");
  const tudo = dosesDoDia([remedio()], [registro("08:00"), registro("20:00")], HOJE, agora("22:00"));
  assert.equal(doseParaRegistrar(tudo, "22:00"), null);
});

test("descrição e validação", () => {
  assert.equal(descreverAgenda(remedio()), "Todo dia, 08:00 e 20:00");
  assert.equal(
    descreverAgenda(remedio({ frequencia: "semana", dias_semana: [5, 1, 3], horarios: ["09:00"], fim: "2026-12-01" })),
    "Seg, qua e sex, 09:00 · até 01/12",
  );
  assert.equal(validarAgenda(remedio()), null);
  assert.ok(validarAgenda(remedio({ frequencia: "semana" })));
  assert.ok(validarAgenda(remedio({ horarios: ["08:00", "08:00"] })));
  assert.ok(validarAgenda(remedio({ horarios: [""] })));
});

test("resumo do dia: uma de duas doses não conta como feito", () => {
  assert.equal(resumoDoDia(remedio(), [registro("08:00")], HOJE).situacao, "parcial");
  assert.equal(resumoDoDia(remedio(), [registro("08:00"), registro("20:00")], HOJE).situacao, "dada");
  assert.equal(
    resumoDoDia(remedio(), [registro("08:00"), registro("20:00", { status: "nao_dada" })], HOJE).situacao,
    "nao_dada",
  );
  assert.equal(resumoDoDia(remedio(), [], HOJE).situacao, "sem_registro");
  assert.equal(resumoDoDia(remedio({ frequencia: "semana", dias_semana: [1] }), [], HOJE).situacao, "sem_dose");
});

test("sugestão da receita é conservadora com horários", () => {
  assert.equal(sugerirAgenda("tomar se necessário, em caso de dor").frequencia, "quando_precisar");
  assert.equal(sugerirAgenda("1 comprimido de 8/8h").horarios, undefined);
  assert.equal(sugerirAgenda("de 12 em 12 horas").horarios, undefined);
  assert.deepEqual(sugerirAgenda("1 cp às 8h e às 20h").horarios, ["08:00", "20:00"]);
  assert.equal(sugerirAgenda("1 cp às 8h e 20h").horarios, undefined, "pegar só um seria pior que nenhum");
  assert.equal(sugerirAgenda("em dias alternados").intervalo_dias, 2);
  assert.deepEqual(sugerirAgenda("1x por semana").dias_semana, []);
});
