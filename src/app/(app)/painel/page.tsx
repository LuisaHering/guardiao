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

  const atalhos = [
    {
      href: "/perfil",
      titulo: "Perfil do idoso",
      descricao: "Dados, condições, alergias e contatos de emergência.",
    },
    {
      href: "/medicacao",
      titulo: "Medicação e adesão",
      descricao: "Remédios, registro diário e alerta de silêncio.",
    },
    {
      href: "/diario",
      titulo: "Diário do cuidador",
      descricao: "Alimentação, ocorrências e a foto do dia.",
    },
    {
      href: "/sintomas",
      titulo: "Sintomas",
      descricao: "Registro com gravidade e histórico.",
    },
    {
      href: "/emergencia",
      titulo: "Emergência",
      descricao: "QR com os dados críticos, acessível sem login.",
    },
    {
      href: "/timeline",
      titulo: "Timeline do idoso",
      descricao: "Tudo que aconteceu, em ordem, num só lugar.",
    },
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
        {atalhos.map((a) => (
          <Link key={a.href} href={a.href}>
            <Card className="h-full transition-colors hover:border-primary/40">
              <p className="text-sm font-medium text-ink">{a.titulo}</p>
              <p className="mt-1 text-xs text-subtle">{a.descricao}</p>
            </Card>
          </Link>
        ))}
        <Card className="h-full opacity-60">
          <p className="text-sm font-medium text-ink">Documentos</p>
          <p className="mt-1 text-xs text-subtle">Em breve</p>
        </Card>
      </div>
    </div>
  );
}
