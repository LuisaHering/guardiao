"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { emUso, hojeBR, type Remedio, COLUNAS_REMEDIO } from "@/lib/medicacao";

type Contato = { id: string; nome: string; telefone: string | null; relacao: string | null };

type Dados = {
  contatos: Contato[];
  alergias: string[];
  condicoes: string[];
  remedios: string[];
  sangue: string | null;
};

const soNumeros = (t: string) => t.replace(/[^\d+]/g, "");

/**
 * Emergência para quem cuida: ligar vem primeiro, e o que dizer ao socorro vem logo abaixo.
 * (Versão simples; a etapa seguinte completa este fluxo.)
 */
export default function EmergenciaCuidadoraPage() {
  const supabase = createClient();
  const membership = useRole();
  const idosoId = membership?.idosoId;
  const [dados, setDados] = useState<Dados | null>(null);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    if (!idosoId) return;
    let cancelado = false;
    (async () => {
      const [c, a, co, m, i] = await Promise.all([
        supabase.from("contato_emergencia").select("id, nome, telefone, relacao").eq("idoso_id", idosoId).is("deleted_at", null),
        supabase.from("alergia").select("substancia").eq("idoso_id", idosoId).is("deleted_at", null),
        supabase.from("condicao").select("nome").eq("idoso_id", idosoId).eq("ativa", true).is("deleted_at", null),
        supabase.from("medicacao").select(COLUNAS_REMEDIO).eq("idoso_id", idosoId).eq("ativo", true).is("deleted_at", null),
        supabase.from("idoso").select("tipo_sanguineo").eq("id", idosoId).single(),
      ]);
      if (cancelado) return;
      // Em emergência, uma falha não pode parecer "sem alergias".
      if (c.error || a.error || co.error || m.error) {
        setFalhou(true);
        return;
      }
      setDados({
        contatos: (c.data ?? []) as Contato[],
        alergias: (a.data ?? []).map((x) => x.substancia as string),
        condicoes: (co.data ?? []).map((x) => x.nome as string),
        remedios: ((m.data ?? []) as unknown as Remedio[])
          .filter((r) => emUso(r, hojeBR()))
          .map((r) => [r.nome, r.dosagem].filter(Boolean).join(" ")),
        sangue: (i.data?.tipo_sanguineo as string | null) ?? null,
      });
    })();
    return () => {
      cancelado = true;
    };
  }, [supabase, idosoId]);

  const botao = "flex min-h-[72px] items-center gap-4 rounded-2xl border-2 px-4 text-lg font-semibold";

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <Link href="/painel" className="inline-flex h-11 w-fit items-center gap-2 rounded-lg border border-line bg-card px-4 text-base font-medium text-ink hover:bg-panel">
        <span aria-hidden>←</span> Voltar
      </Link>
      <h1 className="text-2xl font-semibold text-ink">Emergência</h1>

      {/* Não depende de carregar nada: aparece mesmo sem internet. */}
      <a href="tel:192" className="flex min-h-[96px] items-center justify-center rounded-2xl bg-danger px-4 text-center text-2xl font-bold text-white">
        Ligar 192 (SAMU)
      </a>

      {dados?.contatos
        .filter((c) => c.telefone)
        .map((c) => (
          <a key={c.id} href={`tel:${soNumeros(c.telefone as string)}`} className={`${botao} border-line bg-card text-ink`}>
            <span className="min-w-0">
              Ligar para {c.nome}
              <span className="block text-base font-normal text-subtle">{[c.relacao, c.telefone].filter(Boolean).join(" · ")}</span>
            </span>
          </a>
        ))}
      {dados && !dados.contatos.some((c) => c.telefone) && (
        <p className="text-base text-warn">Não há telefone de contato cadastrado. Peça à família para cadastrar.</p>
      )}

      <section className="rounded-2xl border border-line bg-card p-4">
        <h2 className="text-lg font-semibold text-ink">Diga ao socorro</h2>
        {falhou && (
          <p className="mt-2 text-base text-danger" role="alert">
            Não consegui carregar os dados. Isso não quer dizer que não há alergias. Veja a carteira ou ligue para a família.
          </p>
        )}
        {!falhou && !dados && <p className="mt-2 text-base text-subtle">Carregando os dados...</p>}
        {dados && (
          <dl className="mt-2 flex flex-col gap-2 text-base">
            {[
              ["Nome", membership?.idosoNomeCompleto ?? ""],
              ["Alergias", dados.alergias.join(", ") || "nenhuma cadastrada"],
              ["Doenças", dados.condicoes.join(", ") || "nenhuma cadastrada"],
              ["Remédios", dados.remedios.join(", ") || "nenhum cadastrado"],
              ["Tipo de sangue", dados.sangue || "não informado"],
            ].map(([rotulo, valor]) => (
              <div key={rotulo}>
                <dt className="text-sm text-subtle">{rotulo}</dt>
                <dd className="text-ink">{valor}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <Link href="/emergencia" className="py-2 text-center text-base text-primary hover:underline">
        Ver o QR de emergência
      </Link>
    </div>
  );
}
