import type { NextRequest } from "next/server";
import { exigirMembro, LIMITE_BYTES, respostaErro } from "@/lib/ai/acesso";
import { ErroIA, REGRAS_BASE, type Entrada } from "@/lib/ai/comum";
import { extrair } from "@/lib/ai/ia";
import { ExameSchema } from "@/lib/ai/schemas";

const IMAGENS = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

type Analito = { id: string; nome_canonico: string; unidade_canonica: string | null };

// A IA pode levar quase um minuto; sem isso a Vercel corta a funcao em 10 s.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData().catch(() => null);
    if (!form) throw new ErroIA("Envio inválido.", 400);

    const idosoId = form.get("idosoId");
    const arquivo = form.get("arquivo");
    const { supabase } = await exigirMembro(typeof idosoId === "string" ? idosoId : null);

    if (!(arquivo instanceof File)) throw new ErroIA("Envie a foto ou o PDF do exame.", 400);
    if (arquivo.size > LIMITE_BYTES) {
      throw new ErroIA(
        "O arquivo passa de 4 MB. Envie fotos das páginas ou um PDF menor.",
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

    // Analitos que esta pessoa ja tem: a IA casa com eles em vez de criar duplicata.
    const { data } = await supabase
      .from("analito")
      .select("id, nome_canonico, unidade_canonica")
      .eq("idoso_id", idosoId as string)
      .is("fundido_em", null)
      .order("nome_canonico");
    const analitos = (data ?? []) as Analito[];

    const lista = analitos.length
      ? analitos
          .map((a) => `- id=${a.id} | ${a.nome_canonico} | unidade ${a.unidade_canonica ?? "?"}`)
          .join("\n")
      : "(nenhum ainda)";

    const exame = await extrair({
      system: `${REGRAS_BASE}
Voce le laudos de exames laboratoriais brasileiros e extrai cada resultado numerico.
- Um resultado = um analito com valor numerico. Ignore comentarios, interpretacoes e resultados sem numero (ex: "negativo").
- Copie o valor e a unidade exatamente como impressos. Nao converta unidades.
- ref_min e ref_max: a faixa de referencia IMPRESSA no laudo para aquele resultado. Se so ha um limite (ex: "< 200"), preencha so o que existe. Se nao ha faixa impressa, deixe os dois null. Nao use conhecimento proprio de faixas normais.
- Analitos ja conhecidos: se o resultado e o mesmo analito de um da lista (mesmo que o nome impresso seja um pouco diferente), devolva o id dele em analito_id. Se nao e claramente o mesmo, devolva analito_id null. Nunca invente um id.
- Se o documento esta ilegivel demais, marque legivel=false e devolva so o que leu com certeza.`,
      instrucao: `Analitos ja conhecidos desta pessoa:\n${lista}\n\nExtraia o tipo, o laboratorio, a data da coleta e os resultados deste exame.`,
      entrada,
      schema: ExameSchema,
      maxTokens: 24000,
    });

    // Defesa: descarta qualquer analito_id que nao esteja na lista real.
    const validos = new Set(analitos.map((a) => a.id));
    exame.resultados = exame.resultados.map((r) => ({
      ...r,
      analito_id: r.analito_id && validos.has(r.analito_id) ? r.analito_id : null,
    }));

    return Response.json({ exame, analitos });
  } catch (e) {
    return respostaErro(e);
  }
}
