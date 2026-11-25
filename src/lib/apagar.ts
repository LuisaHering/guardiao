// Apagar o que foi enviado errado. A regra está no banco: antes de a família aceitar, apaga
// na hora; depois do aceite, vira um pedido que o administrador confirma.

import type { SupabaseClient } from "@supabase/supabase-js";
import { EVENTO_PEDIDOS } from "@/lib/pedidos-exame";
import { EVENTO_PEDIDOS_FAMILIA } from "@/lib/pedidos-familia";
import { EVENTO_REMEDIOS } from "@/lib/revisoes";

export type Previa = {
  /** o que sai ou volta, em frases prontas */
  efeitos: string[];
  /** a família já tinha aceitado: nada sai antes de o administrador confirmar */
  precisaConfirmar: boolean;
};

/** Disparado quando um envio é apagado ou tem a exclusão pedida. */
export const EVENTO_ENVIOS = "guardiao:envios";

/** Para as telas abertas se atualizarem: apagar um envio mexe em várias delas. */
export function avisarTelas() {
  for (const nome of [EVENTO_ENVIOS, EVENTO_PEDIDOS, EVENTO_PEDIDOS_FAMILIA, EVENTO_REMEDIOS, "guardiao:alertas"]) {
    window.dispatchEvent(new Event(nome));
  }
}

// O banco responde com frases prontas (código P0001); o resto é falha técnica.
const mensagem = (e: { code?: string; message: string }) =>
  e.code === "P0001" ? e.message : "Não consegui. Confira a internet e tente de novo.";

/** simular = só dizer o que vai acontecer. */
export async function apagarEnvio(
  supabase: SupabaseClient,
  documentoId: string,
  simular: boolean,
): Promise<Previa | { erro: string }> {
  const { data, error } = await supabase.rpc("apagar_envio", { p_documento: documentoId, p_simular: simular });
  if (error) return { erro: mensagem(error) };
  const r = data as { efeitos: string[]; precisa_confirmar: boolean };
  return { efeitos: r.efeitos, precisaConfirmar: r.precisa_confirmar };
}

export async function desistirExclusao(supabase: SupabaseClient, documentoId: string): Promise<string | null> {
  const { error } = await supabase.rpc("desistir_exclusao", { p_documento: documentoId });
  return error ? mensagem(error) : null;
}

export async function decidirExclusao(
  supabase: SupabaseClient,
  documentoId: string,
  confirmar: boolean,
): Promise<string | null> {
  const { error } = await supabase.rpc("decidir_exclusao", { p_documento: documentoId, p_confirmar: confirmar });
  return error ? mensagem(error) : null;
}

export type ExclusaoPedida = {
  id: string;
  nome: string;
  quem: string;
  arquivo: string;
  ehPdf: boolean;
};

/** O que está esperando o administrador confirmar. */
export async function carregarExclusoes(supabase: SupabaseClient, idosoId: string): Promise<ExclusaoPedida[]> {
  const { data } = await supabase
    .from("documento")
    .select("id, nome, arquivo_url, tipo, exclusao_pedida_por")
    .eq("idoso_id", idosoId)
    .not("exclusao_pedida_em", "is", null)
    .is("deleted_at", null)
    .order("exclusao_pedida_em");
  const docs = data ?? [];
  if (!docs.length) return [];
  const { data: us } = await supabase
    .from("usuario")
    .select("id, nome")
    .in("id", [...new Set(docs.map((d) => d.exclusao_pedida_por as string))]);
  return docs.map((d) => ({
    id: d.id as string,
    nome: d.nome as string,
    quem: ((us ?? []).find((u) => u.id === d.exclusao_pedida_por)?.nome as string) || "Alguém da rede",
    arquivo: d.arquivo_url as string,
    ehPdf: d.tipo === "application/pdf",
  }));
}
