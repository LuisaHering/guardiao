"use client";

import Link from "next/link";
import { useRole } from "@/lib/role-context";
import { EnviarFoto } from "@/components/papeis";

/** Atalho da tela Hoje: o médico passou uma receita ou pediu um exame. */
export default function PapelNovoPage() {
  const membership = useRole();
  if (!membership?.idosoId) return null;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <Link href="/painel" className="inline-flex h-11 w-fit items-center gap-2 rounded-lg border border-line bg-card px-4 text-base font-medium text-ink hover:bg-panel">
        <span aria-hidden>←</span> Voltar
      </Link>
      <h1 className="text-2xl font-semibold text-ink">Exame ou receita nova</h1>
      <EnviarFoto idosoId={membership.idosoId} tipos={["receita", "pedido_exame"]} />
    </div>
  );
}
