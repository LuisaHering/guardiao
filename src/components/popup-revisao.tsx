"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Button } from "@/components/ui";
import { descreverAgenda } from "@/lib/medicacao";
import { carregarRevisoes, decidirRevisao, efeitoDeNegar, EVENTO_REMEDIOS, type Revisao } from "@/lib/revisoes";
import { EVENTO_ALERTAS } from "@/components/sino-alertas";

const CHAVE_ADIADAS = "guardiao:revisoes-adiadas";
const INTERVALO_MS = 30_000;

function lerAdiadas(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(CHAVE_ADIADAS) ?? "[]") as string[];
  } catch {
    return [];
  }
}

/** Uma revisão adiada volta a aparecer se mudar de novo. */
const assinatura = (r: Revisao) => `${r.chave}|${r.tipo}|${r.mudancas.join("|")}`;

const TITULO: Record<Revisao["tipo"], string> = {
  novo: "adicionou um remédio",
  alterar: "mudou um remédio",
  suspender: "suspendeu um remédio",
};

/**
 * Pop-up do administrador: o que outra pessoa fez nos remédios (e já está valendo).
 * Confere ao abrir o app, ao trocar de tela, ao voltar para a aba e a cada 30 segundos.
 */
export function PopupRevisao() {
  const membership = useRole();
  const pathname = usePathname();
  const router = useRouter();
  const [itens, setItens] = useState<Revisao[]>([]);
  const [adiadas, setAdiadas] = useState<string[]>([]);
  const [negando, setNegando] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  const admin = !!membership?.admin;
  const idosoId = membership?.idosoId;

  useEffect(() => {
    if (!admin || !idosoId) return;
    let cancelado = false;
    const conferir = async () => {
      const lista = await carregarRevisoes(createClient(), idosoId);
      if (cancelado) return;
      setItens(lista);
      setAdiadas(lerAdiadas());
    };
    conferir();
    const relogio = window.setInterval(conferir, INTERVALO_MS);
    window.addEventListener("focus", conferir);
    window.addEventListener(EVENTO_REMEDIOS, conferir);
    return () => {
      cancelado = true;
      window.clearInterval(relogio);
      window.removeEventListener("focus", conferir);
      window.removeEventListener(EVENTO_REMEDIOS, conferir);
    };
  }, [admin, idosoId, pathname, recarga]);

  const naFila = itens.filter((r) => !adiadas.includes(assinatura(r)));
  const atual = naFila[0];
  if (!admin || !atual) return null;

  function adiar() {
    const todas = [...new Set([...adiadas, ...naFila.map(assinatura)])];
    try {
      sessionStorage.setItem(CHAVE_ADIADAS, JSON.stringify(todas));
    } catch {
      // sem armazenamento: o adiamento vale só enquanto a tela estiver aberta
    }
    setAdiadas(todas);
    setNegando(null);
    setErro(null);
  }

  async function decidir(r: Revisao, aprovar: boolean) {
    setOcupado(true);
    setErro(null);
    const falha = await decidirRevisao(createClient(), r, aprovar);
    setOcupado(false);
    if (falha) {
      setErro(falha);
    } else {
      setNegando(null);
      setItens((l) => l.filter((x) => x.chave !== r.chave));
      window.dispatchEvent(new Event(EVENTO_REMEDIOS));
      window.dispatchEvent(new Event(EVENTO_ALERTAS));
    }
    setRecarga((n) => n + 1);
  }

  const confirmandoNegar = negando === atual.chave;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="revisao-titulo"
        className="flex max-h-full w-full max-w-md flex-col gap-4 overflow-y-auto rounded-2xl border border-line bg-card p-5 shadow-xl"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-warn">Para você revisar</p>
          {naFila.length > 1 && <p className="text-xs text-subtle">1 de {naFila.length}</p>}
        </div>

        <div className="flex flex-col gap-2">
          <h2 id="revisao-titulo" className="text-lg font-semibold text-ink">
            {atual.quem} {TITULO[atual.tipo]}
          </h2>
          <p className="text-base text-ink">
            <strong>{atual.remedio.nome}</strong>
            {atual.remedio.dosagem ? ` ${atual.remedio.dosagem}` : ""}
          </p>
          {atual.tipo === "alterar" && atual.mudancas.length > 0 ? (
            <ul className="flex flex-col gap-1 rounded-lg bg-panel p-3 text-sm text-ink">
              {atual.mudancas.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-subtle">
              {[descreverAgenda(atual.remedio), atual.remedio.instrucoes].filter(Boolean).join(" · ")}
            </p>
          )}
          {atual.motivo && <p className="text-sm text-subtle">Motivo: {atual.motivo}</p>}
          <p className="text-sm font-medium text-warn">Já está valendo.</p>
        </div>

        {erro && <p className="text-sm text-danger" role="alert">{erro}</p>}

        {confirmandoNegar ? (
          <div className="flex flex-col gap-3 rounded-lg border border-danger/50 p-3">
            <p className="text-sm text-ink">{efeitoDeNegar(atual)}</p>
            <div className="grid grid-cols-2 gap-2">
              <Button disabled={ocupado} onClick={() => decidir(atual, false)} className="h-12 border-danger text-danger">
                {ocupado ? "Negando..." : "Sim, negar"}
              </Button>
              <Button disabled={ocupado} onClick={() => setNegando(null)} className="h-12">Voltar</Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="primary" disabled={ocupado} onClick={() => decidir(atual, true)} className="h-12 text-base">
              {ocupado ? "Salvando..." : "Aprovar"}
            </Button>
            <Button disabled={ocupado} onClick={() => setNegando(atual.chave)} className="h-12 text-base">Negar</Button>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              adiar();
              router.push("/medicacao");
            }}
            className="text-sm text-primary hover:underline"
          >
            Abrir a Medicação
          </button>
          <button type="button" onClick={adiar} className="text-sm text-subtle hover:text-ink hover:underline">
            Ver depois
          </button>
        </div>
      </div>
    </div>
  );
}
