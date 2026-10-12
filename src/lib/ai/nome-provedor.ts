// Textos de privacidade das telas de IA. Usam a mesma variável pública que escolhe
// o provedor (NEXT_PUBLIC_IA_PROVEDOR), então os avisos nunca divergem do que
// realmente está ativo.
//
// NOME_PROVEDOR vem sem artigo, para usar assim: "enviado à {NOME_PROVEDOR}".

const ANTHROPIC = process.env.NEXT_PUBLIC_IA_PROVEDOR === "anthropic";

export const NOME_PROVEDOR = ANTHROPIC ? "IA da Anthropic" : "IA do Google (Gemini)";

/** Só aparece no plano gratuito do Google, onde o conteúdo pode ser usado pelo provedor. */
export const AVISO_PLANO_GRATIS = ANTHROPIC
  ? ""
  : " No plano gratuito do Google o conteúdo pode ser usado para melhorar os produtos deles: use apenas documentos sem dados reais.";
