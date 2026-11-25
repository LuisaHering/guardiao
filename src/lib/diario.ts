// Diário e foto do dia. Uma entrada só com foto não é um relato: não conta como
// "contar como foi o dia" e não é enviada à IA.

import type { SupabaseClient } from "@supabase/supabase-js";
import { reduzirParaIA } from "@/lib/imagem";

/** Filtro para `.or()`: só entradas com algum texto sobre o dia. A legenda não conta. */
export const FILTRO_RELATO = "alimentacao.not.is.null,sono.not.is.null,ocorrencias.not.is.null";

export const LIMITE_LEGENDA = 200;

/**
 * Redesenha a foto em um JPEG menor. Além de economizar espaço, isso descarta os
 * metadados do arquivo da câmera, como o local onde a foto foi tirada.
 * Devolve null se o navegador não conseguir ler a imagem.
 */
export async function prepararFotoDoDia(arquivo: File): Promise<Blob | null> {
  if (!arquivo.type.startsWith("image/")) return null;
  try {
    const pronta = await reduzirParaIA(arquivo, 1600, 0.85);
    return pronta === arquivo ? null : pronta;
  } catch {
    return null;
  }
}

/** Sobe a foto para o armazenamento privado do diário. Devolve o caminho, ou null se falhar. */
export async function subirFotoDoDia(supabase: SupabaseClient, idosoId: string, foto: Blob): Promise<string | null> {
  const caminho = `${idosoId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from("diario").upload(caminho, foto, { contentType: "image/jpeg", upsert: false });
  return error ? null : caminho;
}

/** Links temporários das fotos, na ordem pedida (o bucket é privado). */
export async function linksDasFotos(supabase: SupabaseClient, caminhos: string[]): Promise<Record<string, string>> {
  if (caminhos.length === 0) return {};
  const { data } = await supabase.storage.from("diario").createSignedUrls(caminhos, 3600);
  const mapa: Record<string, string> = {};
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) mapa[item.path] = item.signedUrl;
  }
  return mapa;
}
