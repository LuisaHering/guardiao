"use client";

// Colocar um resultado de exame: foto ou PDF, ligado ao pedido dele ou sozinho.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui";
import { useRole } from "@/lib/role-context";
import { QuemConfere } from "@/components/conferir-valores";
import {
  COLUNAS_PEDIDO,
  enviarResultado,
  ligarResultado,
  ordenarPedidos,
  situacao,
  type PedidoExame,
  type ResultadoLigado,
} from "@/lib/pedidos-exame";
import { cn } from "@/lib/cn";

const grande = "flex min-h-[68px] w-full flex-col justify-center rounded-2xl border-2 border-line bg-card px-4 py-2 text-left hover:bg-panel";

type Props = {
  idosoId: string;
  /** quando a foto já foi enviada (marcada como outra coisa), só falta dizer de qual exame é */
  documentoId?: string;
  onFim: () => void;
};

/** Foto na hora, ou um PDF / foto que já está no celular. */
export function EscolherArquivoDoResultado({ ocupado, onEscolher }: { ocupado: boolean; onEscolher: (a: File) => void }) {
  const opcao = (rotulo: string, aceita: string, camera: boolean, destaque: boolean) => (
    <label
      className={cn(
        "flex min-h-16 cursor-pointer items-center justify-center rounded-lg px-4 text-center text-lg font-semibold",
        destaque ? "bg-primary text-white" : "border-2 border-line bg-card text-ink",
        ocupado && "pointer-events-none opacity-60",
      )}
    >
      {rotulo}
      <input
        type="file"
        accept={aceita}
        {...(camera ? { capture: "environment" as const } : {})}
        className="sr-only"
        disabled={ocupado}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onEscolher(f);
        }}
      />
    </label>
  );
  return (
    <div className="flex flex-col gap-2">
      <p className="text-lg font-semibold text-ink">{ocupado ? "Enviando o resultado..." : "Enviar o resultado"}</p>
      {opcao("Tirar foto do resultado", "image/*", true, true)}
      {opcao("Escolher PDF ou foto do celular", "image/*,application/pdf", false, false)}
    </div>
  );
}

export function EnviarResultado({ idosoId, documentoId, onFim }: Props) {
  // null = carregando; "avulso" = não é de nenhum pedido anotado
  const [pedidos, setPedidos] = useState<PedidoExame[] | null>(null);
  const [escolha, setEscolha] = useState<PedidoExame | "avulso" | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // o exame em que o resultado ficou, depois de enviado
  const [pronto, setPronto] = useState<string | null>(null);
  const cuidador = useRole()?.role === "cuidador";
  const [erro, setErro] = useState<string | null>(null);
  const ligouSozinho = useRef(false);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const { data, error } = await createClient()
        .from("pedido_exame")
        .select(COLUNAS_PEDIDO)
        .eq("idoso_id", idosoId)
        .in("status", ["falta_marcar", "marcado", "feito"]);
      if (cancelado) return;
      if (error) setErro("Não consegui ver os pedidos. O resultado pode ser enviado mesmo assim.");
      const lista = ordenarPedidos((data ?? []) as PedidoExame[]);
      setPedidos(lista);
      if (lista.length > 0) return;
      setEscolha("avulso");
      // Arquivo já enviado e nenhum pedido para escolher: não há o que perguntar.
      if (documentoId && !ligouSozinho.current) {
        ligouSozinho.current = true;
        const r = await ligarResultado(createClient(), null, documentoId);
        if ("erro" in r) setErro(r.erro);
        else setPronto(r.pedidoId);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [idosoId, documentoId]);

  async function concluir(acao: () => Promise<ResultadoLigado>) {
    setOcupado(true);
    setErro(null);
    const r = await acao();
    setOcupado(false);
    if ("erro" in r) setErro(r.erro);
    else setPronto(r.pedidoId);
  }

  const idDo = (e: PedidoExame | "avulso") => (e === "avulso" ? null : e.id);

  function escolher(e: PedidoExame | "avulso") {
    setEscolha(e);
    // Com o arquivo já enviado, dizer de qual exame é encerra o envio.
    if (documentoId) concluir(() => ligarResultado(createClient(), idDo(e), documentoId));
  }

  if (pronto && cuidador) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-xl font-semibold text-success" role="status">✓ Resultado enviado</p>
        <QuemConfere idosoId={idosoId} pedidoId={pronto} onFim={onFim} />
      </div>
    );
  }

  if (pronto) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border-2 border-line bg-card p-4" role="status">
        <p className="text-2xl font-semibold text-success">✓ Resultado enviado</p>
        <p className="text-lg text-ink">
          Já dá para abrir o arquivo em Exames. Os valores aparecem lá depois que a família conferir.
        </p>
        <Link href="/pedidos" onClick={onFim} className="flex min-h-14 items-center justify-center rounded-lg bg-primary text-lg font-medium text-white">
          Ver em Exames
        </Link>
        <Button onClick={onFim} className="h-14 text-lg">Fechar</Button>
      </div>
    );
  }

  if (!pedidos) return <p className="text-base text-subtle">Carregando...</p>;

  return (
    <div className="flex flex-col gap-3">
      {erro && <p className="text-base text-danger" role="alert">{erro}</p>}

      {(escolha === null || (documentoId && erro)) && (
        <>
          <p className="text-xl font-semibold text-ink">De qual exame é este resultado?</p>
          {pedidos.map((p) => (
            <button key={p.id} type="button" disabled={ocupado} onClick={() => escolher(p)} className={grande}>
              <span className="text-lg font-semibold text-ink">{p.exames.join(", ")}</span>
              <span className="text-base text-subtle">{situacao(p).texto}</span>
            </button>
          ))}
          <button type="button" disabled={ocupado} onClick={() => escolher("avulso")} className={grande}>
            <span className="text-lg font-semibold text-ink">De nenhum destes, ou não sei</span>
          </button>
        </>
      )}

      {escolha !== null && documentoId && !erro && <p className="text-lg text-ink" role="status">Guardando...</p>}

      {escolha !== null && !documentoId && (
        <>
          {escolha !== "avulso" && <p className="text-lg text-ink">Resultado de: <strong>{escolha.exames.join(", ")}</strong></p>}
          <EscolherArquivoDoResultado
            ocupado={ocupado}
            onEscolher={(arquivo) => concluir(() => enviarResultado(createClient(), idosoId, idDo(escolha), arquivo))}
          />
          {pedidos.length > 0 && (
            <Button variant="ghost" disabled={ocupado} onClick={() => setEscolha(null)} className="h-12 text-base">
              Trocar o exame
            </Button>
          )}
        </>
      )}

      <Button variant="ghost" disabled={ocupado} onClick={onFim} className="h-12 text-base">Cancelar</Button>
    </div>
  );
}
