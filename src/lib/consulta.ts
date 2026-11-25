// A consulta de hoje: gravar e contar no mesmo dia vão para o mesmo registro.

import type { SupabaseClient } from "@supabase/supabase-js";
import { hojeBR } from "@/lib/medicacao";

/** Disparado quando um áudio ou relato é guardado, para a tela se atualizar. */
export const EVENTO_CONSULTA = "guardiao:consulta";

export type ConsultaDoDia = {
  id: string;
  data: string | null;
  medico: string | null;
  especialidade: string | null;
  audio_url: string | null;
  transcricao: string | null;
  retorno_em: string | null;
};

export const COLUNAS_CONSULTA_DIA = "id, data, medico, especialidade, audio_url, transcricao, retorno_em";

/** A consulta mais recente de hoje, ou null. */
export async function consultaDeHoje(supabase: SupabaseClient, idosoId: string): Promise<ConsultaDoDia | null> {
  const { data, error } = await supabase
    .from("consulta")
    .select(COLUNAS_CONSULTA_DIA)
    .eq("idoso_id", idosoId)
    .is("deleted_at", null)
    .gte("data", `${hojeBR()}T00:00:00-03:00`)
    .lte("data", `${hojeBR()}T23:59:59-03:00`)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data?.[0] as ConsultaDoDia | undefined) ?? null);
}

export async function criarConsulta(
  supabase: SupabaseClient,
  idosoId: string,
  campos: Partial<Pick<ConsultaDoDia, "medico" | "especialidade" | "audio_url" | "transcricao">> = {},
): Promise<ConsultaDoDia> {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("consulta")
    .insert({
      idoso_id: idosoId,
      autor_id: auth.user?.id ?? null,
      data: new Date().toISOString(),
      status_processamento: "pendente",
      ...campos,
    })
    .select(COLUNAS_CONSULTA_DIA)
    .single();
  if (error || !data) throw new Error(error?.message ?? "sem retorno");
  return data as ConsultaDoDia;
}

/**
 * Guarda um áudio na consulta de hoje. Se ela já tem um áudio, a nova parte vira outro
 * registro com o mesmo médico: nenhuma gravação é sobrescrita.
 */
export async function guardarAudio(
  supabase: SupabaseClient,
  idosoId: string,
  audio: Blob,
  forcarNova: boolean,
): Promise<void> {
  const tipo = audio.type || "audio/webm";
  const ext = tipo.includes("mp4") ? "m4a" : tipo.includes("ogg") ? "ogg" : tipo.includes("mpeg") ? "mp3" : "webm";
  const caminho = `${idosoId}/${crypto.randomUUID()}.${ext}`;
  const envio = await supabase.storage.from("consultas").upload(caminho, audio, { upsert: false, contentType: tipo });
  if (envio.error) throw new Error(envio.error.message);

  const hoje = await consultaDeHoje(supabase, idosoId);
  if (hoje && !hoje.audio_url && !forcarNova) {
    const { error } = await supabase.from("consulta").update({ audio_url: caminho }).eq("id", hoje.id);
    if (error) throw new Error(error.message);
    return;
  }
  await criarConsulta(supabase, idosoId, {
    audio_url: caminho,
    medico: forcarNova ? null : (hoje?.medico ?? null),
    especialidade: forcarNova ? null : (hoje?.especialidade ?? null),
  });
}
