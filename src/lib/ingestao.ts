// Camada de ingestao: ponto unico por onde um registro entra no sistema vindo de fora
// da digitacao (hoje, a conversa; amanha, qualquer outra fonte). Marca sempre a origem,
// quem afirmou e a fala de onde saiu, para a tela poder mostrar e corrigir a origem.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Proposta } from "@/lib/propostas";

const MOTIVOS: Record<string, string> = {
  esqueceu: "esqueceu",
  recusou: "recusou",
  efeito_adverso: "efeito adverso",
  acabou: "o remédio acabou",
  outro: "outro motivo",
};
export const rotuloMotivo = (m: string) => MOTIVOS[m] ?? m;

export async function gravarProposta(
  supabase: SupabaseClient,
  idosoId: string,
  p: Proposta,
  textoEditado?: Partial<Record<string, string>>,
): Promise<{ ok: boolean; erro?: string }> {
  const origem = {
    origem: "conversa",
    origem_mensagem_id: p.mensagemId,
    confirmado: true,
  };
  const d = p.dados;
  const t = (campo: string, original: string | null) =>
    (textoEditado?.[campo] ?? original ?? "").trim() || null;

  let erro: { message: string } | null = null;
  if (d.tipo === "preferencia") {
    ({ error: erro } = await supabase.from("preferencia").insert({
      idoso_id: idosoId,
      autor_id: p.autorId,
      categoria: d.categoria,
      chave: t("chave", d.chave),
      valor: t("valor", d.valor),
      ...origem,
    }));
  } else if (d.tipo === "memoria") {
    ({ error: erro } = await supabase.from("memoria").insert({
      idoso_id: idosoId,
      autor_id: p.autorId,
      titulo: t("titulo", d.titulo),
      conteudo: t("conteudo", d.conteudo),
      ...origem,
    }));
  } else if (d.tipo === "humor") {
    ({ error: erro } = await supabase.from("humor").insert({
      idoso_id: idosoId,
      autor_id: p.autorId,
      humor: t("valor", d.valor),
      ...origem,
    }));
  } else if (d.tipo === "diario") {
    ({ error: erro } = await supabase.from("entrada_diario").insert({
      idoso_id: idosoId,
      autor_id: p.autorId,
      alimentacao: t("alimentacao", d.alimentacao),
      sono: t("sono", d.sono),
      ocorrencias: t("ocorrencias", d.ocorrencias),
      ...origem,
    }));
  } else if (d.tipo === "sintoma") {
    ({ error: erro } = await supabase.from("sintoma").insert({
      idoso_id: idosoId,
      autor_id: p.autorId,
      descricao: t("descricao", d.descricao),
      gravidade: d.gravidade,
      ...origem,
    }));
  } else if (d.tipo === "sintoma_resolvido") {
    // Nao apaga nada: marca o sintoma como resolvido e guarda quem disse e a fala.
    ({ error: erro } = await supabase
      .from("sintoma")
      .update({
        resolvido_em: new Date().toISOString(),
        resolvido_por: p.autorId,
        resolvido_mensagem_id: p.mensagemId,
      })
      .eq("id", d.sintomaId));
  } else if (d.tipo === "medicacao") {
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    ({ error: erro } = await supabase.from("registro_medicacao").upsert(
      {
        medicacao_id: d.medicacaoId,
        data: hoje,
        status: "dada",
        motivo: null,
        registrado_por: p.autorId,
        origem_mensagem_id: p.mensagemId,
      },
      { onConflict: "medicacao_id,data" },
    ));
  } else {
    // A pauta nao guarda autor; a fala de origem ja diz quem falou.
    ({ error: erro } = await supabase.from("item_pauta").insert({
      idoso_id: idosoId,
      titulo: t("titulo", d.titulo),
      detalhe: t("detalhe", d.detalhe),
      origem_mensagem_id: p.mensagemId,
    }));
  }
  return erro ? { ok: false, erro: erro.message } : { ok: true };
}
