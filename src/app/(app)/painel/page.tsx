import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMembership } from "@/lib/data/membership";
import { Dashboard } from "@/components/dashboard";
import { PrimeirosPassos } from "@/components/primeiros-passos";
import { HojeCuidadora } from "@/components/hoje-cuidadora";

export default async function PainelPage() {
  const membership = await getMembership();

  // Guarda de rota: sem vínculo, o caminho é criar o perfil do idoso.
  if (!membership) {
    redirect("/perfil");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: eu } = user
    ? await supabase.from("usuario").select("nome").eq("id", user.id).maybeSingle()
    : { data: null };
  const primeiro = ((eu?.nome as string | null) ?? "").trim().split(/\s+/)[0];

  // Quem cuida tem uma tela própria: o checklist do dia e botões grandes.
  if (membership.role === "cuidador") {
    return <HojeCuidadora primeiroNome={primeiro} />;
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">
          {primeiro ? `Olá, ${primeiro}!` : "Olá!"}
        </h1>
        <p className="text-sm text-subtle">
          {membership.role === "idoso"
            ? "Este é o seu espaço no Guardião."
            : `Você está cuidando de ${membership.idosoNome}.`}
        </p>
      </div>

      {membership.role === "idoso" && (
        <Link href="/familia" className="flex min-h-[80px] items-center justify-center rounded-2xl border-2 border-primary bg-card px-4 text-center text-xl font-semibold text-ink hover:bg-panel">
          Pedidos para os familiares
        </Link>
      )}

      <PrimeirosPassos />

      <Dashboard />
    </div>
  );
}
