// Ponto unico de entrada da IA. Quem chama (as rotas /api/ia/*) nao sabe qual
// provedor esta ativo: isso e escolhido pela variavel NEXT_PUBLIC_IA_PROVEDOR.
//
//   google     (padrao)  Gemini
//   anthropic  (standby) Claude
//
// Trocar de provedor e trocar a variavel e a chave; nada mais muda.

import type { z } from "zod";
import type { OpcoesExtracao } from "@/lib/ai/comum";
import { extrairClaude } from "@/lib/ai/claude";
import { extrairGemini } from "@/lib/ai/gemini";

export function provedorAtual(): "google" | "anthropic" {
  return process.env.NEXT_PUBLIC_IA_PROVEDOR === "anthropic" ? "anthropic" : "google";
}

export async function extrair<S extends z.ZodType>(
  opts: OpcoesExtracao<S>,
): Promise<z.infer<S>> {
  return provedorAtual() === "anthropic" ? extrairClaude(opts) : extrairGemini(opts);
}
