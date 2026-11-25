"use client";

// Resultados já conferidos, para quem cuida: valores e laudo, só para ver.

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui";
import { abrirArquivo } from "@/lib/documentos";
import { dataCurta, fmt, posicaoNaFaixa, rotuloPosicao } from "@/lib/tendencia";

type Exame = {
  id: string;
  tipo: string | null;
  laboratorio: string | null;
  data: string | null;
  arquivo_url: string | null;
  exame_resultado: {
    valor: number | null;
    unidade: string | null;
    ref_min: number | null;
    ref_max: number | null;
    analito: { nome_canonico: string } | null;
  }[];
};

export function ResultadosExame({ idosoId }: { idosoId: string }) {
  const supabase = createClient();
  const [exames, setExames] = useState<Exame[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const { data, error } = await supabase
        .from("exame")
        .select("id, tipo, laboratorio, data, arquivo_url, exame_resultado(valor, unidade, ref_min, ref_max, analito:analito_id(nome_canonico))")
        .eq("idoso_id", idosoId)
        .is("deleted_at", null)
        .order("data", { ascending: false })
        .limit(12);
      if (cancelado) return;
      if (error) setErro("Não consegui carregar os resultados.");
      setExames((data ?? []) as unknown as Exame[]);
    })();
    return () => {
      cancelado = true;
    };
  }, [supabase, idosoId]);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-ink">Resultados</h2>
      {!!exames?.length && (
        <Link href="/tendencias" className="flex min-h-14 items-center justify-center rounded-2xl border-2 border-line bg-card text-lg font-semibold text-ink">
          Ver como os valores mudaram
        </Link>
      )}
      {erro && <p className="text-base text-danger" role="alert">{erro}</p>}
      {!exames && <p className="text-base text-subtle">Carregando...</p>}
      {exames && !erro && exames.length === 0 && <p className="text-base text-subtle">Nenhum resultado conferido ainda.</p>}
      {exames?.map((e) => (
        <details key={e.id} className="rounded-2xl border border-line bg-card p-4">
          <summary className="cursor-pointer">
            <span className="text-lg font-semibold text-ink">{e.tipo || "Exame"}</span>
            <span className="block text-base text-subtle">
              {[e.data ? dataCurta(e.data) : "", e.laboratorio].filter(Boolean).join(" · ")}
            </span>
          </summary>
          <ul className="mt-3 flex flex-col gap-2">
            {e.exame_resultado.map((r, i) => {
              if (r.valor === null) return null;
              const alvo = { valor: Number(r.valor), refMin: r.ref_min, refMax: r.ref_max };
              const posicao = posicaoNaFaixa(alvo);
              const fora = posicao === "acima" || posicao === "abaixo";
              return (
                <li key={i} className="border-t border-line pt-2">
                  <p className="text-base text-ink">
                    {r.analito?.nome_canonico ?? "Item"}: <strong>{fmt(alvo.valor)} {r.unidade ?? ""}</strong>
                  </p>
                  {(r.ref_min !== null || r.ref_max !== null) && (
                    <p className={`text-sm ${fora ? "font-medium text-warn" : "text-subtle"}`}>{rotuloPosicao(alvo)}</p>
                  )}
                </li>
              );
            })}
          </ul>
          {e.arquivo_url && (
            <Button className="mt-3 h-12 text-base" onClick={async () => setErro(await abrirArquivo(supabase, "exames", e.arquivo_url as string))}>
              Ver o laudo
            </Button>
          )}
        </details>
      ))}
    </section>
  );
}
