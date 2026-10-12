import type { NextRequest } from "next/server";
import { exigirMembro, LIMITE_BYTES, respostaErro } from "@/lib/ai/acesso";
import { ErroIA, REGRAS_BASE, type Entrada } from "@/lib/ai/comum";
import { extrair } from "@/lib/ai/ia";
import { ReceitaSchema } from "@/lib/ai/schemas";

const IMAGENS = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

// A IA pode levar quase um minuto; sem isso a Vercel corta a funcao em 10 s.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData().catch(() => null);
    if (!form) throw new ErroIA("Envio inválido.", 400);

    const idosoId = form.get("idosoId");
    const arquivo = form.get("arquivo");
    await exigirMembro(typeof idosoId === "string" ? idosoId : null);

    if (!(arquivo instanceof File)) throw new ErroIA("Envie a foto ou o PDF da receita.", 400);
    if (arquivo.size > LIMITE_BYTES) {
      throw new ErroIA(
        "O arquivo passa de 4 MB. Tire a foto de novo ou envie só as páginas da receita.",
        413,
      );
    }

    const base64 = Buffer.from(await arquivo.arrayBuffer()).toString("base64");
    let entrada: Entrada;
    if (arquivo.type === "application/pdf") {
      entrada = { tipo: "pdf", base64 };
    } else if ((IMAGENS as readonly string[]).includes(arquivo.type)) {
      entrada = {
        tipo: "imagem",
        base64,
        mediaType: arquivo.type as (typeof IMAGENS)[number],
      };
    } else {
      throw new ErroIA("Formato não suportado. Use foto (JPG, PNG, WEBP) ou PDF.", 415);
    }

    const receita = await extrair({
      system: `${REGRAS_BASE}
Voce le receitas medicas brasileiras (impressas ou manuscritas) e lista os medicamentos prescritos.
- Copie nome, dosagem e posologia como estao escritos; nao troque por equivalente nem corrija "por bom senso".
- Se a letra ou a imagem nao permite ler um nome de remedio com seguranca, nao adivinhe: deixe o item de fora e marque legivel=false.
- Receita de varios medicamentos gera um item por medicamento.`,
        instrucao:
        "Extraia o medico, a data e os medicamentos desta receita.",
      entrada,
      schema: ReceitaSchema,
    });

    return Response.json({ receita });
  } catch (e) {
    return respostaErro(e);
  }
}
