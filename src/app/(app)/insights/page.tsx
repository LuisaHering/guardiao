"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Badge, Button, Card } from "@/components/ui";
import { AVISO_PLANO_GRATIS, NOME_PROVEDOR } from "@/lib/ai/nome-provedor";
import { IACarregando } from "@/components/ia-carregando";

type Item = {
  titulo: string;
  observacao: string;
  evidencias: string[];
  confianca: string;
};

type Resultado = {
  suficiente: boolean;
  itens: Item[];
  base: { sintomas: number; diario: number; registros_medicacao: number } | null;
  periodoDias: number;
  geradoEm: string | null;
};

const TOM: Record<string, "neutral" | "primary" | "success"> = {
  baixa: "neutral",
  media: "primary",
  alta: "success",
};

function quando(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function InsightsPage() {
  const supabase = createClient();
  const membership = useRole();
  const idosoId = membership?.idosoId;

  const [carregando, setCarregando] = useState(true);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [periodo, setPeriodo] = useState(60);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!idosoId) {
      setCarregando(false);
      return;
    }
    const { data } = await supabase
      .from("insight")
      .select("itens, base, periodo_dias, gerado_em")
      .eq("idoso_id", idosoId)
      .order("gerado_em", { ascending: false })
      .limit(1);
    const u = data?.[0] as
      | { itens: { suficiente: boolean; itens: Item[] }; base: Resultado["base"]; periodo_dias: number; gerado_em: string }
      | undefined;
    if (u) {
      setResultado({
        suficiente: u.itens.suficiente,
        itens: u.itens.itens,
        base: u.base,
        periodoDias: u.periodo_dias,
        geradoEm: u.gerado_em,
      });
    }
    setCarregando(false);
  }, [supabase, idosoId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function gerar() {
    if (!idosoId) return;
    setErro(null);
    setGerando(true);
    try {
      const resp = await fetch("/api/ia/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idosoId, periodoDias: periodo }),
      });
      const json = await resp.json();
      if (!resp.ok) setErro(json.erro ?? "Não consegui gerar as observações.");
      else setResultado(json as Resultado);
    } catch {
      setErro("Sem conexão com o servidor. Tente de novo.");
    }
    setGerando(false);
  }

  if (!membership) {
    return (
      <p className="text-sm text-subtle">
        Crie o perfil do idoso primeiro para ver observações.
      </p>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Observações</h1>
        <p className="text-sm text-subtle">
          A IA le os registros recentes de {membership.idosoNome} (sintomas, diário e
          medicação) e aponta o que se repete ou parece relacionado. Não e
          diagnostico: e uma ajuda para decidir o que levar ao médico.
        </p>
      </div>

      <Card className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-subtle">Período</span>
          <select
            value={periodo}
            onChange={(e) => setPeriodo(Number(e.target.value))}
            className="h-10 rounded-lg border border-line bg-card px-2 text-sm text-ink"
          >
            <option value={30}>Últimos 30 dias</option>
            <option value={60}>Últimos 60 dias</option>
            <option value={90}>Últimos 90 dias</option>
          </select>
        </label>
        <Button variant="primary" onClick={gerar} disabled={gerando}>
          {gerando ? "Analisando..." : "Gerar observações"}
        </Button>
        {gerando && (
          <div className="w-full">
            <IACarregando rotulo="Analisando os registros..." />
          </div>
        )}
        <p className="w-full text-xs text-subtle">
          Os registros do período são enviados a {NOME_PROVEDOR} para a análise.
          {AVISO_PLANO_GRATIS}
        </p>
        {erro && <p className="w-full text-sm text-danger">{erro}</p>}
      </Card>

      {carregando && <p className="text-sm text-subtle">Carregando...</p>}

      {resultado && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-subtle">
            Gerado em {quando(resultado.geradoEm)} · últimos {resultado.periodoDias} dias
            {resultado.base
              ? ` · ${resultado.base.sintomas} sintomas, ${resultado.base.diario} entradas de diário, ${resultado.base.registros_medicacao} registros de medicação`
              : ""}
          </p>

          {!resultado.suficiente && (
            <Card>
              <p className="text-sm text-ink">
                Ainda não há o que apontar com segurança neste período.
              </p>
              <p className="mt-1 text-sm text-subtle">
                Padrões só aparecem com registros suficientes e repetidos. Continue
                registrando e gere de novo depois.
              </p>
            </Card>
          )}

          {resultado.itens.map((it, i) => (
            <Card key={i} className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium text-ink">{it.titulo}</p>
                <Badge tone={TOM[it.confianca] ?? "neutral"}>
                  confiança {it.confianca}
                </Badge>
              </div>
              <p className="text-sm text-ink">{it.observacao}</p>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
                  Nos registros
                </p>
                <ul className="mt-1 list-disc pl-5 text-sm text-subtle">
                  {it.evidencias.map((e, j) => (
                    <li key={j}>{e}</li>
                  ))}
                </ul>
              </div>
            </Card>
          ))}

          {resultado.itens.length > 0 && (
            <p className="text-xs text-subtle">
              Observações geradas por IA a partir dos registros. Servem de ponto de
              partida para conversar com o médico, não para mudar tratamento.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
