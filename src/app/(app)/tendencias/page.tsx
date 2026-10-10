"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Card } from "@/components/ui";
import { GraficoTendencia, type Ponto } from "@/components/grafico-tendencia";

type Analito = {
  id: string;
  nome_canonico: string;
  unidade_canonica: string | null;
};

type Linha = {
  valor: number;
  ref_min: number | null;
  ref_max: number | null;
  convertido: boolean;
  valor_original: number | null;
  unidade_original: string | null;
  exame: { data: string | null; laboratorio: string | null } | null;
};

function fmt(n: number) {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

export default function TendenciasPage() {
  const supabase = createClient();
  const membership = useRole();
  const idosoId = membership?.idosoId;

  const [carregando, setCarregando] = useState(true);
  const [analitos, setAnalitos] = useState<Analito[]>([]);
  const [selecionado, setSelecionado] = useState<string>("");
  const [pontos, setPontos] = useState<Ponto[]>([]);
  const [lendo, setLendo] = useState(false);

  const carregarAnalitos = useCallback(async () => {
    if (!idosoId) {
      setCarregando(false);
      return;
    }
    const { data } = await supabase
      .from("analito")
      .select("id, nome_canonico, unidade_canonica")
      .eq("idoso_id", idosoId)
      .is("fundido_em", null)
      .order("nome_canonico");
    const lista = (data ?? []) as Analito[];
    setAnalitos(lista);
    setSelecionado((atual) => atual || lista[0]?.id || "");
    setCarregando(false);
  }, [supabase, idosoId]);

  useEffect(() => {
    carregarAnalitos();
  }, [carregarAnalitos]);

  useEffect(() => {
    if (!selecionado) {
      setPontos([]);
      return;
    }
    let cancelado = false;
    (async () => {
      setLendo(true);
      const { data } = await supabase
        .from("exame_resultado")
        .select(
          "valor, ref_min, ref_max, convertido, valor_original, unidade_original, exame:exame_id(data, laboratorio)",
        )
        .eq("analito_id", selecionado);
      if (cancelado) return;
      const linhas = (data ?? []) as unknown as Linha[];
      setPontos(
        linhas
          .filter((l) => l.exame?.data && l.valor !== null)
          .map((l) => ({
            data: l.exame!.data as string,
            valor: Number(l.valor),
            refMin: l.ref_min === null ? null : Number(l.ref_min),
            refMax: l.ref_max === null ? null : Number(l.ref_max),
            laboratorio: l.exame!.laboratorio,
            convertidoDe:
              l.convertido && l.valor_original !== null
                ? `${fmt(Number(l.valor_original))} ${l.unidade_original ?? ""}`.trim()
                : null,
          })),
      );
      setLendo(false);
    })();
    return () => {
      cancelado = true;
    };
  }, [supabase, selecionado]);

  if (!membership) {
    return (
      <p className="text-sm text-subtle">
        Crie o perfil do idoso primeiro para ver as tendencias.
      </p>
    );
  }

  const atual = analitos.find((a) => a.id === selecionado);
  const ordenados = [...pontos].sort(
    (a, b) => new Date(a.data).getTime() - new Date(b.data).getTime(),
  );
  const ultimo = ordenados[ordenados.length - 1];
  const anterior = ordenados[ordenados.length - 2];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Tendencias</h1>
        <p className="text-sm text-subtle">
          Como cada resultado de exame de {membership.idosoNome} mudou ao longo do
          tempo. Os valores ja estao na mesma unidade.
        </p>
      </div>

      {carregando && <p className="text-sm text-subtle">Carregando...</p>}

      {!carregando && analitos.length === 0 && (
        <Card>
          <p className="text-sm text-ink">Ainda nao ha resultados de exames.</p>
          <p className="mt-1 text-sm text-subtle">
            Confirme um exame em Exames e a serie aparece aqui.
          </p>
        </Card>
      )}

      {analitos.length > 0 && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-subtle">Analito</span>
              <select
                value={selecionado}
                onChange={(e) => setSelecionado(e.target.value)}
                className="h-10 min-w-56 rounded-lg border border-line bg-card px-2 text-sm text-ink"
              >
                {analitos.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nome_canonico}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <Card className={`flex flex-col gap-4 transition-opacity ${lendo ? "opacity-60" : ""}`}>
            {ultimo && atual && (
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <div>
                  <p className="text-xs text-subtle">{atual.nome_canonico}, ultimo resultado</p>
                  <p className="text-3xl font-semibold text-ink">
                    {fmt(ultimo.valor)}{" "}
                    <span className="text-base font-normal text-subtle">
                      {atual.unidade_canonica}
                    </span>
                  </p>
                </div>
                {anterior && (
                  <p className="text-sm text-subtle">
                    {ultimo.valor === anterior.valor
                      ? "igual ao anterior"
                      : `${ultimo.valor > anterior.valor ? "+" : "-"}${fmt(
                          Math.abs(ultimo.valor - anterior.valor),
                        )} em relacao ao anterior (${fmt(anterior.valor)})`}
                  </p>
                )}
              </div>
            )}

            {ordenados.length > 0 && atual ? (
              <GraficoTendencia
                key={atual.id}
                nome={atual.nome_canonico}
                unidade={atual.unidade_canonica ?? ""}
                pontos={ordenados}
              />
            ) : (
              !lendo && <p className="text-sm text-subtle">Sem resultados para este analito.</p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
