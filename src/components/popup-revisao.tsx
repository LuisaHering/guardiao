"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Button } from "@/components/ui";
import { descreverAgenda } from "@/lib/medicacao";
import { carregarLeituras, decidirLeitura, type LeituraParaRevisar } from "@/lib/leituras";
import { abrirArquivo } from "@/lib/documentos";
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

type NaFila = { chave: string; assinatura: string } & (
  | { leitura: LeituraParaRevisar; revisao?: undefined }
  | { revisao: Revisao; leitura?: undefined }
);

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
  const [leituras, setLeituras] = useState<LeituraParaRevisar[]>([]);
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
      const cliente = createClient();
      const [lista, fotos] = await Promise.all([carregarRevisoes(cliente, idosoId), carregarLeituras(cliente, idosoId)]);
      if (cancelado) return;
      setItens(lista);
      setLeituras(fotos);
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

  // O que veio de uma foto é decidido junto com ela, não remédio por remédio.
  const cobertas = new Set(leituras.flatMap((l) => l.cobre));
  const fila: NaFila[] = [
    ...leituras.map((l) => ({ chave: l.chave, assinatura: l.chave, leitura: l })),
    ...itens.filter((r) => !cobertas.has(r.chave)).map((r) => ({ chave: r.chave, assinatura: assinatura(r), revisao: r })),
  ];
  const naFila = fila.filter((i) => !adiadas.includes(i.assinatura));
  const atual = naFila[0];
  if (!admin || !atual) return null;

  function adiar() {
    const todas = [...new Set([...adiadas, ...naFila.map((i) => i.assinatura)])];
    try {
      sessionStorage.setItem(CHAVE_ADIADAS, JSON.stringify(todas));
    } catch {
      // sem armazenamento: o adiamento vale só enquanto a tela estiver aberta
    }
    setAdiadas(todas);
    setNegando(null);
    setErro(null);
  }

  async function decidir(i: NaFila, aprovar: boolean) {
    setOcupado(true);
    setErro(null);
    const falha = i.leitura
      ? await decidirLeitura(createClient(), i.leitura.id, aprovar)
      : await decidirRevisao(createClient(), i.revisao, aprovar);
    setOcupado(false);
    if (falha) {
      setErro(falha);
    } else {
      setNegando(null);
      setLeituras((l) => l.filter((x) => x.chave !== i.chave));
      setItens((l) => l.filter((x) => x.chave !== i.chave));
      window.dispatchEvent(new Event(EVENTO_REMEDIOS));
      window.dispatchEvent(new Event(EVENTO_ALERTAS));
    }
    setRecarga((n) => n + 1);
  }

  const confirmandoNegar = negando === atual.chave;
  const destino =
    atual.leitura && atual.leitura.tipo !== "receita"
      ? { href: "/pedidos", rotulo: "Abrir Pedidos e resultados" }
      : { href: "/medicacao", rotulo: "Abrir a Medicação" };
  const podeNegar = atual.leitura ? atual.leitura.podeNegar : true;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="revisao-titulo"
        className="flex max-h-full w-full max-w-md flex-col gap-4 overflow-y-auto rounded-2xl border border-line bg-card p-5 shadow-xl"
      >
        <div className="flex items-center justify-between gap-2">
          <p className={`text-xs font-semibold uppercase tracking-wide ${atual.leitura?.urgente ? "text-danger" : "text-warn"}`}>
            {atual.leitura?.urgente ? "Urgente · para você revisar" : "Para você revisar"}
          </p>
          {naFila.length > 1 && <p className="text-xs text-subtle">1 de {naFila.length}</p>}
        </div>

        {atual.leitura ? (
          <ConteudoDaFoto leitura={atual.leitura} />
        ) : (
          <div className="flex flex-col gap-2">
            <h2 id="revisao-titulo" className="text-lg font-semibold text-ink">
              {atual.revisao.quem} {TITULO[atual.revisao.tipo]}
            </h2>
            <p className="text-base text-ink">
              <strong>{atual.revisao.remedio.nome}</strong>
              {atual.revisao.remedio.dosagem ? ` ${atual.revisao.remedio.dosagem}` : ""}
            </p>
            {atual.revisao.tipo === "alterar" && atual.revisao.mudancas.length > 0 ? (
              <ul className="flex flex-col gap-1 rounded-lg bg-panel p-3 text-sm text-ink">
                {atual.revisao.mudancas.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-subtle">
                {[descreverAgenda(atual.revisao.remedio), atual.revisao.remedio.instrucoes].filter(Boolean).join(" · ")}
              </p>
            )}
            {atual.revisao.motivo && <p className="text-sm text-subtle">Motivo: {atual.revisao.motivo}</p>}
            <p className="text-sm font-medium text-warn">Já está valendo.</p>
          </div>
        )}

        {erro && <p className="text-sm text-danger" role="alert">{erro}</p>}

        {confirmandoNegar ? (
          <div className="flex flex-col gap-3 rounded-lg border border-danger/50 p-3">
            <p className="text-sm text-ink">{atual.leitura ? atual.leitura.efeitoDeNegar : efeitoDeNegar(atual.revisao)}</p>
            <div className="grid grid-cols-2 gap-2">
              <Button disabled={ocupado} onClick={() => decidir(atual, false)} className="h-12 border-danger text-danger">
                {ocupado ? "Negando..." : "Sim, negar"}
              </Button>
              <Button disabled={ocupado} onClick={() => setNegando(null)} className="h-12">Voltar</Button>
            </div>
          </div>
        ) : !podeNegar ? (
          <Button variant="primary" disabled={ocupado} onClick={() => decidir(atual, true)} className="h-12 text-base">
            {ocupado ? "Salvando..." : "Já conferi"}
          </Button>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="primary" disabled={ocupado} onClick={() => decidir(atual, true)} className="h-12 text-base">
              {ocupado ? "Salvando..." : atual.leitura ? "Aceitar" : "Aprovar"}
            </Button>
            <Button disabled={ocupado} onClick={() => setNegando(atual.chave)} className="h-12 text-base">Negar</Button>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              adiar();
              router.push(destino.href);
            }}
            className="text-sm text-primary hover:underline"
          >
            {destino.rotulo}
          </button>
          <button type="button" onClick={adiar} className="text-sm text-subtle hover:text-ink hover:underline">
            Ver depois
          </button>
        </div>
      </div>
    </div>
  );
}

/** A foto que a pessoa usou, ao lado do que aconteceu com cada item. */
function ConteudoDaFoto({ leitura }: { leitura: LeituraParaRevisar }) {
  const [link, setLink] = useState<{ de: string; url: string } | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const arquivo = leitura.arquivo;

  useEffect(() => {
    if (!arquivo || leitura.ehPdf) return;
    let cancelado = false;
    createClient()
      .storage.from("documentos")
      .createSignedUrl(arquivo, 3600)
      .then(({ data }) => {
        if (!cancelado && data?.signedUrl) setLink({ de: arquivo, url: data.signedUrl });
      });
    return () => {
      cancelado = true;
    };
  }, [arquivo, leitura.ehPdf]);

  const url = link && link.de === arquivo ? link.url : null;
  const abrir = async () => {
    if (arquivo) setFalha(await abrirArquivo(createClient(), "documentos", arquivo));
  };

  return (
    <div className="flex flex-col gap-3">
      <h2 id="revisao-titulo" className="text-lg font-semibold text-ink">
        {leitura.quem}{" "}
        {leitura.tipo === "resultado"
          ? "conferiu um resultado de exame"
          : leitura.tipo === "receita"
            ? "enviou uma receita"
            : "enviou um pedido de exame"}
      </h2>
      <button type="button" onClick={abrir} className="overflow-hidden rounded-lg border border-line bg-panel">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="Foto que foi usada" className="max-h-56 w-full object-contain" />
        ) : (
          <span className="block p-6 text-sm text-subtle">{leitura.ehPdf ? "PDF enviado" : "Carregando a foto..."}</span>
        )}
        <span className="block p-2 text-sm text-primary">Abrir em tamanho grande</span>
      </button>
      {falha && <p className="text-sm text-danger" role="alert">{falha}</p>}
      <ul className="flex flex-col gap-2">
        {leitura.linhas.map((l, i) => (
          <li key={i} className={l.urgente ? "rounded-lg border-2 border-danger bg-danger/10 p-3" : l.atencao ? "rounded-lg border border-warn/60 bg-warn/10 p-3" : "rounded-lg bg-panel p-3"}>
            <p className={`text-xs font-semibold uppercase tracking-wide ${l.urgente ? "text-danger" : l.atencao ? "text-warn" : "text-subtle"}`}>{l.rotulo}</p>
            <p className="text-sm font-medium text-ink">{l.texto}</p>
            {l.detalhe && <p className="text-sm text-subtle">{l.detalhe}</p>}
          </li>
        ))}
      </ul>
      {leitura.temEsperando && (
        <p className="text-sm text-ink">O que não entrou continua esperando você em Medicação, mesmo depois deste aviso.</p>
      )}
      {leitura.podeNegar && <p className="text-sm font-medium text-warn">O que entrou já está valendo.</p>}
    </div>
  );
}
