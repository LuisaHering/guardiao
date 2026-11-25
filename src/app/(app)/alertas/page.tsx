"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Badge, Button, Card } from "@/components/ui";
import { EVENTO_ALERTAS } from "@/components/sino-alertas";

type Linha = {
  id: string;
  texto: string | null;
  lido_em: string | null;
  alerta: {
    id: string;
    titulo: string | null;
    tipo: string | null;
    severidade: "info" | "atencao" | "urgente" | null;
    natureza: "operacional" | "clinico" | null;
    gerado_em: string;
  } | null;
};

const SEVERIDADE: Record<string, { rotulo: string; tom: "neutral" | "warn" }> = {
  info: { rotulo: "informação", tom: "neutral" },
  atencao: { rotulo: "atenção", tom: "warn" },
  urgente: { rotulo: "urgente", tom: "warn" },
};

function quando(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AlertasPage() {
  const supabase = createClient();
  const membership = useRole();
  const idosoId = membership?.idosoId;

  const [carregando, setCarregando] = useState(true);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [soNaoLidos, setSoNaoLidos] = useState(true);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    if (!idosoId) {
      setCarregando(false);
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    // O silêncio de registro não tem agendador: é verificado quando alguém abre o app.
    await supabase.rpc("gerar_alertas_silencio", { p_idoso: idosoId });

    const { data } = await supabase
      .from("alerta_destinatario")
      .select(
        "id, texto, lido_em, alerta:alerta_id(id, titulo, tipo, severidade, natureza, gerado_em)",
      )
      .eq("usuario_id", user.id)
      .limit(200);

    const lista = ((data ?? []) as unknown as Linha[])
      .filter((l) => l.alerta)
      .sort(
        (a, b) =>
          new Date(b.alerta!.gerado_em).getTime() -
          new Date(a.alerta!.gerado_em).getTime(),
      );
    setLinhas(lista);
    setCarregando(false);
  }, [supabase, idosoId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function marcar(ids: string[]) {
    if (ids.length === 0) return;
    setOcupado(true);
    // A leitura é só minha: atualiza a minha linha, nunca a dos outros destinatários.
    await supabase
      .from("alerta_destinatario")
      .update({ lido_em: new Date().toISOString() })
      .in("id", ids);
    await carregar();
    window.dispatchEvent(new Event(EVENTO_ALERTAS));
    setOcupado(false);
  }

  if (!membership) {
    return (
      <p className="text-sm text-subtle">
        Crie o perfil do idoso primeiro para receber alertas.
      </p>
    );
  }

  const naoLidos = linhas.filter((l) => !l.lido_em);
  const visiveis = soNaoLidos ? naoLidos : linhas;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">{membership.role === "cuidador" ? "Avisos" : "Alertas"}</h1>
        <p className="text-sm text-subtle">
          Avisos sobre {membership.idosoNome} que pedem a sua atenção. Cada pessoa
          recebe o texto adequado ao seu papel, e marcar como lido vale só para você.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={soNaoLidos ? "primary" : "secondary"}
          onClick={() => setSoNaoLidos(true)}
          className="h-9 px-3 text-xs"
        >
          Não lidos ({naoLidos.length})
        </Button>
        <Button
          variant={!soNaoLidos ? "primary" : "secondary"}
          onClick={() => setSoNaoLidos(false)}
          className="h-9 px-3 text-xs"
        >
          Todos ({linhas.length})
        </Button>
        {naoLidos.length > 0 && (
          <Button
            variant="ghost"
            onClick={() => marcar(naoLidos.map((l) => l.id))}
            disabled={ocupado}
            className="ml-auto h-9 px-3 text-xs"
          >
            Marcar todos como lidos
          </Button>
        )}
      </div>

      {carregando && <p className="text-sm text-subtle">Carregando...</p>}

      {!carregando && visiveis.length === 0 && (
        <Card>
          <p className="text-sm text-ink">
            {soNaoLidos ? "Nenhum alerta novo." : "Nenhum alerta ainda."}
          </p>
          <p className="mt-1 text-sm text-subtle">
            Eles aparecem quando um exame confirmado traz resultado fora da faixa do
            laudo, quando uma alergia ou a medicação mudam, ou quando o registro de
            medicação fica parado.
          </p>
        </Card>
      )}

      {visiveis.map((l) => {
        const a = l.alerta!;
        const sev = SEVERIDADE[a.severidade ?? "info"];
        const lido = !!l.lido_em;
        return (
          <Card
            key={l.id}
            className={`flex flex-col gap-2 ${lido ? "opacity-70" : "border-primary/40"}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                {!lido && (
                  <span
                    className="h-2 w-2 shrink-0 rounded-full bg-primary"
                    aria-label="não lido"
                  />
                )}
                <p className={`text-sm text-ink ${lido ? "" : "font-semibold"}`}>
                  {a.titulo ?? "Alerta"}
                </p>
              </div>
              <Badge tone={sev.tom}>{sev.rotulo}</Badge>
            </div>
            <p className="text-sm text-ink">{l.texto}</p>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-subtle">
                {quando(a.gerado_em)} ·{" "}
                {a.natureza === "clinico" ? "clínico" : "operacional"}
                {lido && l.lido_em ? ` · lido em ${quando(l.lido_em)}` : ""}
              </p>
              {!lido && (
                <Button
                  variant="ghost"
                  onClick={() => marcar([l.id])}
                  disabled={ocupado}
                  className="h-8 px-2 text-xs"
                >
                  Marcar como lido
                </Button>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
