// Provedor Anthropic (Claude). Em STANDBY: so e usado quando
// NEXT_PUBLIC_IA_PROVEDOR=anthropic (ver ia.ts). So no servidor; a chave fica em
// ANTHROPIC_API_KEY e nunca vai para o navegador.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { ErroIA, type OpcoesExtracao } from "@/lib/ai/comum";

export const MODELO = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";

export async function extrairClaude<S extends z.ZodType>(
  opts: OpcoesExtracao<S>,
): Promise<z.infer<S>> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ErroIA(
      "A chave da IA (ANTHROPIC_API_KEY) não está configurada no servidor.",
      503,
    );
  }
  const client = new Anthropic();

  const conteudo: Anthropic.ContentBlockParam[] = [];
  if (opts.entrada?.tipo === "imagem") {
    conteudo.push({
      type: "image",
      source: {
        type: "base64",
        media_type: opts.entrada.mediaType,
        data: opts.entrada.base64,
      },
    });
  } else if (opts.entrada?.tipo === "pdf") {
    conteudo.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: opts.entrada.base64,
      },
    });
  } else if (opts.entrada?.tipo === "texto") {
    conteudo.push({
      type: "text",
      text: `<material>\n${opts.entrada.texto}\n</material>`,
    });
  }
  conteudo.push({ type: "text", text: opts.instrucao });

  try {
    const resposta = await client.messages.parse({
      model: MODELO,
      max_tokens: opts.maxTokens ?? 16000,
      system: opts.system,
      messages: [{ role: "user", content: conteudo }],
      output_config: { format: zodOutputFormat(opts.schema) },
    });

    if (resposta.stop_reason === "refusal") {
      throw new ErroIA(
        "A IA recusou processar este material. Tente outro arquivo ou preencha manualmente.",
        422,
      );
    }
    if (resposta.stop_reason === "max_tokens" || !resposta.parsed_output) {
      throw new ErroIA(
        "A resposta da IA veio incompleta. Tente de novo ou use um arquivo menor.",
      );
    }
    return resposta.parsed_output;
  } catch (e) {
    if (e instanceof ErroIA) throw e;
    if (e instanceof Anthropic.RateLimitError) {
      throw new ErroIA("Muitas requisições à IA agora. Tente de novo em um minuto.", 429);
    }
    if (e instanceof Anthropic.AuthenticationError) {
      throw new ErroIA("A chave da IA configurada no servidor é inválida.", 503);
    }
    if (e instanceof Anthropic.BadRequestError) {
      throw new ErroIA(`A IA não aceitou o material enviado: ${e.message}`, 422);
    }
    throw new ErroIA("Não consegui falar com a IA agora. Tente de novo.");
  }
}
