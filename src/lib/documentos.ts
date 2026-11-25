// Envio de documentos (foto de um papel, no celular) e abertura por link temporário.

import type { SupabaseClient } from "@supabase/supabase-js";
import { reduzirParaIA } from "@/lib/imagem";
import { hojeBR } from "@/lib/medicacao";

export type TipoEnvio = "receita" | "pedido_exame" | "atestado" | "outro" | "resultado_exame";

export const TIPOS_ENVIO: { valor: TipoEnvio; rotulo: string }[] = [
  { valor: "receita", rotulo: "Receita" },
  { valor: "pedido_exame", rotulo: "Pedido de exame" },
  { valor: "resultado_exame", rotulo: "Resultado de exame" },
  { valor: "atestado", rotulo: "Atestado" },
  { valor: "outro", rotulo: "Outro papel" },
];

export const rotuloEnvio = (v: string | null) => TIPOS_ENVIO.find((t) => t.valor === v)?.rotulo ?? "Documento";

export const TIPOS_ACEITOS = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
export const LIMITE_DOCUMENTO = 15 * 1024 * 1024;

export function nomeSeguro(n: string) {
  return n.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80);
}

/** Foto grande é reduzida mantendo a leitura do papel; se o navegador não souber ler o formato, vai como veio. */
async function prepararFoto(arquivo: File): Promise<{ conteudo: Blob; tipo: string; nome: string }> {
  if (arquivo.type.startsWith("image/") && arquivo.size > 1_500_000) {
    try {
      const menor = await reduzirParaIA(arquivo, 2600, 0.88);
      if (menor.size < arquivo.size) {
        return { conteudo: menor, tipo: "image/jpeg", nome: arquivo.name.replace(/\.[^.]+$/, "") + ".jpg" };
      }
    } catch {
      // formato que o navegador não desenha (ex: HEIC): segue o original
    }
  }
  return { conteudo: arquivo, tipo: arquivo.type, nome: arquivo.name };
}

/** Envia a foto de um papel para a família. Devolve o documento criado, ou a mensagem de erro. */
export async function enviarPapel(
  supabase: SupabaseClient,
  idosoId: string,
  arquivo: File,
  envio: TipoEnvio,
): Promise<{ id: string } | { erro: string }> {
  if (!TIPOS_ACEITOS.includes(arquivo.type)) return { erro: "Esse tipo de arquivo não é aceito. Use uma foto ou um PDF." };
  const { conteudo, tipo, nome } = await prepararFoto(arquivo);
  if (conteudo.size > LIMITE_DOCUMENTO) return { erro: "A foto ficou grande demais. Tire de novo, mais de perto." };
  const { data: auth } = await supabase.auth.getUser();
  const caminho = `${idosoId}/${crypto.randomUUID()}-${nomeSeguro(nome || "foto.jpg")}`;
  const diaMes = hojeBR().split("-").reverse().slice(0, 2).join("/");

  // O registro vem antes: só quem o criou pode enviar o arquivo dele.
  const { data: linha, error } = await supabase
    .from("documento")
    .insert({
      idoso_id: idosoId,
      nome: `${rotuloEnvio(envio)} ${diaMes}`,
      arquivo_url: caminho,
      tipo,
      tamanho: conteudo.size,
      autor_id: auth.user?.id ?? null,
      envio,
    })
    .select("id")
    .single();
  if (error || !linha) return { erro: "Não consegui enviar. Confira a internet e tente de novo." };

  const subida = await supabase.storage.from("documentos").upload(caminho, conteudo, { contentType: tipo, upsert: false });
  if (subida.error) {
    await supabase.from("documento").update({ deleted_at: new Date().toISOString() }).eq("id", linha.id);
    return { erro: "O envio falhou. Confira a internet e tente de novo." };
  }
  return { id: linha.id as string };
}

/** Abre um arquivo privado por link temporário. Devolve a mensagem de erro, ou null. */
export async function abrirArquivo(supabase: SupabaseClient, bucket: string, caminho: string): Promise<string | null> {
  // A janela é aberta antes, no clique, para o navegador não bloquear.
  const janela = window.open("", "_blank");
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(caminho, 300);
  if (error || !data?.signedUrl) {
    janela?.close();
    return "Não consegui abrir este arquivo.";
  }
  if (janela) janela.location.href = data.signedUrl;
  else window.location.href = data.signedUrl;
  return null;
}
