"use client";

import { useRole } from "@/lib/role-context";
import { PedidosFamilia } from "@/components/pedidos-familia";

export default function PedidosFamiliaPage() {
  const membership = useRole();
  if (!membership?.idosoId) return <p className="text-sm text-subtle">Crie o perfil do idoso primeiro.</p>;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-2xl font-semibold text-ink">
        {membership.role === "familiar" ? "Pedidos da família" : "Pedidos para os familiares"}
      </h1>
      <PedidosFamilia idosoId={membership.idosoId} />
    </div>
  );
}
