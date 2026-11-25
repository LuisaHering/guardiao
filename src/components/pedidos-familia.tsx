"use client";

// Pedidos para os familiares. Quem cuida e a pessoa cuidada pedem; a família diz
// "eu resolvo" (os outros ficam sabendo) e depois "feito".

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Button, Input } from "@/components/ui";
import {
  apagarPedido,
  ATALHOS,
  criarPedido,
  EVENTO_PEDIDOS_FAMILIA,
  familiares,
  frasePedido,
  mudarPedido,
  carregarPedidos,
  type Familiar,
  type PedidoFamilia,
  type TipoAtalho,
} from "@/lib/pedidos-familia";
import { cn } from "@/lib/cn";

const grande = "flex min-h-[64px] w-full flex-col items-center justify-center rounded-2xl border-2 border-line bg-card px-4 py-2 text-lg font-semibold text-ink hover:bg-panel disabled:opacity-50";

const quando = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function useDados(idosoId: string) {
  const [dados, setDados] = useState<{ pedidos: PedidoFamilia[]; nomes: Record<string, string>; eu: string } | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    const atualizar = () => setVersao((v) => v + 1);
    window.addEventListener(EVENTO_PEDIDOS_FAMILIA, atualizar);
    window.addEventListener("focus", atualizar);
    return () => {
      window.removeEventListener(EVENTO_PEDIDOS_FAMILIA, atualizar);
      window.removeEventListener("focus", atualizar);
    };
  }, []);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const r = await carregarPedidos(createClient(), idosoId);
      if (cancelado) return;
      setFalhou(!r);
      if (r) setDados(r);
    })();
    return () => {
      cancelado = true;
    };
  }, [idosoId, versao]);

  return { dados, falhou };
}

export function PedidosFamilia({ idosoId }: { idosoId: string }) {
  const membership = useRole();
  const podePedir = membership?.role === "cuidador" || membership?.role === "idoso";
  const { dados, falhou } = useDados(idosoId);
  const [pedindo, setPedindo] = useState(false);

  if (pedindo) return <NovoPedido idosoId={idosoId} onFim={() => setPedindo(false)} />;
  if (falhou) return <p className="text-base text-danger" role="alert">Não consegui carregar os pedidos. Confira a internet.</p>;
  if (!dados) return <p className="text-base text-subtle">Carregando...</p>;

  const abertos = dados.pedidos.filter((p) => p.status === "aberto" || p.status === "assumido");
  const feitos = dados.pedidos.filter((p) => p.status === "feito");
  const cartao = (p: PedidoFamilia) => <Cartao key={p.id} pedido={p} nomes={dados.nomes} eu={dados.eu} />;

  return (
    <div className="flex flex-col gap-3">
      {podePedir && (
        <Button variant="primary" onClick={() => setPedindo(true)} className="h-16 text-xl">Fazer um pedido</Button>
      )}
      {abertos.length === 0 && <p className="text-base text-subtle">Nenhum pedido em aberto.</p>}
      {abertos.map(cartao)}
      {feitos.length > 0 && (
        <details>
          <summary className="cursor-pointer py-2 text-base font-medium text-subtle">Resolvidos ({feitos.length})</summary>
          <div className="mt-2 flex flex-col gap-3">{feitos.map(cartao)}</div>
        </details>
      )}
    </div>
  );
}

/** No painel da família: só o que está em aberto e é de outra pessoa. */
export function PedidosNoPainel({ idosoId }: { idosoId: string }) {
  const { dados } = useDados(idosoId);
  const abertos = (dados?.pedidos ?? []).filter(
    (p) => (p.status === "aberto" || p.status === "assumido") && p.autor_id !== dados?.eu,
  );
  if (!dados || abertos.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">Pedidos para a família</h2>
        <Link href="/familia" className="text-xs text-primary hover:underline">Ver todos</Link>
      </div>
      {[...abertos]
        .sort((a, b) => Number(b.urgente) - Number(a.urgente))
        .slice(0, 3)
        .map((p) => (
          <Cartao key={p.id} pedido={p} nomes={dados.nomes} eu={dados.eu} />
        ))}
    </section>
  );
}

function Cartao({ pedido: p, nomes, eu }: { pedido: PedidoFamilia; nomes: Record<string, string>; eu: string }) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [apagando, setApagando] = useState(false);
  const admin = !!useRole()?.admin;
  const meu = p.autor_id === eu;
  const aberto = p.status === "aberto" || p.status === "assumido";
  const comigo = p.assumido_por === eu;
  const paraMim = !p.destinatario_id || p.destinatario_id === eu;
  const nome = (id: string | null) => (id === eu ? "você" : (id && nomes[id]) || "alguém da família");

  async function fazer(acao: "assumir" | "largar" | "concluir") {
    setOcupado(true);
    setErro(await mudarPedido(createClient(), p.id, acao));
    setOcupado(false);
  }

  const andamento =
    p.status === "feito"
      ? `Resolvido${p.feito_por ? ` por ${nome(p.feito_por)}` : ""}`
      : p.status === "assumido"
        ? comigo
          ? "Você vai resolver"
          : `${nomes[p.assumido_por ?? ""] || "Alguém"} vai resolver`
        : "Esperando alguém responder";

  const resultado = p.pedido_exame?.resultado_documento_id;

  return (
    <article className={cn("flex flex-col gap-2 rounded-2xl bg-card p-4", p.urgente && aberto ? "border-2 border-danger" : "border border-line")}>
      {p.urgente && aberto && <p className="text-sm font-semibold uppercase text-danger">Urgente</p>}
      <p className="text-sm text-subtle">
        {meu ? "Você pediu" : `${nomes[p.autor_id] || "Alguém"} pediu`} · {quando(p.created_at)} · para{" "}
        {p.destinatario_id ? nome(p.destinatario_id) : "a família toda"}
      </p>
      <p className="text-lg font-semibold leading-tight text-ink">{frasePedido(p)}</p>
      <p className={cn("text-base", p.status === "assumido" ? "font-medium text-success" : "text-subtle")}>{andamento}</p>
      {erro && <p className="text-base text-danger" role="alert">{erro}</p>}

      {p.tipo === "conferir_exame" && aberto && !meu && resultado && (p.status === "aberto" || comigo) && (
        <Link
          href={`/exames?documento=${resultado}&pedido=${p.pedido_exame_id}`}
          onClick={() => {
            // Abrir para conferir já avisa os outros de que há alguém nisso.
            if (p.status === "aberto") fazer("assumir");
          }}
          className="flex min-h-12 items-center justify-center rounded-lg border-2 border-primary text-base font-medium text-ink"
        >
          Conferir os valores
        </Link>
      )}
      {aberto && !meu && p.status === "aberto" && (
        <Button variant="primary" disabled={ocupado} onClick={() => fazer("assumir")} className="h-14 text-lg">Eu resolvo</Button>
      )}
      {aberto && !meu && comigo && (
        <>
          {p.tipo !== "conferir_exame" && (
            <Button variant="primary" disabled={ocupado} onClick={() => fazer("concluir")} className="h-14 text-lg">Marcar como feito</Button>
          )}
          <Button variant="ghost" disabled={ocupado} onClick={() => fazer("largar")} className="h-11">Não vou conseguir</Button>
        </>
      )}
      {aberto && !meu && !comigo && p.status === "assumido" && paraMim && (
        <p className="text-sm text-subtle">Não precisa fazer nada.</p>
      )}
      {aberto && meu && p.tipo !== "conferir_exame" && (
        <Button disabled={ocupado} onClick={() => fazer("concluir")} className="h-12 text-base">Já foi resolvido</Button>
      )}

      {(meu || admin) &&
        (apagando ? (
          <div className="flex flex-col gap-2 rounded-xl border-2 border-danger/60 p-3">
            <p className="text-lg font-semibold text-ink">Apagar este pedido? Ele some para todos.</p>
            {p.status === "assumido" && !comigo && (
              <p className="text-base text-ink">
                {nomes[p.assumido_por ?? ""] || "Alguém"} disse que vai resolver e não recebe aviso. Se precisar, ligue.
              </p>
            )}
            <Button variant="primary" disabled={ocupado} onClick={() => setApagando(false)} className="h-14 text-lg">
              Não, deixar como está
            </Button>
            <Button
              disabled={ocupado}
              onClick={async () => {
                setOcupado(true);
                setErro(await apagarPedido(createClient(), p.id));
                setOcupado(false);
              }}
              className="h-12 border-danger! text-base text-danger!"
            >
              Sim, apagar
            </Button>
          </div>
        ) : (
          <button
            type="button"
            disabled={ocupado}
            onClick={() => setApagando(true)}
            className="self-center py-1 text-base text-subtle underline underline-offset-4 hover:text-danger disabled:opacity-50"
          >
            Apagar pedido
          </button>
        ))}
    </article>
  );
}

type PassoPedido = "oque" | "detalhe" | "quem" | "urgente" | "enviado";

/** Escolher para quem: a família toda ou uma pessoa. Usado também para pedir a conferência de um exame. */
export function ParaQuem({ idosoId, ocupado, onEscolher }: { idosoId: string; ocupado?: boolean; onEscolher: (f: Familiar | null) => void }) {
  const [lista, setLista] = useState<Familiar[] | null>(null);
  useEffect(() => {
    let cancelado = false;
    familiares(createClient(), idosoId).then((l) => {
      if (!cancelado) setLista(l);
    });
    return () => {
      cancelado = true;
    };
  }, [idosoId]);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xl font-semibold text-ink">Para quem?</p>
      <button type="button" disabled={ocupado} onClick={() => onEscolher(null)} className={grande}>A família toda</button>
      {!lista && <p className="text-base text-subtle">Carregando os nomes...</p>}
      {lista?.map((f) => (
        <button key={f.id} type="button" disabled={ocupado} onClick={() => onEscolher(f)} className={grande}>
          {f.nome}
        </button>
      ))}
    </div>
  );
}

function NovoPedido({ idosoId, onFim }: { idosoId: string; onFim: () => void }) {
  const [passo, setPasso] = useState<PassoPedido>("oque");
  const [tipo, setTipo] = useState<TipoAtalho>("outro");
  const [detalhe, setDetalhe] = useState("");
  const [para, setPara] = useState<Familiar | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const atalho = ATALHOS.find((a) => a.tipo === tipo) as (typeof ATALHOS)[number];

  async function enviar(urgente: boolean) {
    setOcupado(true);
    setErro(null);
    const falha = await criarPedido(createClient(), idosoId, { tipo, detalhe, destinatario: para?.id ?? null, urgente });
    setOcupado(false);
    if (falha) setErro(falha);
    else setPasso("enviado");
  }

  const voltarPara: Partial<Record<PassoPedido, PassoPedido>> = { detalhe: "oque", quem: "detalhe", urgente: "quem" };

  return (
    <div className="flex flex-col gap-3">
      {passo !== "enviado" && (
        <button
          type="button"
          onClick={() => (voltarPara[passo] ? setPasso(voltarPara[passo] as PassoPedido) : onFim())}
          className="inline-flex h-11 w-fit items-center gap-2 rounded-lg border border-line bg-card px-4 text-base font-medium text-ink hover:bg-panel"
        >
          <span aria-hidden>←</span> Voltar
        </button>
      )}

      {passo === "oque" && (
        <>
          <p className="text-xl font-semibold text-ink">O que você precisa?</p>
          {ATALHOS.map((a) => (
            <button
              key={a.tipo}
              type="button"
              className={grande}
              onClick={() => {
                setTipo(a.tipo);
                setDetalhe("");
                setPasso("detalhe");
              }}
            >
              {a.rotulo}
            </button>
          ))}
        </>
      )}

      {passo === "detalhe" && (
        <>
          <p className="text-base text-subtle">{atalho.rotulo}</p>
          <label className="flex flex-col gap-2 text-xl font-semibold text-ink">
            {atalho.pergunta}
            <Input value={detalhe} maxLength={500} onChange={(e) => setDetalhe(e.target.value)} className="h-14 text-lg font-normal" />
          </label>
          <p className="text-base text-subtle">Dá para falar pelo microfone do teclado.</p>
          <Button variant="primary" disabled={tipo === "outro" && !detalhe.trim()} onClick={() => setPasso("quem")} className="h-16 text-xl">
            Continuar
          </Button>
        </>
      )}

      {passo === "quem" && (
        <ParaQuem
          idosoId={idosoId}
          onEscolher={(f) => {
            setPara(f);
            setPasso("urgente");
          }}
        />
      )}

      {passo === "urgente" && (
        <>
          <p className="text-xl font-semibold text-ink">É urgente?</p>
          <button type="button" disabled={ocupado} onClick={() => enviar(false)} className={grande}>Pode esperar</button>
          <button type="button" disabled={ocupado} onClick={() => enviar(true)} className={cn(grande, "border-danger text-danger")}>
            Sim, é urgente
          </button>
          <p className="text-base text-subtle">Se for uma emergência de saúde, ligue 192.</p>
          {erro && <p className="text-base text-danger" role="alert">{erro}</p>}
        </>
      )}

      {passo === "enviado" && (
        <div className="flex flex-col gap-3 rounded-2xl border-2 border-line bg-card p-4" role="status">
          <p className="text-2xl font-semibold text-success">✓ Pedido enviado para {para ? para.nome : "a família toda"}</p>
          <p className="text-lg text-ink">{frasePedido({ tipo, detalhe })}</p>
          <p className="text-base text-subtle">
            O aviso aparece quando a pessoa abrir o aplicativo. Se não puder esperar, ligue.
          </p>
          <Button variant="primary" onClick={onFim} className="h-14 text-lg">Ver meus pedidos</Button>
        </div>
      )}
    </div>
  );
}
