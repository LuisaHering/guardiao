"use client";

// Onde o administrador corrige o que veio de uma foto (?leitura=) ou um exame salvo (?exame=).

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { SemAcesso } from "@/components/sem-acesso";
import { CorrigirValores } from "@/components/corrigir-valores";
import { CorrigirReceita } from "@/components/corrigir-receita";

type Leitura = Parameters<typeof CorrigirReceita>[0]["leitura"];

type Alvo = { exame: string; leitura?: string } | { receita: Leitura } | { erro: string };

export default function RevisarPage() {
  const membership = useRole();
  const idosoId = membership?.idosoId;
  const [alvo, setAlvo] = useState<Alvo | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const parametros = new URLSearchParams(window.location.search);
      const exame = parametros.get("exame");
      const id = parametros.get("leitura");
      if (exame) {
        if (!cancelado) setAlvo({ exame });
        return;
      }
      const { data } = id
        ? await createClient().from("leitura_papel").select("id, itens, receita_id, documento_id, status").eq("id", id).maybeSingle()
        : { data: null };
      if (cancelado) return;
      if (!data) {
        setAlvo({ erro: "Não encontrei o que corrigir." });
        return;
      }
      const leitura = data as unknown as Leitura;
      const valores = (leitura.itens as unknown as { tipo: string; exame_id?: string }[]).find((i) => i.tipo === "valores");
      setAlvo(valores?.exame_id ? { exame: valores.exame_id, leitura: leitura.id } : { receita: leitura });
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  if (membership && !membership.admin) return <SemAcesso area="Correções" />;
  if (!idosoId || !alvo) return <p className="text-sm text-subtle">Carregando...</p>;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <h1 className="text-2xl font-semibold text-ink">Corrigir</h1>
      {"erro" in alvo && <p className="text-sm text-danger">{alvo.erro}</p>}
      {"exame" in alvo && <CorrigirValores idosoId={idosoId} exameId={alvo.exame} leituraId={alvo.leitura} />}
      {"receita" in alvo && <CorrigirReceita idosoId={idosoId} leitura={alvo.receita} />}
    </div>
  );
}
