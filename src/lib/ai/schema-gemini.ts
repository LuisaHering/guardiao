// Converte um schema zod no JSON Schema que o Gemini documenta aceitar.
// Arquivo separado e sem dependencia do resto do app para poder ser testado sozinho.

import { z } from "zod";

type Json = Record<string, unknown>;

/**
 * O Gemini documenta nulabilidade como `type: ["string", "null"]`, enquanto o zod
 * gera `anyOf: [{type: "string"}, {type: "null"}]`. Reescrevo para a forma
 * documentada e removo o `$schema`, que o servico nao precisa.
 */
export function adaptar(no: unknown): unknown {
  if (Array.isArray(no)) return no.map(adaptar);
  if (!no || typeof no !== "object") return no;

  const obj = { ...(no as Json) };
  delete obj.$schema;

  const alt = obj.anyOf;
  if (Array.isArray(alt) && alt.length === 2) {
    const nulo = alt.find((a) => (a as Json)?.type === "null");
    const outro = alt.find((a) => a !== nulo) as Json | undefined;
    if (nulo && outro && typeof outro.type === "string") {
      delete obj.anyOf;
      return adaptar({ ...obj, ...outro, type: [outro.type, "null"] });
    }
  }

  for (const k of Object.keys(obj)) obj[k] = adaptar(obj[k]);
  return obj;
}

export function schemaParaGemini(schema: z.ZodType): Json {
  return adaptar(z.toJSONSchema(schema)) as Json;
}
