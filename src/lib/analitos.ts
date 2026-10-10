// Funcoes puras de analitos (usadas no servidor e no navegador).
//
// A conversao de unidade NAO e feita pela IA: valor de exame e dado clinico, entao
// so converto onde existe fator conhecido e publicado. Sem fator, o resultado fica
// marcado como "sem conversao" e a tela pede correcao antes de confirmar.

export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizarUnidade(un: string | null | undefined): string {
  if (!un) return "";
  return un
    .replace("µ", "u")
    .replace("μ", "u")
    .replace(/\s+/g, "")
    .toLowerCase();
}

type Regra = {
  /** casa com o nome normalizado do analito */
  nome: RegExp;
  /** nomes que parecem casar mas nao podem usar a regra */
  exceto?: RegExp;
  /** unidades normalizadas: a (convencional) e b (SI); b = a * fator */
  a: string;
  b: string;
  fator: number;
};

const REGRAS: Regra[] = [
  { nome: /glicose|glicemia/, exceto: /glicad|hemoglobina/, a: "mg/dl", b: "mmol/l", fator: 1 / 18.016 },
  { nome: /colesterol/, a: "mg/dl", b: "mmol/l", fator: 1 / 38.67 },
  { nome: /triglicer/, a: "mg/dl", b: "mmol/l", fator: 1 / 88.57 },
  { nome: /creatinina/, a: "mg/dl", b: "umol/l", fator: 88.4 },
  { nome: /acido urico/, a: "mg/dl", b: "umol/l", fator: 59.48 },
  { nome: /^hemoglobina$|^hb$/, a: "g/dl", b: "g/l", fator: 10 },
  { nome: /vitamina d|25.?oh/, a: "ng/ml", b: "nmol/l", fator: 2.496 },
];

export type Conversao = {
  valor: number;
  convertido: boolean;
  /** unidades diferentes e nenhum fator conhecido: nao da pra confirmar assim */
  semFator: boolean;
};

export function converter(
  nome: string,
  valor: number,
  de: string,
  para: string,
): Conversao {
  const origem = normalizarUnidade(de);
  const destino = normalizarUnidade(para);
  if (!destino || origem === destino) {
    return { valor, convertido: false, semFator: false };
  }
  const n = normalizar(nome);
  for (const r of REGRAS) {
    if (!r.nome.test(n) || (r.exceto && r.exceto.test(n))) continue;
    if (origem === r.a && destino === r.b) {
      return { valor: arredondar(valor * r.fator), convertido: true, semFator: false };
    }
    if (origem === r.b && destino === r.a) {
      return { valor: arredondar(valor / r.fator), convertido: true, semFator: false };
    }
  }
  return { valor, convertido: false, semFator: true };
}

function arredondar(v: number): number {
  return Math.round(v * 100) / 100;
}
