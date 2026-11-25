// Testes das regras das tarefas. Rodar com: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { descreverQuando, tarefasDoDia, validarTarefa } from "../src/lib/tarefas.ts";

const HOJE = "2026-11-24"; // terça-feira
const tarefa = (extra = {}) => ({
  id: "t1",
  titulo: "Medir a pressão",
  instrucao: null,
  frequencia: "diaria",
  dias_semana: [],
  data: "2026-11-01",
  ...extra,
});
const resposta = (data, extra = {}) => ({ tarefa_id: "t1", data, status: "feito", nota: null, ...extra });

test("diária: a resposta de ontem não vale para hoje", () => {
  const [item] = tarefasDoDia([tarefa()], [resposta("2026-11-23")], HOJE);
  assert.equal(item.registro, null);
  assert.equal(item.atrasada, false);
});

test("diária: não aparece antes de começar a valer", () => {
  assert.equal(tarefasDoDia([tarefa({ data: "2026-11-25" })], [], HOJE).length, 0);
});

test("dias da semana: só nos dias escolhidos", () => {
  assert.equal(tarefasDoDia([tarefa({ frequencia: "semana", dias_semana: [2] })], [], HOJE).length, 1);
  assert.equal(tarefasDoDia([tarefa({ frequencia: "semana", dias_semana: [1, 3] })], [], HOJE).length, 0);
});

test("uma vez: futura não aparece, passada sem resposta continua como atrasada", () => {
  const uma = (data) => tarefa({ frequencia: "uma_vez", data });
  assert.equal(tarefasDoDia([uma("2026-11-25")], [], HOJE).length, 0);
  assert.equal(tarefasDoDia([uma(HOJE)], [], HOJE)[0].atrasada, false);
  assert.equal(tarefasDoDia([uma("2026-11-20")], [], HOJE)[0].atrasada, true);
});

test("uma vez: respondida aparece só no dia da resposta e não volta", () => {
  const uma = tarefa({ frequencia: "uma_vez", data: "2026-11-20" });
  assert.equal(tarefasDoDia([uma], [resposta(HOJE)], HOJE)[0].registro.status, "feito");
  assert.equal(tarefasDoDia([uma], [resposta("2026-11-23")], HOJE).length, 0);
  assert.equal(tarefasDoDia([uma], [resposta(HOJE, { status: "nao_consegui" })], "2026-11-25").length, 0);
});

test("descrição e validação", () => {
  assert.equal(descreverQuando(tarefa({ frequencia: "semana", dias_semana: [3, 1] })), "Seg e qua");
  assert.equal(descreverQuando(tarefa({ frequencia: "uma_vez", data: HOJE })), "Só uma vez, em 24/11");
  assert.equal(validarTarefa(tarefa()), null);
  assert.ok(validarTarefa(tarefa({ titulo: "  " })));
  assert.ok(validarTarefa(tarefa({ frequencia: "semana" })));
  assert.ok(validarTarefa(tarefa({ frequencia: "uma_vez", data: "" })));
});
