// Testes das regras de agenda e dose. Rodar com: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  descreverAgenda,
  doseParaRegistrar,
  jaChegou,
  somarDias,
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

test("períodos do dia: ordem, atraso e dose da conversa", () => {
  const r = remedio({ horarios: ["noite", "manha"] });
  const d = dosesDoDia([r], [], HOJE, agora("12:01"));
  assert.deepEqual(d.map((x) => x.horario), ["manha", "noite"]);
  assert.equal(d[0].atrasada, true);
  assert.equal(d[1].atrasada, false);
  assert.equal(dosesDoDia([r], [], HOJE, agora("12:00"))[0].atrasada, false);
  assert.equal(doseParaRegistrar(d, "10:00")?.horario, "manha");
  assert.equal(jaChegou("noite", "10:00"), false);
  assert.equal(jaChegou("20:00", "19:05"), true);
  assert.equal(jaChegou("20:00", "19:05", 30), false, "em lote a folga é de 30 min");
  assert.equal(jaChegou("20:00", "19:30", 30), true);
  assert.equal(jaChegou("manha", "08:00"), true);
  assert.equal(descreverAgenda(r), "Todo dia, manhã e noite");
  assert.equal(validarAgenda(r), null);
});

test("SEGURANÇA: trocar de hora marcada para período não reabre a dose dada", () => {
  const d = dosesDoDia([remedio({ horarios: ["manha", "noite"] })], [registro("08:00")], HOJE, agora("13:00"));
  assert.equal(d[0].registro?.horario, "08:00");
  assert.equal(d[1].registro, null);
});

test("duração: quem escolheu ter fim precisa dizer qual", () => {
  assert.ok(validarAgenda(remedio({ fim: "" })));
  assert.equal(somarDias("2026-11-24", 6), "2026-11-30");
});

test("sugestão da receita é conservadora com horários", () => {
  assert.equal(sugerirAgenda("tomar se necessário, em caso de dor").frequencia, "quando_precisar");
  assert.equal(sugerirAgenda("1 comprimido de 8/8h").horarios, undefined);
  assert.equal(sugerirAgenda("de 12 em 12 horas").horarios, undefined);
  assert.deepEqual(sugerirAgenda("1 cp às 8h e às 20h").horarios, ["08:00", "20:00"]);
  assert.equal(sugerirAgenda("1 cp às 8h e 20h").horarios, undefined, "pegar só um seria pior que nenhum");
  assert.equal(sugerirAgenda("em dias alternados").intervalo_dias, 2);
  assert.deepEqual(sugerirAgenda("1x por semana").dias_semana, []);
  assert.deepEqual(sugerirAgenda("1 cp pela manhã e à noite").horarios, ["manha", "noite"]);
  assert.deepEqual(sugerirAgenda("tomar ao deitar").horarios, ["noite"]);
  assert.equal(sugerirAgenda("começar amanhã").horarios, undefined);
});

// Receita lida da foto -------------------------------------------------------

const { classificarRemedio } = await import("../src/lib/medicacao.ts");

const DIA = "2026-11-25";
const naLista = (extra = {}) => ({
  id: "m1", nome: "Losartana", dosagem: "50 mg", instrucoes: null, ativo: true, confirmado: true, autor_id: null,
  frequencia: "diaria", horarios: ["manha"], dias_semana: [], intervalo_dias: null, inicio: "2026-01-01", fim: null,
  ...extra,
});
const lido = (extra = {}) => ({
  nome: "Atorvastatina", dosagem: "20 mg", frequencia: "1 comprimido à noite", observacoes: null,
  parar: false, duracao_dias: null, medicacao_id: null, ...extra,
});
const classe = (l, lista = [naLista()]) => classificarRemedio(lido(l), lista, DIA);

test("receita: remédio novo com dose entra, com o período escrito", () => {
  const c = classe({});
  assert.equal(c.acao, "novo");
  assert.deepEqual(c.agenda.horarios, ["noite"]);
  assert.equal(c.agenda.fim, null);
});

test("receita: 'por 7 dias' vira data para acabar", () => {
  const c = classe({ frequencia: "de 8 em 8 horas por 7 dias" });
  assert.equal(c.agenda.fim, "2026-12-01");
  assert.deepEqual(c.agenda.horarios, []);
});

test("receita: o mesmo remédio com a mesma dose não duplica", () => {
  assert.equal(classe({ nome: "losartana potássica", dosagem: "50mg", frequencia: "1 pela manhã" }).acao, "ja_toma");
});

test("receita: dose diferente vira mudança", () => {
  const c = classe({ nome: "Losartana", dosagem: "100 mg", frequencia: "pela manhã" });
  assert.equal(c.acao, "mudar");
  assert.deepEqual(c.dados, { dosagem: "100 mg" });
});

test("receita: horário claro e diferente vira mudança", () => {
  const c = classe({ nome: "Losartana", dosagem: "50 mg", frequencia: "pela manhã e à noite" });
  assert.deepEqual(c.dados, { horarios: ["manha", "noite"] });
});

test("receita: outra fórmula não é tratada como o mesmo remédio", () => {
  for (const nome of ["Losartana + Hidroclorotiazida", "Losartana HCT"]) {
    assert.equal(classe({ nome, dosagem: "50 mg" }).acao, "duvida", nome);
  }
  assert.equal(classe({ nome: "Vitamina D" }, [naLista({ nome: "Vitamina B12" })]).acao, "duvida");
});

test("receita: se a IA acha que é um da lista com outro nome, não entra sozinho", () => {
  assert.equal(classe({ nome: "Cozaar", medicacao_id: "m1" }).acao, "duvida");
});

test("receita: semanal, mensal, dose única e meses não entram sozinhos", () => {
  for (const frequencia of ["1 vez por semana", "1 vez ao mês", "dose única", "às segundas", "por 3 meses"]) {
    assert.equal(classe({ nome: "Metotrexato", frequencia }).acao, "duvida", frequencia);
  }
});

test("receita: sem dose não entra, e 'suspender' nunca é aplicado sozinho", () => {
  assert.equal(classe({ dosagem: null }).acao, "duvida");
  assert.equal(classe({ nome: "Losartana", parar: true }).acao, "parar");
});

test("receita: acento escrito em duas partes não esconde o período", () => {
  const c = classe({ frequencia: "1 comprimido a\u0300 noite" });
  assert.deepEqual(c.agenda.horarios, ["noite"]);
});
