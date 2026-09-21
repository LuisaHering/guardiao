"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Card } from "@/components/ui";

type Tipo = "diario" | "sintoma" | "medicacao";
type Item = {
  id: string;
  tipo: Tipo;
  data: string;
  titulo: string;
  detalhe: string | null;
};

const CONFIG: Record<Tipo, { rotulo: string; cor: string }> = {
  diario: { rotulo: "Diario", cor: "bg-primary" },
  sintoma: { rotulo: "Sintoma", cor: "bg-warn" },
  medicacao: { rotulo: "Medicacao", cor: "bg-success" },
};

function diaLegivel(iso: string) {
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date();
  ontem.setDate(hoje.getDate() - 1);
  const mesmoDia = (a: Date, b: Date) =>
    a.toDateString() === b.toDateString();
  if (mesmoDia(d, hoje)) return "Hoje";
  if (mesmoDia(d, ontem)) return "Ontem";
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TimelinePage() {
  const supabase = createClient();
  const membership = useRole();
  const idosoId = membership?.idosoId;

  const [carregando, setCarregando] = useState(true);
  const [itens, setItens] = useState<Item[]>([]);

  const carregar = useCallback(async () => {
    if (!idosoId) {
      setCarregando(false);
      return;
    }
    setCarregando(true);

    const [{ data: diario }, { data: sintomas }, { data: meds }] =
      await Promise.all([
        supabase
          .from("entrada_diario")
          .select("id, data, alimentacao, ocorrencias")
          .eq("idoso_id", idosoId)
          .is("deleted_at", null)
          .order("data", { ascending: false })
          .limit(50),
        supabase
          .from("sintoma")
          .select("id, data, descricao, gravidade")
          .eq("idoso_id", idosoId)
          .is("deleted_at", null)
          .order("data", { ascending: false })
          .limit(50),
        supabase
          .from("medicacao")
          .select("id, nome")
          .eq("idoso_id", idosoId)
          .is("deleted_at", null),
      ]);

    const lista: Item[] = [];

    for (const d of (diario ?? []) as Record<string, unknown>[]) {
      const partes = [d.alimentacao, d.ocorrencias].filter(Boolean) as string[];
      lista.push({
        id: `diario-${d.id}`,
        tipo: "diario",
        data: d.data as string,
        titulo: "Entrada no diario",
        detalhe: partes.join(" · ") || null,
      });
    }

    for (const s of (sintomas ?? []) as Record<string, unknown>[]) {
      lista.push({
        id: `sintoma-${s.id}`,
        tipo: "sintoma",
        data: s.data as string,
        titulo: `Sintoma${s.gravidade ? ` (gravidade ${s.gravidade})` : ""}`,
        detalhe: s.descricao as string,
      });
    }

    const medMap = new Map(
      ((meds ?? []) as { id: string; nome: string }[]).map((m) => [m.id, m.nome]),
    );
    const medIds = [...medMap.keys()];
    if (medIds.length > 0) {
      const { data: regs } = await supabase
        .from("registro_medicacao")
        .select("id, medicacao_id, status, motivo, registrado_em")
        .in("medicacao_id", medIds)
        .is("deleted_at", null)
        .order("registrado_em", { ascending: false })
        .limit(50);
      for (const r of (regs ?? []) as Record<string, unknown>[]) {
        const nome = medMap.get(r.medicacao_id as string) ?? "Remedio";
        const deu = r.status === "dada";
        lista.push({
          id: `med-${r.id}`,
          tipo: "medicacao",
          data: r.registrado_em as string,
          titulo: deu ? `${nome}: dado` : `${nome}: nao dado`,
          detalhe: !deu && r.motivo ? String(r.motivo) : null,
        });
      }
    }

    lista.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());
    setItens(lista);
    setCarregando(false);
  }, [supabase, idosoId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  if (!membership) {
    return (
      <p className="text-sm text-subtle">
        Crie o perfil do idoso primeiro para ver a timeline.
      </p>
    );
  }

  // Agrupa por dia legivel, preservando a ordem decrescente.
  const grupos: { dia: string; itens: Item[] }[] = [];
  for (const it of itens) {
    const dia = diaLegivel(it.data);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.dia === dia) ultimo.itens.push(it);
    else grupos.push({ dia, itens: [it] });
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Timeline</h1>
        <p className="text-sm text-subtle">
          Tudo que aconteceu com {membership.idosoNome} em um so lugar: diario,
          sintomas e medicacao, em ordem.
        </p>
      </div>

      {carregando && <p className="text-sm text-subtle">Carregando...</p>}
      {!carregando && itens.length === 0 && (
        <p className="text-sm text-subtle">
          Nada registrado ainda. Comece pelo diario, sintomas ou medicacao.
        </p>
      )}

      {grupos.map((g) => (
        <div key={g.dia} className="flex flex-col gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">
            {g.dia}
          </h2>
          <Card className="flex flex-col gap-4">
            {g.itens.map((it) => (
              <div key={it.id} className="flex gap-3">
                <div className="flex flex-col items-center pt-1">
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${CONFIG[it.tipo].cor}`}
                  />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-ink">
                      {it.titulo}
                    </span>
                    <span className="whitespace-nowrap text-xs text-subtle">
                      {CONFIG[it.tipo].rotulo} · {hora(it.data)}
                    </span>
                  </div>
                  {it.detalhe && (
                    <p className="mt-0.5 text-sm text-subtle">{it.detalhe}</p>
                  )}
                </div>
              </div>
            ))}
          </Card>
        </div>
      ))}
    </div>
  );
}
