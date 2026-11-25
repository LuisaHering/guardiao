"use client";

// O papel (foto ou PDF) sempre à mão nas telas que pedem "Olhe o papel": um toque abre
// grande, dentro do próprio aplicativo, e outro volta para a mesma pergunta.

import { createContext, useContext, useEffect, useState } from "react";
import { cn } from "@/lib/cn";

type Papel = { url: string; ehPdf: boolean };

const Contexto = createContext<Papel | null>(null);

/** Entrega o arquivo a todas as perguntas de dentro. */
export function PapelAMao({ arquivo, children }: { arquivo: File | null | undefined; children: React.ReactNode }) {
  const [papel, setPapel] = useState<Papel | null>(null);

  useEffect(() => {
    if (!arquivo) return;
    const url = URL.createObjectURL(arquivo);
    let vivo = true;
    Promise.resolve().then(() => vivo && setPapel({ url, ehPdf: arquivo.type === "application/pdf" }));
    return () => {
      vivo = false;
      URL.revokeObjectURL(url);
    };
  }, [arquivo]);

  return <Contexto.Provider value={papel}>{children}</Contexto.Provider>;
}

const estilo =
  "flex min-h-16 w-full items-center gap-3 rounded-xl bg-panel p-2 text-left text-lg font-semibold text-primary underline underline-offset-4";

export function VerPapel({ rotulo = "Abrir o papel" }: { rotulo?: string }) {
  const papel = useContext(Contexto);
  const [aberto, setAberto] = useState(false);
  const [perto, setPerto] = useState(false);
  if (!papel) return null;

  // PDF não dá para desenhar aqui: abre no leitor do próprio celular.
  if (papel.ehPdf) {
    return (
      <a href={papel.url} target="_blank" rel="noopener" className={estilo}>
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-card text-sm font-bold text-ink no-underline">
          PDF
        </span>
        {rotulo}
      </a>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setAberto(true)} className={estilo}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={papel.url} alt="" className="h-14 w-14 shrink-0 rounded-lg border border-line object-cover object-top" />
        {rotulo}
      </button>
      {aberto && (
        <div role="dialog" aria-modal="true" aria-label="O papel" className="fixed inset-0 z-50 flex flex-col bg-black">
          <div className="flex-1 overflow-auto p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={papel.url}
              alt="O papel"
              onClick={() => setPerto((p) => !p)}
              className={cn("mx-auto", perto ? "w-[220%] max-w-none cursor-zoom-out" : "w-full max-w-3xl cursor-zoom-in")}
            />
          </div>
          <p className="px-4 pb-2 text-center text-base text-white/80">
            {perto ? "Toque no papel para diminuir." : "Toque no papel para aumentar."}
          </p>
          <button
            type="button"
            onClick={() => {
              setAberto(false);
              setPerto(false);
            }}
            className="m-3 mt-0 min-h-16 rounded-xl bg-white text-xl font-bold text-black"
          >
            Fechar o papel
          </button>
        </div>
      )}
    </>
  );
}
