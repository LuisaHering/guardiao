"use client";

// Apagar o que foi enviado errado. Antes de fazer, a tela mostra o que sai junto. Só aparece
// para quem enviou (e para o administrador).

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Button } from "@/components/ui";
import { apagarEnvio, avisarTelas, desistirExclusao, EVENTO_ENVIOS, type Previa } from "@/lib/apagar";
import { cn } from "@/lib/cn";

type Props = {
  documentoId: string;
  /** o texto do botão: "Apagar o resultado", "Mandei a foto errada"... */
  rotulo: string;
  /** discreto = texto sublinhado; botao = botão comum, para listas */
  aparencia?: "discreto" | "botao";
  /** depois que a pessoa fecha o aviso de "apagado" ou de "pedido enviado" */
  onApagado?: (apagou: boolean) => void;
};

type Situacao = { meu: boolean; pedida: boolean };

type Passo =
  | { nome: "fechado" }
  | { nome: "olhando" }
  | { nome: "previa"; previa: Previa }
  | { nome: "fim"; apagou: boolean };

export function ApagarEnvio({ documentoId, rotulo, aparencia = "discreto", onApagado }: Props) {
  const admin = !!useRole()?.admin;
  const [situacao, setSituacao] = useState<Situacao | null>(null);
  const [passo, setPasso] = useState<Passo>({ nome: "fechado" });
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const cartao = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const atualizar = () => setVersao((v) => v + 1);
    window.addEventListener(EVENTO_ENVIOS, atualizar);
    window.addEventListener("focus", atualizar);
    return () => {
      window.removeEventListener(EVENTO_ENVIOS, atualizar);
      window.removeEventListener("focus", atualizar);
    };
  }, []);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const supabase = createClient();
      const [{ data: d }, { data: auth }] = await Promise.all([
        supabase
          .from("documento")
          .select("autor_id, envio, exclusao_pedida_em")
          .eq("id", documentoId)
          .is("deleted_at", null)
          .maybeSingle(),
        supabase.auth.getUser(),
      ]);
      if (cancelado) return;
      setSituacao(
        d && d.envio ? { meu: d.autor_id === auth.user?.id, pedida: !!d.exclusao_pedida_em } : null,
      );
    })();
    return () => {
      cancelado = true;
    };
  }, [documentoId, versao]);

  useEffect(() => {
    if (passo.nome === "previa" || passo.nome === "fim") {
      cartao.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [passo.nome]);

  async function olhar() {
    setPasso({ nome: "olhando" });
    setErro(null);
    const r = await apagarEnvio(createClient(), documentoId, true);
    if ("erro" in r) {
      setErro(r.erro);
      setPasso({ nome: "fechado" });
    } else {
      setPasso({ nome: "previa", previa: r });
    }
  }

  async function apagar() {
    setOcupado(true);
    setErro(null);
    const r = await apagarEnvio(createClient(), documentoId, false);
    setOcupado(false);
    // A resposta é a que vale: a família pode ter aceitado enquanto a pessoa lia.
    if ("erro" in r) setErro(r.erro);
    else setPasso({ nome: "fim", apagou: !r.precisaConfirmar });
  }

  async function desistir() {
    setOcupado(true);
    setErro(await desistirExclusao(createClient(), documentoId));
    setOcupado(false);
    avisarTelas();
  }

  if (passo.nome === "fim") {
    return (
      <div ref={cartao} className="flex scroll-mt-16 flex-col gap-3 rounded-2xl border-2 border-line bg-card p-4" role="status">
        <p className="text-2xl font-semibold text-success">{passo.apagou ? "✓ Apagado" : "✓ Pedi para a família confirmar"}</p>
        {!passo.apagou && <p className="text-lg text-ink">Nada foi apagado ainda. Até a resposta, tudo continua valendo.</p>}
        <Button
          variant="primary"
          onClick={() => {
            setPasso({ nome: "fechado" });
            avisarTelas();
            onApagado?.(passo.apagou);
          }}
          className="h-14 text-lg"
        >
          Fechar
        </Button>
      </div>
    );
  }

  if (!situacao || (!situacao.meu && !admin)) return null;

  if (situacao.pedida) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-2xl bg-warn/10 p-3">
        <p className="text-base font-medium text-ink">
          {admin ? "Há um pedido para apagar, esperando a sua resposta." : "Esperando a família confirmar a exclusão. Até lá, continua valendo."}
        </p>
        {erro && <p className="text-base text-danger" role="alert">{erro}</p>}
        {situacao.meu && !admin && (
          <Button disabled={ocupado} onClick={desistir} className="h-11 text-base">Desistir de apagar</Button>
        )}
      </div>
    );
  }

  if (passo.nome === "previa") {
    const { efeitos, precisaConfirmar } = passo.previa;
    return (
      <div ref={cartao} className="flex scroll-mt-16 flex-col gap-3 rounded-2xl border-2 border-danger/60 bg-card p-4">
        <p className="text-2xl font-bold leading-tight text-ink">
          {precisaConfirmar ? "A família já tinha aceitado" : "Apagar mesmo?"}
        </p>
        <p className="text-lg text-ink">
          {precisaConfirmar
            ? "Para apagar, o administrador precisa confirmar. Se confirmar:"
            : "Isto acontece agora:"}
        </p>
        <ul className="flex list-disc flex-col gap-1 rounded-xl bg-panel py-3 pl-8 pr-3">
          {efeitos.map((e) => (
            <li key={e} className="text-lg text-ink">{e}</li>
          ))}
        </ul>
        {!situacao.meu && <p className="text-base text-subtle">Quem enviou é avisado.</p>}
        {erro && <p className="text-base text-danger" role="alert">{erro}</p>}
        <Button variant="primary" disabled={ocupado} onClick={() => setPasso({ nome: "fechado" })} className="h-16 text-xl">
          Não, deixar como está
        </Button>
        <Button disabled={ocupado} onClick={apagar} className="h-14 border-danger! text-lg text-danger!">
          {ocupado ? "Um momento..." : precisaConfirmar ? "Pedir para apagar" : "Sim, apagar"}
        </Button>
      </div>
    );
  }

  const olhando = passo.nome === "olhando";
  return (
    <div className={cn("flex flex-col gap-1", aparencia === "discreto" && "items-center")}>
      {aparencia === "botao" ? (
        <Button disabled={olhando} onClick={olhar} className="h-11 text-base">{olhando ? "Um momento..." : rotulo}</Button>
      ) : (
        <button
          type="button"
          disabled={olhando}
          onClick={olhar}
          className="py-2 text-base text-subtle underline underline-offset-4 hover:text-danger disabled:opacity-50"
        >
          {olhando ? "Um momento..." : rotulo}
        </button>
      )}
      {erro && <p className="text-base text-danger" role="alert">{erro}</p>}
    </div>
  );
}
