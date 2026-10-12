// Textos de privacidade das telas de IA. Usam a mesma variavel publica que escolhe
// o provedor (NEXT_PUBLIC_IA_PROVEDOR), entao os avisos nunca divergem do que
// realmente esta ativo.

const ANTHROPIC = process.env.NEXT_PUBLIC_IA_PROVEDOR === "anthropic";

export const NOME_PROVEDOR = ANTHROPIC ? "a IA da Anthropic" : "a IA do Google (Gemini)";

/** So aparece no plano gratuito do Google, onde o conteudo pode ser usado pelo provedor. */
export const AVISO_PLANO_GRATIS = ANTHROPIC
  ? ""
  : " No plano gratuito do Google o conteudo pode ser usado para melhorar os produtos deles: use apenas documentos sem dados reais.";
