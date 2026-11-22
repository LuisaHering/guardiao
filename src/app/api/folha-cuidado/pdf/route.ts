import type { NextRequest } from "next/server";
import { exigirMembro, respostaErro } from "@/lib/ai/acesso";
import { ErroIA } from "@/lib/ai/comum";
import { gerarPdfFolha, type ConteudoFolha } from "@/lib/folha-cuidado/pdf";

export const maxDuration = 30;

/** Monta o PDF a partir da última folha guardada: não chama a IA de novo. */
export async function POST(req: NextRequest) {
  try {
    const corpo = await req.json().catch(() => null);
    const { supabase, idoso } = await exigirMembro(corpo?.idosoId);

    const { data } = await supabase
      .from("folha_cuidado")
      .select("conteudo, gerado_em")
      .eq("idoso_id", idoso.id)
      .order("gerado_em", { ascending: false })
      .limit(1);
    const ultima = data?.[0];
    if (!ultima?.conteudo) throw new ErroIA("Ainda não há uma folha gerada.", 404);

    let conteudo: ConteudoFolha;
    try {
      conteudo = JSON.parse(ultima.conteudo as string) as ConteudoFolha;
    } catch {
      throw new ErroIA("A folha guardada está ilegível. Gere uma nova.", 500);
    }

    const pdf = await gerarPdfFolha(conteudo, new Date(ultima.gerado_em as string));
    return new Response(pdf as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="como-cuidar.pdf"',
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return respostaErro(e);
  }
}
