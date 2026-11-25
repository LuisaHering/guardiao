import { createClient } from "@/lib/supabase/server";
import type { Membership, Role } from "@/lib/roles";

// Carrega o vínculo do usuário logado (papel + admin + idoso).
// MVP: assume um idoso por usuário; pega o primeiro vínculo ativo.
// O filtro por usuario_id é indispensável: pela regra do banco, todo membro enxerga os
// vínculos da rede inteira. Sem ele, a pessoa recebia o papel de quem viesse primeiro.
export async function getMembership(): Promise<Membership | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("vinculo")
    .select("papel, admin, idoso_id, idoso(nome, como_chamar)")
    .eq("usuario_id", user.id)
    .is("deleted_at", null)
    .order("created_at")
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
