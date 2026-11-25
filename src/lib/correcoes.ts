// O que mudou numa correção de exame, em frases: é o que quem cuida recebe no aviso.
// Sem imports, para poder ser testado sozinho (npm test).

export type CabecalhoDeExame = { tipo: string; laboratorio: string; data: string };

export type LinhaEditada = {
  /** identifica a mesma linha antes e depois, mesmo se o nome mudar */
  chave: string;
  nome: string;
  valor: string;
  unidade: string;
  refMin: string;
  refMax: string;
  analitoId: string | null;
};

const igual = (a: string, b: string) => a.trim().replace(",", ".") === b.trim().replace(",", ".");
const dia = (iso: string) => iso.split("-").reverse().join("/");
const comUnidade = (l: LinhaEditada) => `${l.valor.trim()} ${l.unidade.trim()}`.trim();

export function descreverCorrecoes(
  antes: CabecalhoDeExame,
  depois: CabecalhoDeExame,
  linhasAntes: LinhaEditada[],
  linhasDepois: LinhaEditada[],
): string[] {
  const frases: string[] = [];
  if (!igual(antes.tipo, depois.tipo)) frases.push(`Nome do exame: ${antes.tipo || "vazio"} → ${depois.tipo || "vazio"}`);
  if (!igual(antes.laboratorio, depois.laboratorio)) {
    frases.push(`Laboratório: ${antes.laboratorio || "vazio"} → ${depois.laboratorio || "vazio"}`);
  }
  if (antes.data !== depois.data) frases.push(`Dia da coleta: ${dia(antes.data)} → ${dia(depois.data)}`);

  const novas = new Map(linhasDepois.map((l) => [l.chave, l]));
  for (const a of linhasAntes) {
    const d = novas.get(a.chave);
    if (!d) {
      frases.push(`${a.nome}: tirado`);
      continue;
    }
    if (!igual(a.nome, d.nome)) frases.push(`${a.nome} passou a se chamar ${d.nome.trim()}`);
    if (!igual(a.valor, d.valor) || !igual(a.unidade, d.unidade)) {
      frases.push(`${d.nome.trim()}: ${comUnidade(a)} → ${comUnidade(d)}`);
    }
    if (!igual(a.refMin, d.refMin) || !igual(a.refMax, d.refMax)) frases.push(`${d.nome.trim()}: referência corrigida`);
  }
  const antigas = new Set(linhasAntes.map((l) => l.chave));
  for (const d of linhasDepois) {
    if (!antigas.has(d.chave)) frases.push(`${d.nome.trim()} adicionado: ${comUnidade(d)}`);
  }
  return frases;
}
