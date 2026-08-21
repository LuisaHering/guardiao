import { redirect } from "next/navigation";
import Link from "next/link";
import { getMembership } from "@/lib/data/membership";
import { Card } from "@/components/ui";

export default async function PainelPage() {
  const membership = await getMembership();

  // Guarda de rota: sem vínculo, o caminho é criar o perfil do idoso.
  if (!membership) {
    redirect("/perfil");
  }

  const proximos = [
    "Medicação e adesão",
    "Diário e sintomas",
    "Timeline do idoso",
  ];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Olá!</h1>
        <p className="text-sm text-subtle">
          Você está cuidando de {membership.idosoNome}.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/perfil">
          <Card className="h-full transition-colors hover:border-primary/40">
            <p className="text-sm font-medium text-ink">Perfil do idoso</p>
            <p className="mt-1 text-xs text-subtle">
              Dados, condições e contatos de emergência.
            </p>
          </Card>
        </Link>
        {proximos.map((p) => (
          <Card key={p} className="h-full opacity-60">
            <p className="text-sm font-medium text-ink">{p}</p>
            <p className="mt-1 text-xs text-subtle">Em breve</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
