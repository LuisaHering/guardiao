"use client";

// Os pedidos de exame, para quem cuida e para a família: o que falta marcar fica em
// vermelho; cada pedido mostra só os botões que fazem sentido na situação dele.

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Button, Input } from "@/components/ui";
import { EnviarFoto } from "@/components/papeis";
import { EnviarResultado, EscolherArquivoDoResultado } from "@/components/enviar-resultado";
import { QuemConfere } from "@/components/conferir-valores";
import { abrirArquivo } from "@/lib/documentos";
import { hojeBR } from "@/lib/medicacao";
import {
  COLUNAS_PEDIDO,
  encerrarExame,
  enviarResultado,
  EVENTO_PEDIDOS,
  exameFeito,
  marcarExame,
  ordenarPedidos,
  situacao,
  type PedidoExame,
  type Tom,
} from "@/lib/pedidos-exame";
import { cn } from "@/lib/cn";

const COR: Record<Tom, string> = {
  perigo: "text-danger",
  alerta: "text-warn",
  normal: "text-subtle",
  feito: "text-success",
};

export function PedidosExame({ idosoId }: { idosoId: string }) {
  const supabase = createClient();
  const membership = useRole();
  const admin = !!membership?.admin;
  const [pedidos, setPedidos] = useState<PedidoExame[] | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [anotando, setAnotando] = useState(false);
  const [colocando, setColocando] = useState<"pedido" | "resultado" | null>(null);
  const [versao, setVersao] = useState(0);
  const [falha, setFalha] = useState<string | null>(null);

  useEffect(() => {
    const atualizar = () => setVersao((v) => v + 1);
    window.addEventListener(EVENTO_PEDIDOS, atualizar);
    window.addEventListener("focus", atualizar);
    return () => {
      window.removeEventListener(EVENTO_PEDIDOS, atualizar);
      window.removeEventListener("focus", atualizar);
    };
  }, []);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const { data, error } = await supabase
        .from("pedido_exame")
        .select(COLUNAS_PEDIDO)
        .eq("idoso_id", idosoId)
        .neq("status", "cancelado")
        .order("created_at", { ascending: false })
        .limit(60);
      if (cancelado) return;
      setFalha(error ? "Não consegui carregar os exames. Confira a internet." : null);
      setPedidos(ordenarPedidos((data ?? []) as PedidoExame[]));
    })();
    return () => {
      cancelado = true;
    };
  }, [supabase, idosoId, versao]);

  if (colocando) {
    const fechar = () => {
      setColocando(null);
      setVersao((v) => v + 1);
    };
    return (
      <div className="flex flex-col gap-3">
        <button type="button" onClick={fechar} className="inline-flex h-11 w-fit items-center gap-2 rounded-lg border border-line bg-card px-4 text-base font-medium text-ink hover:bg-panel">
          <span aria-hidden>←</span> Todos os exames
        </button>
        {colocando === "pedido" ? (
          <EnviarFoto idosoId={idosoId} tipos={["pedido_exame"]} />
        ) : (
          <EnviarResultado idosoId={idosoId} onFim={fechar} />
        )}
      </div>
    );
  }

  if (!pedidos) return <p className="text-base text-subtle">Carregando...</p>;

  const escolhido = pedidos.find((p) => p.id === aberto);
  if (escolhido) {
    return <Detalhe key={escolhido.id} idosoId={idosoId} pedido={escolhido} admin={admin} onVoltar={() => setAberto(null)} />;
  }

  const abertos = pedidos.filter((p) => p.status !== "concluido");
  const concluidos = pedidos.filter((p) => p.status === "concluido");

  const linha = (p: PedidoExame) => {
    const s = situacao(p);
    return (
      <button
        key={p.id}
        type="button"
        onClick={() => setAberto(p.id)}
        className={cn(
          "flex min-h-[76px] w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left",
          s.tom === "perigo" ? "border-danger bg-danger/10" : "border-line bg-card hover:bg-panel",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-semibold leading-tight text-ink">{p.exames.join(", ")}</span>
          <span className={cn("block text-base font-medium", COR[s.tom])}>{s.texto}</span>
        </span>
        <span className="text-2xl text-subtle" aria-hidden>›</span>
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ["pedido", "Colocar pedido de exame"],
            ["resultado", "Colocar resultado de exame"],
          ] as const
        ).map(([qual, rotulo]) => (
          <button key={qual} type="button" onClick={() => setColocando(qual)} className="min-h-[76px] rounded-2xl border-2 border-primary bg-card px-3 text-lg font-semibold leading-tight text-ink hover:bg-panel">
            {rotulo}
          </button>
        ))}
      </div>
      {falha && <p className="text-base text-danger" role="alert">{falha}</p>}
      {!falha && abertos.length === 0 && <p className="text-base text-subtle">Nenhum exame para fazer agora.</p>}
      {abertos.map(linha)}

      {admin && !anotando && <Button onClick={() => setAnotando(true)} className="h-11">Anotar um pedido à mão</Button>}
      {admin && anotando && <Anotar idosoId={idosoId} onFim={() => setAnotando(false)} />}

      {concluidos.length > 0 && (
        <details>
          <summary className="cursor-pointer py-2 text-base font-medium text-subtle">Concluídos ({concluidos.length})</summary>
          <div className="mt-2 flex flex-col gap-3">{concluidos.map(linha)}</div>
        </details>
      )}
    </div>
  );
}

function Detalhe({ idosoId, pedido, admin, onVoltar }: { idosoId: string; pedido: PedidoExame; admin: boolean; onVoltar: () => void }) {
  const supabase = createClient();
  const [marcando, setMarcando] = useState(false);
  const [mandando, setMandando] = useState(false);
  const [conferindo, setConferindo] = useState(false);
  const soCuida = useRole()?.role === "cuidador" && !admin;
  // quem já foi chamado para conferir (para não pedir duas vezes)
  const [chamado, setChamado] = useState<string | null>(null);

  useEffect(() => {
    if (!soCuida || pedido.status !== "resultado_enviado") return;
    let cancelado = false;
    (async () => {
      const cliente = createClient();
      const { data } = await cliente
        .from("pedido_familia")
        .select("destinatario_id")
        .eq("pedido_exame_id", pedido.id)
        .in("status", ["aberto", "assumido"])
        .maybeSingle();
      if (!data) {
        if (!cancelado) setChamado(null);
        return;
      }
      const { data: u } = data.destinatario_id
        ? await cliente.from("usuario").select("nome").eq("id", data.destinatario_id as string).maybeSingle()
        : { data: null };
      if (!cancelado) setChamado((u?.nome as string) || "a família toda");
    })();
    return () => {
      cancelado = true;
    };
  }, [soCuida, pedido.id, pedido.status, conferindo]);
  const [cancelando, setCancelando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const s = situacao(pedido);

  async function fazer(acao: () => Promise<{ erro: string } | string | null>) {
    setOcupado(true);
    setErro(null);
    const r = await acao();
    setOcupado(false);
    setErro(typeof r === "string" ? r : r?.erro ?? null);
    return !r;
  }

  async function ver(documentoId: string) {
    const { data } = await supabase.from("documento").select("arquivo_url").eq("id", documentoId).maybeSingle();
    setErro(data ? await abrirArquivo(supabase, "documentos", data.arquivo_url as string) : "Não encontrei o arquivo.");
  }

  const grande = "h-16 text-xl";
  const medio = "h-14 text-lg";
  const aberto = pedido.status !== "concluido";

  if (conferindo) {
    return <QuemConfere idosoId={idosoId} pedidoId={pedido.id} onFim={() => setConferindo(false)} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={onVoltar} className="inline-flex h-11 w-fit items-center gap-2 rounded-lg border border-line bg-card px-4 text-base font-medium text-ink hover:bg-panel">
        <span aria-hidden>←</span> Todos os exames
      </button>
      <div>
        <h2 className="text-2xl font-bold leading-tight text-ink">{pedido.exames.join(", ")}</h2>
        <p className={cn("text-lg font-semibold", COR[s.tom])}>{s.texto}</p>
        {pedido.laboratorio && <p className="text-base text-subtle">{pedido.laboratorio}</p>}
      </div>
      {(pedido.status === "falta_marcar" || pedido.status === "marcado") && (
        <div className="rounded-2xl bg-panel p-4">
          <p className="text-lg text-ink">
            {pedido.preparo ? `Preparo no papel: ${pedido.preparo}` : "O papel não fala de preparo. Confirme com o laboratório."}
          </p>
          <p className="mt-1 text-base text-subtle">No dia, levar o pedido, a carteirinha do plano e o RG.</p>
        </div>
      )}
      {erro && <p className="text-base text-danger" role="alert">{erro}</p>}

      {marcando ? (
        <Marcar
          pedido={pedido}
          ocupado={ocupado}
          onCancelar={() => setMarcando(false)}
          onGuardar={async (dia, hora, lab) => {
            if (await fazer(() => marcarExame(supabase, pedido.id, dia, hora, lab))) setMarcando(false);
          }}
        />
      ) : (
        <>
          {pedido.status === "falta_marcar" && (
            <>
              <Button variant="primary" disabled={ocupado} onClick={() => fazer(() => marcarExame(supabase, pedido.id, null))} className={grande}>
                Já está marcado
              </Button>
              <Button disabled={ocupado} onClick={() => setMarcando(true)} className={medio}>Dizer o dia</Button>
            </>
          )}
          {pedido.status === "marcado" && (
            <>
              {!pedido.dia && (
                <Button variant="primary" disabled={ocupado} onClick={() => setMarcando(true)} className={grande}>Dizer o dia</Button>
              )}
              <Button variant={pedido.dia ? "primary" : "secondary"} disabled={ocupado} onClick={() => fazer(() => exameFeito(supabase, pedido.id))} className={medio}>
                Já fiz o exame
              </Button>
              {pedido.dia && <Button disabled={ocupado} onClick={() => setMarcando(true)} className={medio}>Mudar o dia</Button>}
            </>
          )}
          {(pedido.status === "falta_marcar" || pedido.status === "marcado") && !mandando && (
            <Button variant="ghost" disabled={ocupado} onClick={() => setMandando(true)} className="h-14 text-lg">
              Já tenho o resultado
            </Button>
          )}
          {(pedido.status === "feito" || (mandando && pedido.status !== "resultado_enviado")) && (
            <EscolherArquivoDoResultado
              ocupado={ocupado}
              onEscolher={(arquivo) =>
                fazer(async () => {
                  const r = await enviarResultado(supabase, idosoId, pedido.id, arquivo);
                  if ("erro" in r) return r.erro;
                  if (soCuida) setConferindo(true);
                  return null;
                })
              }
            />
          )}
        </>
      )}

      {soCuida && pedido.status === "resultado_enviado" &&
        (chamado ? (
          <p className="rounded-2xl bg-panel p-4 text-lg text-ink">Você pediu para {chamado} conferir os valores.</p>
        ) : (
          <Button variant="primary" onClick={() => setConferindo(true)} className={grande}>Conferir os valores</Button>
        ))}

      {pedido.resultado_documento_id && (
        <Button variant="primary" onClick={() => ver(pedido.resultado_documento_id as string)} className={medio}>
          Ver o resultado
        </Button>
      )}
      {admin && pedido.status === "resultado_enviado" && (
        <>
          <Link
            href={`/exames?documento=${pedido.resultado_documento_id}&pedido=${pedido.id}`}
            className="flex min-h-14 items-center justify-center rounded-lg border-2 border-primary text-lg font-medium text-ink"
          >
            Ler os valores e concluir
          </Link>
          <Button variant="ghost" disabled={ocupado} onClick={() => fazer(() => encerrarExame(supabase, pedido.id))} className="h-11">
            Concluir sem ler os valores
          </Button>
        </>
      )}
      {pedido.documento_id && (
        <Button onClick={() => ver(pedido.documento_id as string)} className={medio}>Ver a foto do pedido</Button>
      )}

      {admin && aberto && !cancelando && (
        <Button variant="ghost" onClick={() => setCancelando(true)} className="h-11 text-danger">Cancelar este pedido</Button>
      )}
      {cancelando && (
        <div className="flex flex-col gap-2 rounded-xl border border-danger/50 p-3">
          <p className="text-base text-ink">O pedido sai da lista, junto com a tarefa e o lembrete. Quem cuida é avisado.</p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              disabled={ocupado}
              className="h-12 text-danger"
              onClick={async () => {
                if (await fazer(() => encerrarExame(supabase, pedido.id, true))) onVoltar();
              }}
            >
              Sim, cancelar
            </Button>
            <Button onClick={() => setCancelando(false)} className="h-12">Voltar</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Marcar({
  pedido,
  ocupado,
  onGuardar,
  onCancelar,
}: {
  pedido: PedidoExame;
  ocupado: boolean;
  onGuardar: (dia: string, hora: string, lab: string) => void;
  onCancelar: () => void;
}) {
  const [dia, setDia] = useState(pedido.dia ?? "");
  const [hora, setHora] = useState(pedido.hora ?? "");
  const [lab, setLab] = useState(pedido.laboratorio ?? "");
  const hoje = hojeBR();
  const valido = !!dia && dia >= hoje;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border-2 border-primary bg-card p-4">
      <p className="text-xl font-semibold text-ink">Quando é o exame?</p>
      <label className="flex flex-col gap-1 text-base text-subtle">
        Dia
        <Input type="date" min={hoje} value={dia} onChange={(e) => setDia(e.target.value)} className="h-14 text-lg" />
      </label>
      <label className="flex flex-col gap-1 text-base text-subtle">
        Hora (se souber)
        <Input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className="h-14 text-lg" />
      </label>
      <label className="flex flex-col gap-1 text-base text-subtle">
        Laboratório (se souber)
        <Input value={lab} maxLength={120} onChange={(e) => setLab(e.target.value)} className="h-14 text-lg" />
      </label>
      <Button variant="primary" disabled={ocupado || !valido} onClick={() => onGuardar(dia, hora, lab.trim())} className="h-16 text-xl">
        Guardar
      </Button>
      <Button variant="ghost" onClick={onCancelar} className="h-12 text-base">Voltar</Button>
    </div>
  );
}

function Anotar({ idosoId, onFim }: { idosoId: string; onFim: () => void }) {
  const [exames, setExames] = useState("");
  const [preparo, setPreparo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function guardar() {
    setOcupado(true);
    const { error } = await createClient().rpc("anotar_pedido_exame", {
      p_idoso: idosoId,
      p_exames: exames.split("\n"),
      p_preparo: preparo,
    });
    setOcupado(false);
    if (error) {
      setErro("Não consegui anotar. Escreva ao menos um exame.");
      return;
    }
    window.dispatchEvent(new Event(EVENTO_PEDIDOS));
    onFim();
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-4">
      <label className="flex flex-col gap-1 text-sm text-subtle">
        Exames (um por linha)
        <textarea value={exames} onChange={(e) => setExames(e.target.value)} rows={3} className="rounded-lg border border-line bg-card p-3 text-base text-ink" />
      </label>
      <label className="flex flex-col gap-1 text-sm text-subtle">
        Preparo escrito no pedido (opcional)
        <Input value={preparo} maxLength={1000} onChange={(e) => setPreparo(e.target.value)} />
      </label>
      {erro && <p className="text-sm text-danger" role="alert">{erro}</p>}
      <div className="flex gap-2">
        <Button variant="primary" disabled={ocupado || !exames.trim()} onClick={guardar}>Anotar</Button>
        <Button variant="ghost" onClick={onFim}>Cancelar</Button>
      </div>
    </div>
  );
}
