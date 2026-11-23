// Provedor Google (Gemini). So no servidor: a chave fica em GEMINI_API_KEY.
//
// Atencao ao plano gratuito: o Google informa que o conteudo enviado nele pode ser
// usado para melhorar os produtos. Por isso, nele, so documentos sem dado real.

import { GoogleGenAI } from "@google/genai";
import type { z } from "zod";
import { ErroIA, type OpcoesExtracao } from "@/lib/ai/comum";
import { schemaParaGemini } from "@/lib/ai/schema-gemini";

// gemini-3.6-flash: no teste com esta conta, o 3.8 estourou a cota logo na primeira
// chamada e os 2.5 ja nao aceitam contas novas. Troque por GEMINI_MODEL se preciso.
export const MODELO_GEMINI = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";

// Opcional: reduz o "raciocinio" do modelo para responder bem mais rapido
// (medido: ~5 s com "low" contra ~18 a 59 s no padrao), a custo de profundidade.
const NIVEL_RACIOCINIO = process.env.GEMINI_THINKING;

export async function extrairGemini<S extends z.ZodType>(
  opts: OpcoesExtracao<S>,
): Promise<z.infer<S>> {
  const chave = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!chave) {
    throw new ErroIA(
      "A chave da IA (GEMINI_API_KEY) não está configurada no servidor.",
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
      model: opts.modelo ?? MODELO_GEMINI,
      system_instruction: opts.system,
      input,
      // Nao deixa o Google guardar a requisicao e a resposta para consulta depois.
      store: false,
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: schemaJson,
      },
      ...(NIVEL_RACIOCINIO === "low" ||
      NIVEL_RACIOCINIO === "medium" ||
      NIVEL_RACIOCINIO === "high"
        ? { generation_config: { thinking_level: NIVEL_RACIOCINIO } }
        : {}),
    });
    texto = resposta.output_text;
  } catch (err) {
    // O SDK lanca classes diferentes por status (ex: RateLimitError), nem todas
    // herdam de ApiError; por isso olho o status, nao a classe.
    const status = (err as { status?: number } | null)?.status;
    const detalhe = err instanceof Error ? err.message : "";
    if (status === 429) {
      throw new ErroIA(
        "Limite gratuito da IA atingido. Espere um minuto e tente de novo.",
        429,
      );
    }
    if (status === 401 || status === 403) {
      throw new ErroIA("A chave da IA configurada no servidor é inválida.", 503);
    }
    if (status === 404) {
      throw new ErroIA(
        "O modelo de IA configurado não está disponível para esta conta.",
        503,
      );
    }
    if (status === 400) {
      throw new ErroIA(`A IA não aceitou o material enviado: ${detalhe}`, 422);
    }
    if (status === 503) {
      throw new ErroIA("A IA esta sobrecarregada agora. Tente de novo em instantes.", 503);
    }
    throw new ErroIA("Não consegui falar com a IA agora. Tente de novo.");
  }

  if (!texto) {
    throw new ErroIA(
      "A IA não devolveu resposta para este material. Tente de novo ou preencha manualmente.",
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
