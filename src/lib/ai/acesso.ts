// Guarda das rotas /api/ia/*: so entra quem esta logado E e membro do idoso.
// A checagem de vinculo usa o proprio RLS (idoso so e visivel para membros),
// entao nao existe uma segunda regra de permissao para manter em sincronia.

import { createClient } from "@/lib/supabase/server";
import { ErroIA } from "@/lib/ai/comum";

export async function exigirMembro(idosoId: string | null | undefined) {
  if (!idosoId) throw new ErroIA("Idoso não informado.", 400);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new ErroIA("Você precisa estar logada.", 401);

  const { data: idoso } = await supabase
    .from("idoso")
    .select("id, nome")
    .eq("id", idosoId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!idoso) throw new ErroIA("Sem acesso a este idoso.", 403);

  return { supabase, user, idoso: idoso as { id: string; nome: string } };
}

export function respostaErro(e: unknown) {
  if (e instanceof ErroIA) {
    return Response.json({ erro: e.message }, { status: e.status });
  }
  // Erro que nao e da IA: sem isto a causa some e fica so o "500".
  console.error("[api] erro inesperado:", e);
  return Response.json(
    { erro: `Erro inesperado${e instanceof Error ? `: ${e.message}` : ""}` },
    { status: 500 },
  );
}

/** Limite do corpo de uma funcao na Vercel e ~4,5 MB; fico abaixo disso. */
export const LIMITE_BYTES = 4_000_000;
