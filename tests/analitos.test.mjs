// Testes da regra de unidade dos resultados de exame. Rodar com: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { numeroDoTexto, resolver } from "../src/lib/analitos.ts";

const linha = (extra = {}) => ({
  nome: "Glicose", valor: "99", unidade: "mg/dL", refMin: "70", refMax: "99", analitoId: null, ...extra,
});
const glicose = [{ id: "g", nome_canonico: "Glicose", unidade_canonica: "mg/dL" }];

test("número com vírgula, vazio e texto", () => {
  assert.equal(numeroDoTexto("13,5"), 13.5);
  assert.equal(numeroDoTexto(" "), null);
  assert.ok(Number.isNaN(numeroDoTexto("negativo")));
});

test("mesma unidade: não converte e casa com o item que já existe", () => {
  const r = resolver(linha(), glicose);
  assert.equal(r.erro, null);
  assert.equal(r.convertido, false);
  assert.equal(r.alvo.id, "g");
});

test("unidade conhecida diferente: converte o valor e a referência", () => {
  const r = resolver(linha({ valor: "5,5", unidade: "mmol/L", refMin: "3,9", refMax: "5,5" }), glicose);
  assert.equal(r.erro, null);
  assert.equal(r.convertido, true);
  assert.equal(r.unidadeFinal, "mg/dL");
  assert.ok(Math.abs(r.valorFinal - 99.09) < 0.01);
});

test("unidade que não sei converter vira erro, não vira número errado", () => {
  assert.match(resolver(linha({ unidade: "UI/L" }), glicose).erro, /não sei converter/);
});

test("sem nome ou com valor que não é número não passa", () => {
  assert.ok(resolver(linha({ nome: " " }), []).erro);
  assert.ok(resolver(linha({ valor: "reagente" }), []).erro);
});
