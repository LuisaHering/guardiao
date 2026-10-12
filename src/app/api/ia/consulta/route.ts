import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exigirMembro, respostaErro } from "@/lib/ai/acesso";
import { ErroIA, REGRAS_BASE } from "@/lib/ai/comum";
import { extrair } from "@/lib/ai/ia";
import { ResumoConsultaSchema } from "@/lib/ai/schemas";

const LIMITE_TEXTO = 60_000;

// A IA pode levar quase um minuto; sem isso a Vercel corta a funcao em 10 s.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let consultaId: string | undefined;
  try {
    const corpo = await req.json().catch(() => null);
    consultaId = corpo?.consultaId;
    if (!consultaId) throw new ErroIA("Consulta nao informada.", 400);

    // Descobre o idoso pela consulta e valida o vinculo antes de qualquer gasto.
    const anon = await createClient();
    const { data: consulta } = await anon
      .from("consulta")
      .select("id, idoso_id, medico, especialidade, data, transcricao")
      .eq("id", consultaId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!consulta) throw new ErroIA("Consulta nao encontrada.", 404);

    const { supabase } = await exigirMembro(consulta.idoso_id);

    const texto = (consulta.transcricao ?? "").trim();
    if (texto.length < 40) {
      throw new ErroIA("Cole o texto da consulta antes de gerar o resumo.", 400);
    }
    if (texto.length > LIMITE_TEXTO) {
      throw new ErroIA("O texto passa do limite. Divida a consulta em partes.", 413);
    }

    await supabase
      .from("consulta")
      .update({ status_processamento: "processando" })
      .eq("id", consulta.id);

    try {
      const resumo = await extrair({
        system: `${REGRAS_BASE}
Voce resume consultas medicas a partir do texto da conversa. Nao sabe quem e cada pessoa que fala: so atribua uma fala ao medico quando o texto deixar claro.
Em "remedios", use "iniciar", "suspender", "ajustar" ou "manter" somente quando a decisao foi dita; se o remedio so foi citado, use "mencionado".
Se o texto nao tem conteudo de consulta, devolva listas vazias e diga isso no resumo.`,
        instrucao: `Resuma esta consulta${
          consulta.especialidade ? ` de ${consulta.especialidade}` : ""
        }. Use apenas o que esta no material.`,
        entrada: { tipo: "texto", texto },
        schema: ResumoConsultaSchema,
      });

      await supabase
        .from("consulta")
        .update({
          status_processamento: "concluido",
          resumo: resumo.resumo,
          resumo_json: resumo,
        })
        .eq("id", consulta.id);

      return Response.json({ resumo });
    } catch (e) {
      await supabase
        .from("consulta")
        .update({ status_processamento: "falhou" })
        .eq("id", consulta.id);
      throw e;
    }
  } catch (e) {
    return respostaErro(e);
  }
}
