// Provedor Google (Gemini). So no servidor: a chave fica em GEMINI_API_KEY.
//
// Atencao ao plano gratuito: o Google informa que o conteudo enviado nele pode ser
// usado para melhorar os produtos. Por isso, nele, so documentos sem dado real.

import { ApiError, GoogleGenAI } from "@google/genai";
import type { z } from "zod";
import { ErroIA, type OpcoesExtracao } from "@/lib/ai/comum";
import { schemaParaGemini } from "@/lib/ai/schema-gemini";

export const MODELO_GEMINI = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";

export async function extrairGemini<S extends z.ZodType>(
  opts: OpcoesExtracao<S>,
): Promise<z.infer<S>> {
  const chave = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!chave) {
    throw new ErroIA(
      "A chave da IA (GEMINI_API_KEY) nao esta configurada no servidor.",
      503,
    );
  }
  const client = new GoogleGenAI({ apiKey: chave });

  // Instrucao antes do arquivo, como a documentacao recomenda.
  const input: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mime_type: string }
    | { type: "document"; data: string; mime_type: string }
  > = [{ type: "text", text: opts.instrucao }];

  const e = opts.entrada;
  if (e?.tipo === "texto") {
    input.push({ type: "text", text: `<material>\n${e.texto}\n</material>` });
  } else if (e?.tipo === "imagem") {
    input.push({ type: "image", data: e.base64, mime_type: e.mediaType });
  } else if (e?.tipo === "pdf") {
    input.push({ type: "document", data: e.base64, mime_type: "application/pdf" });
  }

  const schemaJson = schemaParaGemini(opts.schema);

  let texto: string | undefined;
  try {
    const resposta = await client.interactions.create({
      model: MODELO_GEMINI,
      system_instruction: opts.system,
      input,
      // Nao deixa o Google guardar a requisicao e a resposta para consulta depois.
      store: false,
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: schemaJson,
      },
    });
    texto = resposta.output_text;
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 429) {
        throw new ErroIA(
          "Limite gratuito da IA atingido. Espere um minuto e tente de novo.",
          429,
        );
      }
      if (err.status === 401 || err.status === 403) {
        throw new ErroIA("A chave da IA configurada no servidor e invalida.", 503);
      }
      if (err.status === 400) {
        throw new ErroIA(`A IA nao aceitou o material enviado: ${err.message}`, 422);
      }
      if (err.status === 503) {
        throw new ErroIA("A IA esta sobrecarregada agora. Tente de novo em instantes.", 503);
      }
    }
    throw new ErroIA("Nao consegui falar com a IA agora. Tente de novo.");
  }

  if (!texto) {
    throw new ErroIA(
      "A IA nao devolveu resposta para este material. Tente de novo ou preencha manualmente.",
      422,
    );
  }

  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    throw new ErroIA("A resposta da IA veio incompleta. Tente de novo.");
  }
  // A forma da resposta e conferida aqui, no servidor, contra o schema do projeto.
  const valido = opts.schema.safeParse(bruto);
  if (!valido.success) {
    throw new ErroIA("A resposta da IA veio fora do formato esperado. Tente de novo.");
  }
  return valido.data;
}
