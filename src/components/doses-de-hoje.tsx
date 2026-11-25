"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Badge, Button, Card } from "@/components/ui";
import {
  COLUNAS_DOSE,
  COLUNAS_REMEDIO,
  dosesDoDia,
  emUso,
  hojeBR,
  horaBR,
  MOTIVOS,
  rotuloDoMotivo,
  rotuloHorario,
  type Dose,
  type RegistroDose,
  type Remedio,
} from "@/lib/medicacao";
import { cn } from "@/lib/cn";

const chaveDe = (d: Dose) => `${d.remedio.id}|${d.horario}`;

/** Os remédios de hoje, dose a dose. Cada marcação é um registro; nada é marcado em lote. */
export function DosesDeHoje({ idosoId, versao = 0 }: { idosoId: string; versao?: number }) {
  const supabase = createClient();
  const [remedios, setRemedios] = useState<Remedio[]>([]);
  const [registros, setRegistros] = useState<RegistroDose[]>([]);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [carregando, setCarregando] = useState(true);
  const [recarga, setRecarga] = useState(0);
  const [aberta, setAberta] = useState<string | null>(null);
  const [perguntandoMotivo, setPerguntandoMotivo] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const hoje = hojeBR();

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const { data: ms } = await supabase
        .from("medicacao")
        .select(COLUNAS_REMEDIO)
        .eq("idoso_id", idosoId)
        .eq("ativo", true)
        .is("deleted_at", null)
        .order("nome");
      const lista = (ms ?? []) as unknown as Remedio[];
      const { data: rs } = lista.length
        ? await supabase
            .from("registro_medicacao")
            .select(COLUNAS_DOSE)
            .in("medicacao_id", lista.map((m) => m.id))
            .eq("data", hoje)
            .is("deleted_at", null)
        : { data: [] };
      const regs = (rs ?? []) as unknown as RegistroDose[];
      const autores = [...new Set(regs.map((r) => r.registrado_por).filter(Boolean))] as string[];
      const { data: us } = autores.length
        ? await supabase.from("usuario").select("id, nome").in("id", autores)
        : { data: [] };
      if (cancelado) return;
      setRemedios(lista);
      setRegistros(regs);
      setNomes(Object.fromEntries((us ?? []).map((u) => [u.id as string, ((u.nome as string) ?? "").split(" ")[0]])));
      setCarregando(false);
    })();
    return () => {
      cancelado = true;
    };
  }, [supabase, idosoId, hoje, versao, recarga]);

  async function gravar(remedioId: string, horario: string, status: "dada" | "nao_dada", motivo: string | null) {
    if (ocupado) return;
    setOcupado(true);
    setErro(null);
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase.from("registro_medicacao").upsert(
      {
        medicacao_id: remedioId,
        data: hoje,
        horario,
        status,
        motivo,
        registrado_por: auth.user?.id ?? null,
        registrado_em: new Date().toISOString(),
      },
      { onConflict: "medicacao_id,data,horario" },
    );
    if (error) setErro("Não consegui registrar. Confira a conexão e tente de novo.");
    setAberta(null);
    setPerguntandoMotivo(null);
    setOcupado(false);
    setRecarga((r) => r + 1);
  }

  // Corrigir usa o horário do PRÓPRIO registro, para alterar a mesma linha em vez de criar outra.
  const horarioDe = (d: Dose) => d.registro?.horario ?? d.horario;

  async function doseAvulsa(r: Remedio) {
    const ja = registros.filter((x) => x.medicacao_id === r.id).map((x) => x.horario).sort();
    if (ja.length && !window.confirm(`${r.nome} já foi registrado hoje às ${ja.join(", ")}. Registrar mais uma dose?`)) {
      return;
    }
    await gravar(r.id, horaBR(), "dada", null);
  }

  if (carregando) return <p className="text-sm text-subtle">Carregando os remédios de hoje...</p>;

  const doses = dosesDoDia(remedios, registros, hoje);
  const feitas = doses.filter((d) => d.registro).length;
  const quandoPrecisar = remedios.filter((r) => r.frequencia === "quando_precisar" && emUso(r, hoje));
  const repor = remedios.filter((r) => registros.some((x) => x.medicacao_id === r.id && x.motivo === "acabou"));

  return (
    <div className="flex flex-col gap-3">
      {repor.length > 0 && (
        <Card className="border-warn/40 bg-warn/10">
          <p className="text-sm font-medium text-warn">Repor: {repor.map((r) => r.nome).join(", ")}</p>
          <p className="text-xs text-subtle">Marcado hoje como &quot;acabou&quot;.</p>
        </Card>
      )}

      <Card className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">Remédios de hoje</h2>
          {doses.length > 0 && (
            <span className="text-sm text-subtle">
              {feitas} de {doses.length} {doses.length === 1 ? "dose registrada" : "doses registradas"}
            </span>
          )}
        </div>
        {erro && <p className="text-sm text-danger" role="alert">{erro}</p>}
        {doses.length === 0 && <p className="text-sm text-subtle">Nenhuma dose prevista para hoje.</p>}

        {doses.map((d) => {
          const k = chaveDe(d);
          const reg = d.registro;
          const editando = aberta === k;
          const naoDada = reg?.status === "nao_dada";
          return (
            <div
              key={k}
              className={cn(
                "flex flex-col gap-2 rounded-lg border p-3",
                !reg ? (d.atrasada ? "border-warn/60" : "border-line") : naoDada ? "border-warn/40 bg-warn/5" : "border-success/40 bg-success/10",
              )}
            >
              <div className="flex items-start gap-3">
                {d.horario && (
                  <span className="w-16 shrink-0 text-lg font-semibold tabular-nums text-ink">{rotuloHorario(d.horario)}</span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-base font-medium text-ink">
                    {d.remedio.nome}
                    {d.remedio.dosagem ? <span className="font-normal text-subtle"> {d.remedio.dosagem}</span> : null}
                  </p>
                  {d.remedio.instrucoes && <p className="text-sm text-subtle">{d.remedio.instrucoes}</p>}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {!d.horario && <Badge tone="neutral">sem horário</Badge>}
                    {d.atrasada && <Badge tone="warn">atrasada</Badge>}
                    {!d.remedio.confirmado && <Badge tone="warn">aguardando confirmação</Badge>}
                  </div>
                </div>
              </div>

              {reg && !editando && (
                <div className="flex items-center justify-between gap-2">
                  <p className={cn("text-sm font-medium", naoDada ? "text-warn" : "text-success")}>
                    {naoDada ? `Não dado: ${rotuloDoMotivo(reg.motivo).toLowerCase()}` : "✓ Dado"}
                    <span className="font-normal text-subtle">
                      {reg.registrado_por && nomes[reg.registrado_por] ? ` · ${nomes[reg.registrado_por]}` : ""}
                      {reg.registrado_em ? ` · marcado às ${horaBR(new Date(reg.registrado_em))}` : ""}
                      {d.horarioAntigo ? ` · no horário antigo (${rotuloHorario(reg.horario)})` : ""}
                    </span>
                  </p>
                  <Button variant="ghost" onClick={() => { setAberta(k); setPerguntandoMotivo(null); }} className="h-10 shrink-0 px-3 text-sm">
                    Corrigir
                  </Button>
                </div>
              )}

              {(!reg || editando) && perguntandoMotivo !== k && (
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="primary" disabled={ocupado} onClick={() => gravar(d.remedio.id, horarioDe(d), "dada", null)} className="h-12 text-base">
                    ✓ Dei
                  </Button>
                  <Button disabled={ocupado} onClick={() => setPerguntandoMotivo(k)} className="h-12 text-base">
                    Não dei
                  </Button>
                </div>
              )}

              {perguntandoMotivo === k && (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-subtle">Por que não foi dado?</p>
                  <div className="grid grid-cols-2 gap-2">
                    {MOTIVOS.map((m) => (
                      <Button key={m.valor} disabled={ocupado} onClick={() => gravar(d.remedio.id, horarioDe(d), "nao_dada", m.valor)} className="h-12">
                        {m.rotulo}
                      </Button>
                    ))}
                    <Button variant="ghost" onClick={() => setPerguntandoMotivo(null)} className="h-12">Voltar</Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </Card>

      {quandoPrecisar.length > 0 && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-ink">Só quando precisar</h2>
          {quandoPrecisar.map((r) => {
            const ja = registros.filter((x) => x.medicacao_id === r.id && x.status === "dada").map((x) => x.horario).sort();
            return (
              <div key={r.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-base text-ink">
                    {r.nome}
                    {r.dosagem ? <span className="text-subtle"> {r.dosagem}</span> : null}
                  </p>
                  <p className="text-sm text-subtle">
                    {ja.length ? `Dado hoje às ${ja.join(", ")}` : r.instrucoes || "Não foi dado hoje"}
                  </p>
                  {!r.confirmado && <Badge tone="warn">aguardando confirmação</Badge>}
                </div>
                <Button disabled={ocupado} onClick={() => doseAvulsa(r)} className="h-12 shrink-0">Dei agora</Button>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
