"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import {
  conteudoOnboarding,
  EVENTO_BOAS_VINDAS,
  preencher,
  type Icone,
} from "@/lib/onboarding";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

const CAMINHOS: Record<Icone, string[]> = {
  escudo: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z", "m9 12 2 2 4-4"],
  pessoas: [
    "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2",
    "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
    "M23 21v-2a4 4 0 0 0-3-3.87",
    "M16 3.13a4 4 0 0 1 0 7.75",
  ],
  prancheta: [
    "M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1z",
    "M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2",
    "m9 14 2 2 4-4",
  ],
  brilho: ["M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z", "M19 16v4M17 18h4"],
  sino: ["M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9", "M13.73 21a2 2 0 0 1-3.46 0"],
  conversa: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
  coracao: [
    "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z",
  ],
  pessoa: ["M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2", "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8"],
  cadeado: ["M5 11h14v10H5z", "M8 11V7a4 4 0 0 1 8 0v4"],
};

function IconeGrande({ nome }: { nome: Icone }) {
  return (
    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-soft text-primary">
      <svg
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {CAMINHOS[nome].map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </span>
  );
}

/**
 * Boas-vindas em poucos passos, escritas para cada papel. Aparece no primeiro acesso
 * e pode ser reaberta pelo botão de ajuda no cabeçalho.
 */
export function BoasVindas() {
  const membership = useRole();
  const [aberto, setAberto] = useState(false);
  const [passo, setPasso] = useState(0);
  const [primeiroNome, setPrimeiroNome] = useState("");
  const [jaVisto, setJaVisto] = useState(true);
  const router = useRouter();

  // Primeiro acesso: abre sozinha se esta pessoa ainda não viu.
  useEffect(() => {
    if (!membership) return;
    let cancelado = false;
    (async () => {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data } = await supabase
        .from("usuario")
        .select("nome, onboarding_visto_em")
        .eq("id", auth.user.id)
        .maybeSingle();
      if (cancelado) return;
      setPrimeiroNome(((data?.nome as string | null) ?? "").trim().split(/\s+/)[0]);
      const visto = !!data?.onboarding_visto_em;
      setJaVisto(visto);
      if (!visto) setAberto(true);
    })();
    return () => {
      cancelado = true;
    };
  }, [membership]);

  // Reabre pelo botão de ajuda.
  useEffect(() => {
    function reabrir() {
      setPasso(0);
      setAberto(true);
    }
    window.addEventListener(EVENTO_BOAS_VINDAS, reabrir);
    return () => window.removeEventListener(EVENTO_BOAS_VINDAS, reabrir);
  }, []);

  const fechar = useCallback(async () => {
    setAberto(false);
    if (!jaVisto) {
      setJaVisto(true);
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      if (auth.user) {
        await supabase
          .from("usuario")
          .update({ onboarding_visto_em: new Date().toISOString() })
          .eq("id", auth.user.id);
      }
    }
  }, [jaVisto]);

  // Esc fecha; setas navegam.
  useEffect(() => {
    if (!aberto) return;
    function tecla(e: KeyboardEvent) {
      if (e.key === "Escape") fechar();
    }
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [aberto, fechar]);

  if (!membership || !aberto) return null;

  const { slides, grande, passos } = conteudoOnboarding(membership.role, membership.admin);
  const nome = membership.idosoNome ?? "a pessoa cuidada";
  const slide = slides[passo];
  const ultimo = passo === slides.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) fechar();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="boas-vindas-titulo"
        className="flex w-full max-w-md flex-col gap-5 rounded-2xl border border-line bg-card p-6 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-subtle">
            {primeiroNome ? `Olá, ${primeiroNome}` : "Boas-vindas"}
          </p>
          <button
            type="button"
            onClick={fechar}
            className="rounded-lg px-2 py-1 text-xs text-subtle hover:bg-panel hover:text-ink"
          >
            Pular
          </button>
        </div>

        <div className="flex flex-col items-start gap-4">
          <IconeGrande nome={slide.icone} />
          <h2 id="boas-vindas-titulo" className={cn("font-semibold text-ink", grande ? "text-2xl" : "text-xl")}>
            {preencher(slide.titulo, nome)}
          </h2>
          <p className={cn("leading-relaxed text-subtle", grande ? "text-lg" : "text-sm")}>
            {preencher(slide.texto, nome)}
          </p>
          {ultimo && passos.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm text-ink">
              {passos.slice(0, 3).map((p) => (
                <li key={p.id} className="flex items-start gap-2">
                  <span className="mt-0.5 text-primary" aria-hidden>
                    •
                  </span>
                  {preencher(p.titulo, nome)}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-center gap-1.5" aria-label={`Passo ${passo + 1} de ${slides.length}`}>
            {slides.map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === passo ? "w-6 bg-primary" : "w-1.5 bg-line",
                )}
              />
            ))}
          </div>
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" onClick={() => setPasso(passo - 1)} disabled={passo === 0}>
              Voltar
            </Button>
            {ultimo ? (
              <Button
                variant="primary"
                autoFocus
                onClick={() => {
                  fechar();
                  router.push("/painel");
                }}
              >
                Começar
              </Button>
            ) : (
              <Button variant="primary" autoFocus onClick={() => setPasso(passo + 1)}>
                Próximo
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
