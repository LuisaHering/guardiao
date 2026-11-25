// O que o administrador tem para revisar: remédios novos, mudanças e suspensões feitas
// por outras pessoas. Tudo já está valendo; revisar é aprovar ou negar (desfazer).
// Usado pelo pop-up e pela tela de Medicação.

import type { SupabaseClient } from "@supabase/supabase-js";
import { COLUNAS_REMEDIO, descreverAgenda, type Remedio } from "@/lib/medicacao";

/** Disparado quando uma revisão é decidida, para as telas abertas se atualizarem. */
export const EVENTO_REMEDIOS = "guardiao:remedios";

export type Revisao = {
  /** chave única na lista */
  chave: string;
  tipo: "novo" | "alterar" | "suspender";
  /** id do pedido (mudança ou suspensão) */
  pedidoId: string | null;
  /** como o remédio está agora */
  remedio: Remedio;
  quem: string;
  motivo: string | null;
  /** o que mudou, em frases ("Dosagem: 10 mg → 20 mg") */
  mudancas: string[];
  /** como volta a ficar se for negado (mudança) */
  voltaPara: string | null;
};

export function descreverMudancas(antes: Partial<Remedio>, agora: Remedio): string[] {
  const linhas: string[] = [];
  const texto = (rotulo: string, a: string | null | undefined, b: string | null) => {
    if ((a ?? "") !== (b ?? "")) linhas.push(`${rotulo}: ${a || "vazio"} → ${b || "vazio"}`);
  };
  texto("Nome", antes.nome, agora.nome);
  texto("Dosagem", antes.dosagem, agora.dosagem);
  texto("Instruções", antes.instrucoes, agora.instrucoes);
  const agendaAntes = descreverAgenda({ ...agora, ...antes } as Remedio);
  const agendaAgora = descreverAgenda(agora);
  if (agendaAntes !== agendaAgora) linhas.push(`Quando: ${agendaAntes} → ${agendaAgora}`);
  if (antes.inicio && antes.inicio !== agora.inicio) linhas.push("Data de início alterada");
  return linhas;
}

type Pedido = {
  id: string;
  medicacao_id: string;
  tipo: "alterar" | "suspender";
  antes: Partial<Remedio> | null;
  motivo: string | null;
  pedido_por: string;
};

export async function carregarRevisoes(supabase: SupabaseClient, idosoId: string): Promise<Revisao[]> {
  const [{ data: ns }, { data: ps }] = await Promise.all([
    supabase
      .from("medicacao")
      .select(COLUNAS_REMEDIO)
      .eq("idoso_id", idosoId)
      .eq("confirmado", false)
      .eq("ativo", true)
      .is("deleted_at", null)
      .order("created_at"),
    supabase
      .from("medicacao_pedido")
      .select("id, medicacao_id, tipo, antes, motivo, pedido_por")
      .eq("idoso_id", idosoId)
      .eq("status", "pendente")
      .order("pedido_em"),
  ]);
  const novos = (ns ?? []) as unknown as Remedio[];
  const pedidos = (ps ?? []) as unknown as Pedido[];

  // Os remédios das revisões são buscados sem filtrar por ativo: um suspenso continua aqui.
  const idsMed = pedidos.map((p) => p.medicacao_id);
  const { data: ms } = idsMed.length
    ? await supabase.from("medicacao").select(COLUNAS_REMEDIO).in("id", idsMed)
    : { data: [] };
  const porId = new Map(((ms ?? []) as unknown as Remedio[]).map((m) => [m.id, m]));

  const autores = [...new Set([...novos.map((n) => n.autor_id), ...pedidos.map((p) => p.pedido_por)].filter(Boolean))] as string[];
  const { data: us } = autores.length ? await supabase.from("usuario").select("id, nome").in("id", autores) : { data: [] };
  const nomes = new Map((us ?? []).map((u) => [u.id as string, (u.nome as string) || "Alguém da rede"]));
  const quem = (id: string | null) => (id ? nomes.get(id) ?? "Alguém da rede" : "Alguém da rede");

  const lista: Revisao[] = [];
  for (const p of pedidos) {
    const remedio = porId.get(p.medicacao_id);
    if (!remedio) continue;
    const antes = p.antes ?? {};
    const mudancas = descreverMudancas(antes, remedio);
    lista.push({
      chave: `pedido:${p.id}`,
      tipo: p.tipo,
      pedidoId: p.id,
      remedio,
      quem: quem(p.pedido_por),
      motivo: p.motivo,
      mudancas,
      voltaPara:
        p.tipo === "alterar"
          ? [
              [antes.nome, antes.dosagem].filter(Boolean).join(" "),
              descreverAgenda({ ...remedio, ...antes } as Remedio),
            ].join(" · ")
          : null,
    });
  }
  for (const n of novos) {
    lista.push({
      chave: `novo:${n.id}`,
      tipo: "novo",
      pedidoId: null,
      remedio: n,
      quem: quem(n.autor_id),
      motivo: null,
      mudancas: [],
      voltaPara: null,
    });
  }
  return lista;
}

/** Devolve a mensagem de erro, ou null se deu certo. */
export async function decidirRevisao(supabase: SupabaseClient, r: Revisao, aprovar: boolean): Promise<string | null> {
  const { error } = r.pedidoId
    ? await supabase.rpc("decidir_pedido_medicacao", { p_pedido: r.pedidoId, p_aprovar: aprovar })
    : await supabase
        .from("medicacao")
        .update(aprovar ? { confirmado: true } : { ativo: false, recusado_em: new Date().toISOString() })
        .eq("id", r.remedio.id);
  return error ? error.message : null;
}

/** O que acontece se negar, em uma frase, para a pessoa decidir sabendo. */
export function efeitoDeNegar(r: Revisao): string {
  if (r.tipo === "novo") return `${r.remedio.nome} sai da lista, e quem cuida é avisado para não dar de novo.`;
  if (r.tipo === "suspender") return `${r.remedio.nome} volta para a lista de hoje, e quem cuida é avisado.`;
  return `Volta a ser: ${r.voltaPara}. Quem cuida é avisado.`;
}
