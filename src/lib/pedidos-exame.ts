// Pedidos de exame: situação de cada um e o que dá para fazer. As regras de quem pode o quê
// estão no banco; aqui é só o que a tela precisa para mostrar.

import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarPapel } from "@/lib/documentos";

export type SituacaoPedido = "falta_marcar" | "marcado" | "feito" | "resultado_enviado" | "concluido" | "cancelado";

export type PedidoExame = {
  id: string;
  exames: string[];
  preparo: string | null;
  status: SituacaoPedido;
  /** "marcado" sem dia = "já está marcado" */
  dia: string | null;
  hora: string | null;
  laboratorio: string | null;
  documento_id: string | null;
  resultado_documento_id: string | null;
  created_at: string;
};

export const COLUNAS_PEDIDO =
  "id, exames, preparo, status, dia, hora, laboratorio, documento_id, resultado_documento_id, created_at";

/** Disparado quando um pedido muda, para as telas abertas se atualizarem. */
export const EVENTO_PEDIDOS = "guardiao:pedidos-exame";

const diaMes = (iso: string) => iso.split("-").reverse().slice(0, 2).join("/");

export type Tom = "perigo" | "alerta" | "normal" | "feito";

export function situacao(p: PedidoExame): { texto: string; tom: Tom } {
  if (p.status === "falta_marcar") return { texto: "Falta marcar", tom: "perigo" };
  if (p.status === "marcado") {
    return p.dia
      ? { texto: `Marcado para ${diaMes(p.dia)}${p.hora ? ` às ${p.hora}` : ""}`, tom: "normal" }
      : { texto: "Já está marcado, sem o dia", tom: "alerta" };
  }
  if (p.status === "feito") return { texto: "Feito, falta o resultado", tom: "alerta" };
  if (p.status === "resultado_enviado") return { texto: "Resultado enviado", tom: "feito" };
  if (p.status === "concluido") return { texto: "Concluído", tom: "feito" };
  return { texto: "Cancelado", tom: "normal" };
}

const ORDEM: Record<SituacaoPedido, number> = {
  falta_marcar: 0,
  marcado: 1,
  feito: 2,
  resultado_enviado: 3,
  concluido: 4,
  cancelado: 5,
};

export const ordenarPedidos = (l: PedidoExame[]) =>
  [...l].sort(
    (a, b) =>
      ORDEM[a.status] - ORDEM[b.status] ||
      (a.dia ?? "9999").localeCompare(b.dia ?? "9999") ||
      a.created_at.localeCompare(b.created_at),
  );

const falhou = (texto: string) => ({ erro: texto });

async function chamar(supabase: SupabaseClient, funcao: string, args: Record<string, unknown>, mensagem: string) {
  const { error } = await supabase.rpc(funcao, args);
  if (error) return falhou(mensagem);
  window.dispatchEvent(new Event(EVENTO_PEDIDOS));
  return null;
}

export const marcarExame = (
  supabase: SupabaseClient,
  id: string,
  dia: string | null,
  hora = "",
  laboratorio = "",
) =>
  chamar(
    supabase,
    "marcar_exame",
    { p_pedido: id, p_dia: dia, p_hora: hora || null, p_laboratorio: laboratorio || null },
    "Não consegui marcar. Confira a internet e tente de novo.",
  );

export const exameFeito = (supabase: SupabaseClient, id: string) =>
  chamar(supabase, "exame_feito", { p_pedido: id }, "Não consegui guardar. Tente de novo.");

export const encerrarExame = (supabase: SupabaseClient, id: string, cancelar = false) =>
  chamar(supabase, "encerrar_exame", { p_pedido: id, p_cancelar: cancelar }, "Não consegui encerrar este pedido.");

/** Envia a foto ou o PDF do resultado e liga ao pedido. Devolve a mensagem de erro, ou null. */
export async function enviarResultado(
  supabase: SupabaseClient,
  idosoId: string,
  pedidoId: string,
  arquivo: File,
): Promise<string | null> {
  const enviado = await enviarPapel(supabase, idosoId, arquivo, "resultado_exame");
  if ("erro" in enviado) return enviado.erro;
  const r = await chamar(
    supabase,
    "entregar_resultado_exame",
    { p_pedido: pedidoId, p_documento: enviado.id },
    "O arquivo chegou à família, mas não consegui ligar ao pedido. Tente de novo.",
  );
  return r?.erro ?? null;
}
