// Testes da descrição das correções de exame. Rodar com: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { descreverCorrecoes } from "../src/lib/correcoes.ts";

const cab = { tipo: "Hemograma", laboratorio: "Lab", data: "2026-11-20" };
const linha = (chave, extra = {}) => ({
  chave, nome: "Glicose", valor: "130", unidade: "mg/dL", refMin: "70", refMax: "99", analitoId: "g", ...extra,
});

test("sem mudança não há frase (vírgula e ponto são o mesmo número)", () => {
  assert.deepEqual(descreverCorrecoes(cab, cab, [linha("a", { valor: "13,5" })], [linha("a", { valor: "13.5" })]), []);
});

test("valor, referência e dia corrigidos aparecem", () => {
  const frases = descreverCorrecoes(cab, { ...cab, data: "2026-11-21" }, [linha("a")], [linha("a", { valor: "98", refMax: "100" })]);
  assert.deepEqual(frases, ["Dia da coleta: 20/11/2026 → 21/11/2026", "Glicose: 130 mg/dL → 98 mg/dL", "Glicose: referência corrigida"]);
});

test("linha tirada e linha adicionada aparecem", () => {
  const frases = descreverCorrecoes(cab, cab, [linha("a")], [linha("b", { nome: "Ureia", valor: "30" })]);
  assert.deepEqual(frases, ["Glicose: tirado", "Ureia adicionado: 30 mg/dL"]);
});
