import { createClient } from "@/lib/supabase/server";
import type { Membership, Role } from "@/lib/roles";

// Carrega o vínculo do usuário logado (papel + admin + idoso).
// MVP: assume um idoso por usuário; pega o primeiro vínculo ativo.
export async function getMembership(): Promise<Membership | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("vinculo")
    .select("papel, admin, idoso_id, idoso(nome, como_chamar)")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const idoso = data.idoso as unknown as { nome: string; como_chamar: string | null } | null;
  return {
    role: data.papel as Role,
    admin: data.admin as boolean,
    idosoId: data.idoso_id as string,
    idosoNome: idoso?.como_chamar?.trim() || idoso?.nome || "",
    idosoNomeCompleto: idoso?.nome ?? "",
  };
}
