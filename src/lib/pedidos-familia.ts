// Pedidos para os familiares: atalhos, leitura e ações. Quem pode o quê é regra do banco.

import type { SupabaseClient } from "@supabase/supabase-js";

export type TipoAtalho = "remedio" | "compra" | "ajuda" | "ligar" | "outro";
export type TipoPedido = TipoAtalho | "conferir_exame";

export const ATALHOS: { tipo: TipoAtalho; rotulo: string; pergunta: string }[] = [
  { tipo: "remedio", rotulo: "Está acabando um remédio", pergunta: "Qual remédio?" },
  { tipo: "compra", rotulo: "Preciso que comprem algo", pergunta: "O que precisa comprar?" },
  { tipo: "ajuda", rotulo: "Preciso de ajuda aqui", pergunta: "Que ajuda?" },
  { tipo: "ligar", rotulo: "Me liguem, por favor", pergunta: "Quer dizer o assunto?" },
  { tipo: "outro", rotulo: "Outra coisa", pergunta: "O que você precisa?" },
];

export type PedidoFamilia = {
  id: string;
  autor_id: string;
  tipo: TipoPedido;
  detalhe: string | null;
  destinatario_id: string | null;
  urgente: boolean;
  status: "aberto" | "assumido" | "feito" | "cancelado";
  assumido_por: string | null;
  feito_por: string | null;
  pedido_exame_id: string | null;
  pedido_exame: { exames: string[]; resultado_documento_id: string | null } | null;
  created_at: string;
};

export function frasePedido(p: { tipo: TipoPedido; detalhe: string | null; pedido_exame?: PedidoFamilia["pedido_exame"] }): string {
  if (p.tipo === "conferir_exame") {
    const qual = p.pedido_exame?.exames.join(", ");
    return `Conferir os valores de um exame${qual ? `: ${qual}` : ""}${p.detalhe ? `. ${p.detalhe}` : ""}`;
  }
  const base = p.tipo === "outro" ? "Pedido" : (ATALHOS.find((a) => a.tipo === p.tipo)?.rotulo ?? "Pedido");
  return p.detalhe?.trim() ? `${base}: ${p.detalhe.trim()}` : base;
}

export const EVENTO_PEDIDOS_FAMILIA = "guardiao:pedidos-familia";

export async function carregarPedidos(supabase: SupabaseClient, idosoId: string) {
  const [{ data, error }, { data: auth }] = await Promise.all([
    supabase
      .from("pedido_familia")
      .select(
        "id, autor_id, tipo, detalhe, destinatario_id, urgente, status, assumido_por, feito_por, pedido_exame_id, pedido_exame(exames, resultado_documento_id), created_at",
      )
      .eq("idoso_id", idosoId)
      .neq("status", "cancelado")
      .order("created_at", { ascending: false })
      .limit(40),
    supabase.auth.getUser(),
  ]);
  if (error) return null;
  const pedidos = (data ?? []) as unknown as PedidoFamilia[];
  const ids = [
    ...new Set(pedidos.flatMap((p) => [p.autor_id, p.destinatario_id, p.assumido_por, p.feito_por]).filter(Boolean)),
  ] as string[];
  const { data: us } = ids.length ? await supabase.from("usuario").select("id, nome").in("id", ids) : { data: [] };
  return {
    pedidos,
    nomes: Object.fromEntries((us ?? []).map((u) => [u.id as string, primeiroNome(u.nome as string | null)])),
    eu: auth.user?.id ?? "",
  };
}

const primeiroNome = (nome: string | null) => (nome ?? "").trim().split(/\s+/)[0] ?? "";

export type Familiar = { id: string; nome: string };

/** Quem está cadastrado como familiar, menos a própria pessoa. */
export async function familiares(supabase: SupabaseClient, idosoId: string): Promise<Familiar[]> {
  const [{ data: vs }, { data: auth }] = await Promise.all([
    supabase.from("vinculo").select("usuario_id").eq("idoso_id", idosoId).eq("papel", "familiar").is("deleted_at", null),
    supabase.auth.getUser(),
  ]);
  const ids = (vs ?? []).map((v) => v.usuario_id as string).filter((id) => id !== auth.user?.id);
  if (!ids.length) return [];
  const { data: us } = await supabase.from("usuario").select("id, nome").in("id", ids);
  return (us ?? []).map((u) => ({ id: u.id as string, nome: (u.nome as string) || "Familiar" }));
}

export async function criarPedido(
  supabase: SupabaseClient,
  idosoId: string,
  p: { tipo: TipoPedido; detalhe?: string; destinatario: string | null; urgente?: boolean; pedidoExame?: string },
): Promise<string | null> {
  const { error } = await supabase.rpc("criar_pedido_familia", {
    p_idoso: idosoId,
    p_tipo: p.tipo,
    p_detalhe: p.detalhe?.trim() || null,
    p_destinatario: p.destinatario,
    p_urgente: !!p.urgente,
    p_pedido_exame: p.pedidoExame ?? null,
  });
  if (error) {
    return error.message.includes("já foi pedido")
      ? "Alguém já foi chamado para conferir este exame."
      : "Não consegui enviar. Confira a internet e tente de novo.";
  }
  window.dispatchEvent(new Event(EVENTO_PEDIDOS_FAMILIA));
  return null;
}

/** Quem pediu apaga em qualquer situação. */
export async function apagarPedido(supabase: SupabaseClient, id: string): Promise<string | null> {
  const { error } = await supabase.rpc("apagar_pedido_familia", { p_pedido: id });
  window.dispatchEvent(new Event(EVENTO_PEDIDOS_FAMILIA));
  return error ? "Não consegui apagar. Confira a internet e tente de novo." : null;
}

export async function mudarPedido(
  supabase: SupabaseClient,
  id: string,
  acao: "assumir" | "largar" | "concluir",
): Promise<string | null> {
  const { error } = await supabase.rpc("mudar_pedido_familia", { p_pedido: id, p_acao: acao });
  window.dispatchEvent(new Event(EVENTO_PEDIDOS_FAMILIA));
  return error ? "Não deu certo. Alguém pode ter respondido antes: confira a lista." : null;
}
