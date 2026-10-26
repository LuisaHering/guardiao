import type { NextRequest } from "next/server";
import { exigirMembro, respostaErro } from "@/lib/ai/acesso";
import { ErroIA } from "@/lib/ai/comum";
import {
  montarItens,
  quantasRespondidas,
  secoesMeta,
  VERSAO_QUESTIONARIO,
} from "@/lib/diretivas/questionario";
import { gerarPdfDiretiva } from "@/lib/diretivas/pdf";

export const maxDuration = 30;

/**
 * Gera uma diretiva: valida, monta o PDF, guarda o arquivo e registra a linha.
 *
 * Quem decide o que vai no documento é o SERVIDOR: as respostas são revalidadas
 * contra o questionário, o modo de preenchimento sai do vínculo de quem chama (o
 * cliente não escolhe) e a data é a do servidor. Isso mantém o PDF confiável.
 * As permissões de verdade ficam no banco (função gerar_diretiva); as checagens
 * daqui só devolvem mensagens mais claras antes de gastar o upload.
 */
export async function POST(req: NextRequest) {
  try {
    const corpo = await req.json().catch(() => null);
    const { supabase, user, idoso } = await exigirMembro(corpo?.idosoId);

    const { data: vinculo } = await supabase
      .from("vinculo")
      .select("papel, admin")
      .eq("idoso_id", idoso.id)
      .eq("usuario_id", user.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!vinculo) throw new ErroIA("Sem acesso a este idoso.", 403);
    if (!(vinculo.admin || vinculo.papel === "idoso")) {
      throw new ErroIA("Somente o titular ou um administrador pode gerar diretivas.", 403);
    }

    if (corpo.titularPresente !== true) {
      throw new ErroIA(
        "Marque que o titular estava presente durante o preenchimento.",
        400,
      );
    }

    const { data: consentimento } = await supabase
      .from("consentimento")
      .select("id")
      .eq("idoso_id", idoso.id)
      .is("revogado_em", null)
      .limit(1);
    if (!consentimento?.length) {
      throw new ErroIA(
        "O titular precisa registrar o consentimento (em Perfil do idoso) antes de gerar diretivas.",
        409,
      );
    }

    const montado = montarItens(corpo.respostas);
    if (montado.itens === null) throw new ErroIA(montado.erro, 400);
    if (quantasRespondidas(montado.itens) === 0) {
      throw new ErroIA("Responda ao menos uma pergunta antes de gerar.", 400);
    }

    const [{ data: ficha }, { data: eu }, { data: atuais }] = await Promise.all([
      supabase.from("idoso").select("nome, data_nascimento").eq("id", idoso.id).single(),
      supabase.from("usuario").select("nome").eq("id", user.id).single(),
      supabase
        .from("diretiva")
        .select("id, gerada_em")
        .eq("idoso_id", idoso.id)
        .eq("vigente", true)
        .order("gerada_em", { ascending: false })
        .limit(1),
    ]);
    if (!ficha) throw new ErroIA("Não encontrei o perfil do idoso.", 404);
    const anterior = atuais?.[0] ?? null;

    const modo = vinculo.papel === "idoso" ? "titular" : "assistido";
    const id = crypto.randomUUID();
    const geradaEm = new Date();

    const pdf = await gerarPdfDiretiva({
      id,
      geradaEm,
      titular: { nome: ficha.nome, dataNascimento: ficha.data_nascimento },
      modo,
      assistente:
        modo === "assistido"
          ? {
              nome: eu?.nome || "Pessoa não identificada",
              papel: vinculo.papel as "familiar" | "cuidador" | "idoso",
              admin: vinculo.admin,
            }
          : null,
      versaoQuestionario: VERSAO_QUESTIONARIO,
      secoes: secoesMeta(),
      itens: montado.itens,
      substitui: anterior ? { geradaEm: new Date(anterior.gerada_em) } : null,
    });

    const caminho = `${idoso.id}/${id}.pdf`;
    const { error: erroUpload } = await supabase.storage
      .from("diretivas")
      .upload(caminho, pdf, { contentType: "application/pdf", upsert: false });
    if (erroUpload) {
      throw new ErroIA(`Não consegui guardar o PDF: ${erroUpload.message}`, 500);
    }

    const { error: erroRpc } = await supabase.rpc("gerar_diretiva", {
      p_id: id,
      p_idoso: idoso.id,
      p_respostas: { itens: montado.itens, secoes: secoesMeta() },
      p_versao: VERSAO_QUESTIONARIO,
      p_titular_presente: true,
      p_gerada_em: geradaEm.toISOString(),
      p_pdf_url: caminho,
      p_substitui: anterior?.id ?? null,
    });
    if (erroRpc) throw new ErroIA(erroRpc.message, 409);

    return Response.json({ id });
  } catch (e) {
    return respostaErro(e);
  }
}
