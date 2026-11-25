"use client";

import { useRole } from "@/lib/role-context";
import { PedidosExame } from "@/components/pedidos-exame";
import { ResultadosExame } from "@/components/resultados-exame";

/** Para quem cuida é a aba "Exames"; para a família, "Pedidos e resultados". */
export default function PedidosPage() {
  const membership = useRole();
  if (!membership?.idosoId) return <p className="text-sm text-subtle">Crie o perfil do idoso primeiro.</p>;
  const cuidador = membership.role === "cuidador";

  return (
    <div className="mx-auto flex max-w-md flex-col gap-5">
      <h1 className="text-2xl font-semibold text-ink">{cuidador ? "Exames" : "Pedidos e resultados"}</h1>
      <PedidosExame idosoId={membership.idosoId} />
      {cuidador && <ResultadosExame idosoId={membership.idosoId} />}
    </div>
  );
}
