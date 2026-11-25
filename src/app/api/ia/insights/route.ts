import type { NextRequest } from "next/server";
import { exigirMembro, respostaErro } from "@/lib/ai/acesso";
import { ErroIA, REGRAS_BASE } from "@/lib/ai/comum";
import { extrair } from "@/lib/ai/ia";
import { InsightsSchema } from "@/lib/ai/schemas";

const PERIODOS = [30, 60, 90];
// Com menos registros que isso, qualquer "padrao" seria ruido: nem chamo a IA.
const MINIMO_REGISTROS = 8;

const dia = (iso: string) => iso.slice(0, 10);

// A IA pode levar quase um minuto; sem isso a Vercel corta a funcao em 10 s.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const corpo = await req.json().catch(() => null);
    const periodo: number = PERIODOS.includes(corpo?.periodoDias) ? corpo.periodoDias : 60;
    const { supabase, user } = await exigirMembro(corpo?.idosoId);
    const idosoId: string = corpo.idosoId;

    const desde = new Date(Date.now() - periodo * 86_400_000).toISOString();
    const desdeDia = dia(desde);

    const [{ data: sint }, { data: diar }, { data: meds }] = await Promise.all([
      supabase
        .from("sintoma")
        .select("data, descricao, gravidade, duracao_declarada, resolvido_em")
        .eq("idoso_id", idosoId)
        .is("deleted_at", null)
        .gte("data", desde)
        .order("data")
        .limit(200),
      supabase
        .from("entrada_diario")
        .select("data, alimentacao, ocorrencias, sono")
        .eq("idoso_id", idosoId)
        .is("deleted_at", null)
        .gte("data", desde)
        .order("data")
        .limit(200),
      supabase
        .from("medicacao")
        .select("id, nome")
        .eq("idoso_id", idosoId)
        .is("deleted_at", null),
    ]);

    const nomes = new Map((meds ?? []).map((m) => [m.id as string, m.nome as string]));
    let regs: { data: string; medicacao_id: string; status: string; motivo: string | null; horario: string }[] = [];
    if (nomes.size > 0) {
      const { data } = await supabase
        .from("registro_medicacao")
        .select("data, medicacao_id, status, motivo, horario")
        .in("medicacao_id", [...nomes.keys()])
        .is("deleted_at", null)
        .gte("data", desdeDia)
        .order("data")
        .limit(400);
      regs = (data ?? []) as typeof regs;
    }

    const base = {
      sintomas: sint?.length ?? 0,
      diario: diar?.length ?? 0,
      registros_medicacao: regs.length,
    };
    const total = base.sintomas + base.diario + base.registros_medicacao;

    let itens: { titulo: string; observacao: string; evidencias: string[]; confianca: string }[] = [];
    let suficiente = total >= MINIMO_REGISTROS;

    if (suficiente) {
      const datas = new Set<string>();
      const linhas: string[] = [];

      linhas.push("## Sintomas");
      for (const s of sint ?? []) {
        datas.add(dia(s.data));
        linhas.push(
          `${dia(s.data)} | gravidade ${s.gravidade ?? "?"}/5 | ${s.duracao_declarada ?? "duracao nao informada"} | ${s.descricao}${s.resolvido_em ? ` | RESOLVIDO em ${dia(s.resolvido_em)}` : ""}`,
        );
      }
      linhas.push("", "## Diario do cuidador");
      for (const d of diar ?? []) {
        datas.add(dia(d.data));
        linhas.push(
          `${dia(d.data)} | alimentacao: ${d.alimentacao ?? "-"} | sono: ${d.sono ?? "-"} | ocorrencias: ${d.ocorrencias ?? "-"}`,
        );
      }
      linhas.push("", "## Registro de medicacao (so existe linha quando alguem registrou)");
      for (const r of regs) {
        datas.add(r.data);
        linhas.push(
          `${r.data}${r.horario ? ` ${r.horario}` : ""} | ${nomes.get(r.medicacao_id) ?? "remedio"} | ${r.status === "dada" ? "dada" : `nao dada (${r.motivo ?? "sem motivo"})`}`,
        );
      }

      const out = await extrair({
        system: `${REGRAS_BASE}
Voce procura recorrencias e relacoes entre registros do dia a dia (sintomas, diario do cuidador e medicacao) para a familia levar ao medico.
- Descreva o que os registros mostram, sem afirmar causa. Use "coincide com", "aparece mais em", nunca "causa".
- Nao diagnostique, nao sugira trocar, parar ou ajustar remedio, nao estime gravidade clinica.
- Cada observacao precisa de evidencias concretas: cite as datas (AAAA-MM-DD) e o que foi registrado nelas.
- Ausencia de registro de medicacao nao significa que a dose nao foi dada: so que ninguem registrou.
- Prefira poucas observacoes solidas a muitas fracas. Se nao ha nada que se sustente, devolva suficiente=false e itens vazio.
- Nao use nenhum dado externo nem conhecimento sobre o que seria "normal".`,
        instrucao: `Registros dos ultimos ${periodo} dias:\n\n${linhas.join("\n")}\n\nO que se repete ou parece relacionado nesses registros?`,
        schema: InsightsSchema,
      });

      suficiente = out.suficiente;
      // Defesa contra evidencia inventada: so fica o item cuja evidencia cita
      // uma data que realmente existe nos registros enviados.
      itens = out.itens.filter((i) =>
        i.evidencias.some((e) => (e.match(/\d{4}-\d{2}-\d{2}/g) ?? []).some((d) => datas.has(d))),
      );
      if (itens.length === 0) suficiente = false;
    }

    const { data: salvo } = await supabase
      .from("insight")
      .insert({
        idoso_id: idosoId,
        periodo_dias: periodo,
        itens: { suficiente, itens },
        base,
        gerado_por: user.id,
      })
      .select("id, gerado_em")
      .single();

    return Response.json({ suficiente, itens, base, periodoDias: periodo, geradoEm: salvo?.gerado_em ?? null });
  } catch (e) {
    return respostaErro(e);
  }
}
