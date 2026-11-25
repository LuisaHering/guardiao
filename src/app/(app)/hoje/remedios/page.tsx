"use client";

import Link from "next/link";
import { useRole } from "@/lib/role-context";
import { DosesDeHoje } from "@/components/doses-de-hoje";
import { RemediosEsperando } from "@/components/remedios-esperando";

/** Só os remédios de hoje, sem o cadastro: o que a pessoa precisa na hora de dar. */
export default function RemediosDeHojePage() {
  const membership = useRole();
  if (!membership?.idosoId) return null;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <Link href="/painel" className="inline-flex h-11 w-fit items-center gap-2 rounded-lg border border-line bg-card px-4 text-base font-medium text-ink hover:bg-panel">
        <span aria-hidden>←</span> Voltar
      </Link>
      <RemediosEsperando idosoId={membership.idosoId} />
      <DosesDeHoje idosoId={membership.idosoId} />
      <Link href="/medicacao" className="py-2 text-center text-base text-primary hover:underline">
        Ver todos os remédios ou adicionar um
      </Link>
    </div>
  );
}
