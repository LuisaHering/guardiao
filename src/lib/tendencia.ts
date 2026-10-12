// Funções puras da tela de tendências, usadas pelo gráfico e pela página.
// Mantidas juntas para que os dois sempre digam a mesma coisa sobre um valor.

export function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return "-";
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

export function dataCurta(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** "70 a 99", "até 190", "a partir de 12" ou "" quando o laudo não trouxe faixa. */
export function textoFaixa(min: number | null, max: number | null) {
  if (min !== null && max !== null) return `${fmt(min)} a ${fmt(max)}`;
  if (max !== null) return `até ${fmt(max)}`;
  if (min !== null) return `a partir de ${fmt(min)}`;
  return "";
}

type ComFaixa = { valor: number; refMin: number | null; refMax: number | null };

/** Compara o valor com a faixa IMPRESSA no próprio laudo. Não interpreta o resultado. */
export function posicaoNaFaixa(p: ComFaixa): "abaixo" | "acima" | "dentro" | "sem-faixa" {
  if (p.refMin === null && p.refMax === null) return "sem-faixa";
  if (p.refMin !== null && p.valor < p.refMin) return "abaixo";
  if (p.refMax !== null && p.valor > p.refMax) return "acima";
  return "dentro";
}

export function rotuloPosicao(p: ComFaixa): string {
  switch (posicaoNaFaixa(p)) {
    case "abaixo":
      return `abaixo da faixa do laudo (${textoFaixa(p.refMin, p.refMax)})`;
    case "acima":
      return `acima da faixa do laudo (${textoFaixa(p.refMin, p.refMax)})`;
    case "dentro":
      return `dentro da faixa do laudo (${textoFaixa(p.refMin, p.refMax)})`;
    default:
      return "o laudo não trouxe faixa de referência";
  }
}
