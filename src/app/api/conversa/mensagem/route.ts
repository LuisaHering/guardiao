import type { NextRequest } from "next/server";
import { exigirMembro, respostaErro } from "@/lib/ai/acesso";
import { ErroIA } from "@/lib/ai/comum";
import { MARCA_ERRO } from "@/lib/chat-marca";
import { conversar, hojeBR, montarContexto, montarSystem, type TipoConversa, type Turno } from "@/lib/ai/chat";

// A resposta vem em pedacos; o limite cobre a resposta inteira, nao o primeiro pedaco.
export const maxDuration = 60;

const MAX_TEXTO = 2000;
const MAX_HISTORICO = 30;

export async function POST(req: NextRequest) {
  try {
    const corpo = await req.json().catch(() => null);
    const { supabase, user, idoso } = await exigirMembro(corpo?.idosoId);

    const tipo: TipoConversa = corpo?.tipo === "checkin_diario" ? "checkin_diario" : "livre";
    const texto = typeof corpo?.texto === "string" ? corpo.texto.trim() : "";
    if (texto.length > MAX_TEXTO) {
      throw new ErroIA(`A mensagem passou de ${MAX_TEXTO} caracteres. Divida em partes.`, 413);
    }

    // 1. Conversa: a informada, a do check-in de hoje (se ainda aberta) ou uma nova.
    let conversaId: string | null = typeof corpo?.conversaId === "string" ? corpo.conversaId : null;
    if (conversaId) {
      const { data } = await supabase
        .from("conversa")
        .select("id, tipo, status")
        .eq("id", conversaId)
        .eq("idoso_id", idoso.id)
        .maybeSingle();
      if (!data) throw new ErroIA("Conversa não encontrada.", 404);
      if (data.status === "concluida") throw new ErroIA("Esta conversa já foi encerrada.", 409);
    } else {
      if (tipo === "checkin_diario") {
        const { data } = await supabase
          .from("conversa")
          .select("id")
          .eq("idoso_id", idoso.id)
          .eq("tipo", "checkin_diario")
          .eq("data_referencia", hojeBR())
          .eq("status", "pendente")
          .order("created_at", { ascending: false })
          .limit(1);
        conversaId = data?.[0]?.id ?? null;
      }
      if (!conversaId) {
        const { data, error } = await supabase
          .from("conversa")
          .insert({
            idoso_id: idoso.id,
            iniciada_por: user.id,
            tipo,
            data_referencia: hojeBR(),
            status: "pendente",
          })
          .select("id")
          .single();
        if (error || !data) throw new ErroIA("Não consegui abrir a conversa.", 500);
        conversaId = data.id as string;
      }
    }

    // 2. A fala de quem escreveu entra com o autor (e so ele pode ser o autor).
    let mensagemId: string | null = null;
    if (texto) {
      const { data, error } = await supabase
        .from("mensagem")
        .insert({ conversa_id: conversaId, papel_emissor: "user", conteudo: texto, autor_id: user.id })
        .select("id")
        .single();
      if (error || !data) throw new ErroIA("Não consegui guardar a mensagem.", 500);
      mensagemId = data.id as string;
    }

    // 3. Historico (mais recentes) + contexto do idoso.
    const { data: recentes } = await supabase
      .from("mensagem")
      .select("papel_emissor, conteudo")
      .eq("conversa_id", conversaId)
      .order("created_at", { ascending: false })
      .limit(MAX_HISTORICO);
    const historico: Turno[] = (recentes ?? [])
      .reverse()
      .map((m) => ({ papel: m.papel_emissor as "user" | "assistant", texto: (m.conteudo as string) ?? "" }));

    const [{ data: eu }, { data: vinc }, contexto] = await Promise.all([
      supabase.from("usuario").select("nome").eq("id", user.id).maybeSingle(),
      supabase
        .from("vinculo")
        .select("papel")
        .eq("idoso_id", idoso.id)
        .eq("usuario_id", user.id)
        .is("deleted_at", null)
        .maybeSingle(),
      montarContexto(supabase, idoso.id, conversaId as string),
    ]);
    const system = montarSystem({
      tipo,
      contexto,
      quemFala: (eu?.nome as string) ?? "uma pessoa da rede",
      papel: (vinc?.papel as string) ?? "membro",
    });

    // 4. Resposta em fluxo; ao final, a fala da IA tambem fica guardada.
    const gerador = conversar(system, historico);
    const codificador = new TextEncoder();
    const cid = conversaId;
    const fluxo = new ReadableStream<Uint8Array>({
      async start(controle) {
        let completo = "";
        try {
          for await (const pedaco of gerador) {
            completo += pedaco;
            controle.enqueue(codificador.encode(pedaco));
          }
          if (!completo.trim()) throw new ErroIA("A IA não devolveu resposta. Tente de novo.", 422);
          await supabase
            .from("mensagem")
            .insert({ conversa_id: cid, papel_emissor: "assistant", conteudo: completo.trim() });
        } catch (e) {
          const msg = e instanceof ErroIA ? e.message : "A resposta foi interrompida. Tente de novo.";
          controle.enqueue(codificador.encode(`${MARCA_ERRO}${msg}`));
        }
        controle.close();
      },
    });

    return new Response(fluxo, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Conversa-Id": cid,
        "X-Mensagem-Id": mensagemId ?? "",
      },
    });
  } catch (e) {
    return respostaErro(e);
  }
}
