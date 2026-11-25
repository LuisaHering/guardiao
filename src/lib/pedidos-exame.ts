// Pedidos de exame: situação de cada um e o que dá para fazer. As regras de quem pode o quê
// estão no banco; aqui é só o que a tela precisa para mostrar.

import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarPapel } from "@/lib/documentos";
import { diasEntre, hojeBR } from "@/lib/medicacao";

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
  /** desde quando falta marcar (recomeça num "não consegui") */
  falta_desde: string;
  created_at: string;
};

export const COLUNAS_PEDIDO =
  "id, exames, preparo, status, dia, hora, laboratorio, documento_id, resultado_documento_id, falta_desde, created_at";

/** Disparado quando um pedido muda, para as telas abertas se atualizarem. */
export const EVENTO_PEDIDOS = "guardiao:pedidos-exame";

const diaMes = (iso: string) => iso.split("-").reverse().slice(0, 2).join("/");

export type Tom = "perigo" | "alerta" | "normal" | "feito";

/** A partir daqui "falta marcar" fica em vermelho e o administrador é avisado (no banco). */
export const DIAS_PARA_COBRAR = 7;

export const diasSemMarcar = (p: Pick<PedidoExame, "falta_desde">) =>
  Math.max(0, diasEntre(hojeBR(new Date(p.falta_desde)), hojeBR()));

export function textoFaltaMarcar(p: Pick<PedidoExame, "falta_desde">): { texto: string; tom: Tom } {
  const dias = diasSemMarcar(p);
  return {
    texto: dias === 0 ? "Falta marcar" : `Falta marcar há ${dias} ${dias === 1 ? "dia" : "dias"}`,
    tom: dias >= DIAS_PARA_COBRAR ? "perigo" : "alerta",
  };
}

/** O que está parado num pedido e precisa de alguém. null = nada para resolver agora. */
export function pendenciaDo(p: PedidoExame): { titulo: string; detalhe: string; tom: Tom } | null {
  const nomes = p.exames.join(", ");
  if (p.status === "falta_marcar") {
    const f = textoFaltaMarcar(p);
    return { titulo: `Marcar exame: ${nomes}`, detalhe: f.texto, tom: f.tom };
  }
  if (p.status === "marcado" && !p.dia) {
    return { titulo: `Dizer o dia: ${nomes}`, detalhe: "Está marcado, falta o dia", tom: "alerta" };
  }
  if (p.status === "feito") {
    return { titulo: `Resultado: ${nomes}`, detalhe: "Feito, falta enviar o resultado", tom: "alerta" };
  }
  return null;
}

export function situacao(p: PedidoExame): { texto: string; tom: Tom } {
  if (p.status === "falta_marcar") return textoFaltaMarcar(p);
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

export type ResultadoLigado = { pedidoId: string } | { erro: string };

/** Liga um arquivo já enviado ao pedido dele, ou o registra sozinho. */
export async function ligarResultado(
  supabase: SupabaseClient,
  pedidoId: string | null,
  documentoId: string,
): Promise<ResultadoLigado> {
  if (pedidoId) {
    const r = await chamar(
      supabase,
      "entregar_resultado_exame",
      { p_pedido: pedidoId, p_documento: documentoId },
      "O arquivo chegou à família, mas não consegui ligar ao exame. Tente de novo.",
    );
    return r ?? { pedidoId };
  }
  const { data, error } = await supabase.rpc("registrar_resultado_avulso", { p_documento: documentoId });
  if (error) return { erro: "O arquivo chegou à família, mas não consegui colocar em Exames. Tente de novo." };
  window.dispatchEvent(new Event(EVENTO_PEDIDOS));
  return { pedidoId: data as string };
}

/** Envia a foto ou o PDF do resultado (com ou sem pedido). */
export async function enviarResultado(
  supabase: SupabaseClient,
  idosoId: string,
  pedidoId: string | null,
  arquivo: File,
): Promise<ResultadoLigado> {
  const enviado = await enviarPapel(supabase, idosoId, arquivo, "resultado_exame");
  if ("erro" in enviado) return enviado;
  return ligarResultado(supabase, pedidoId, enviado.id);
}
