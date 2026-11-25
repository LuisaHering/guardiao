"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui";
import { hojeBR } from "@/lib/medicacao";
import { COLUNAS_REGISTRO_TAREFA, COLUNAS_TAREFA, tarefasDoDia, type ItemTarefa, type RegistroTarefa, type Tarefa } from "@/lib/tarefas";

/** Como andam hoje as tarefas pedidas a quem cuida. Some quando não há tarefa para hoje. */
export function ResumoTarefas({ idosoId }: { idosoId: string }) {
  const [itens, setItens] = useState<ItemTarefa[]>([]);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const supabase = createClient();
      const { data: ts } = await supabase.from("tarefa").select(COLUNAS_TAREFA).eq("idoso_id", idosoId).is("deleted_at", null);
      const tarefas = (ts ?? []) as unknown as Tarefa[];
      if (!tarefas.length) return;
      const { data: rs } = await supabase
        .from("tarefa_registro")
        .select(COLUNAS_REGISTRO_TAREFA)
        .in("tarefa_id", tarefas.map((t) => t.id))
        .is("deleted_at", null)
        .order("data", { ascending: false })
        .limit(500);
      if (!cancelado) setItens(tarefasDoDia(tarefas, (rs ?? []) as unknown as RegistroTarefa[], hojeBR()));
    })();
    return () => {
      cancelado = true;
    };
  }, [idosoId]);

  if (!itens.length) return null;
  const respondidas = itens.filter((i) => i.registro).length;

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">
          Tarefas de hoje: {respondidas} de {itens.length} respondidas
        </h2>
        <Link href="/tarefas" className="text-xs text-primary hover:underline">Ver tarefas</Link>
      </div>
      {itens.map((i) => (
        <div key={i.tarefa.id} className="flex flex-wrap justify-between gap-2 text-sm">
          <span className="text-ink">{i.tarefa.titulo}</span>
          <span className={i.registro?.status === "feito" ? "text-success" : i.registro || i.atrasada ? "text-warn" : "text-subtle"}>
            {i.registro ? (i.registro.status === "feito" ? "Feito" : "Não conseguiu") : i.atrasada ? "Atrasada" : "Falta fazer"}
          </span>
        </div>
      ))}
    </Card>
  );
}
