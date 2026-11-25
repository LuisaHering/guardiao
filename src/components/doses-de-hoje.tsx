"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, Card } from "@/components/ui";
import {
  COLUNAS_DOSE,
  COLUNAS_REMEDIO,
  dosesDoDia,
  emUso,
  hojeBR,
  horaBR,
  jaChegou,
  MOTIVOS,
  rotuloDoMotivo,
  rotuloHorario,
  TOLERANCIA_MIN,
  type Dose,
  type RegistroDose,
  type Remedio,
} from "@/lib/medicacao";
import { cn } from "@/lib/cn";

const chaveDe = (d: Dose) => `${d.remedio.id}|${d.horario}`;

/** Os remédios de hoje, dose a dose: as pendentes em cima, as já marcadas em cinza embaixo. */
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
  // chaves das doses que o "Dei todos" vai marcar, enquanto a pessoa confere a lista
  const [conferindo, setConferindo] = useState<string[] | null>(null);

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
        deleted_at: null,
      },
      { onConflict: "medicacao_id,data,horario" },
    );
    if (error) setErro("Não consegui registrar. Confira a conexão e tente de novo.");
    setAberta(null);
    setPerguntandoMotivo(null);
    setOcupado(false);
    setRecarga((r) => r + 1);
  }

  async function desmarcar(d: Dose) {
    if (ocupado || !d.registro) return;
    setOcupado(true);
    setErro(null);
    const { error } = await supabase
      .from("registro_medicacao")
      .update({ deleted_at: new Date().toISOString() })
      .eq("medicacao_id", d.remedio.id)
      .eq("data", hoje)
      .eq("horario", d.registro.horario);
    if (error) setErro("Não consegui desmarcar. Tente de novo.");
    setAberta(null);
    setOcupado(false);
    setRecarga((r) => r + 1);
  }

  /**
   * Marca como dadas só as doses que a pessoa acabou de conferir. Antes, relê o banco: se
   * outra pessoa marcou alguma nesse meio-tempo, ela fica como está.
   */
  async function darTodos(chaves: string[]) {
    if (ocupado) return;
    setOcupado(true);
    setErro(null);
    const { data: auth } = await supabase.auth.getUser();
    const { data: atuais, error: falhaLeitura } = await supabase
      .from("registro_medicacao")
      .select(COLUNAS_DOSE)
      .in("medicacao_id", remedios.map((m) => m.id))
      .eq("data", hoje)
      .is("deleted_at", null);
    if (falhaLeitura) {
      setErro("Não consegui conferir os registros. Nada foi marcado.");
      setOcupado(false);
      return;
    }
    const livres = dosesDoDia(remedios, (atuais ?? []) as unknown as RegistroDose[], hoje).filter(
      (d) => !d.registro && chaves.includes(chaveDe(d)),
    );
    if (livres.length) {
      const agora = new Date().toISOString();
      const { error } = await supabase.from("registro_medicacao").upsert(
        livres.map((d) => ({
          medicacao_id: d.remedio.id,
          data: hoje,
          horario: d.horario,
          status: "dada",
          motivo: null,
          registrado_por: auth.user?.id ?? null,
          registrado_em: agora,
          deleted_at: null,
        })),
        { onConflict: "medicacao_id,data,horario" },
      );
      if (error) setErro("Não consegui registrar. Confira a conexão e tente de novo.");
    }
    setConferindo(null);
    setOcupado(false);
    setRecarga((r) => r + 1);
  }

  async function doseAvulsa(r: Remedio) {
    const ja = registros.filter((x) => x.medicacao_id === r.id).map((x) => x.horario).sort();
    if (ja.length && !window.confirm(`${r.nome} já foi registrado hoje às ${ja.join(", ")}. Registrar mais uma dose?`)) {
      return;
    }
    await gravar(r.id, horaBR(), "dada", null);
  }

  if (carregando) return <p className="text-sm text-subtle">Carregando os remédios de hoje...</p>;

  const doses = dosesDoDia(remedios, registros, hoje);
  const pendentes = doses.filter((d) => !d.registro);
  const marcadas = doses.filter((d) => d.registro);
  const feitas = marcadas.length;
  // "Dei todos" nunca alcança dose de mais tarde: de manhã não se marca a da noite.
  const agora = horaBR();
  // Em lote a folga é menor (30 min) que na conversa: um toque marca várias doses de uma vez.
  const deAgora = pendentes.filter((d) => jaChegou(d.horario, agora, TOLERANCIA_MIN));
  const deMaisTarde = pendentes.length - deAgora.length;
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
          <h2 className="text-lg font-semibold text-ink">Remédios de hoje</h2>
          {doses.length > 0 && (
            <span className="text-sm text-subtle">
              {feitas} de {doses.length}
            </span>
          )}
        </div>
        {doses.length > 0 && (
          <div
            className="h-2 overflow-hidden rounded-full bg-panel"
            role="progressbar"
            aria-label="Doses marcadas hoje"
            aria-valuemin={0}
            aria-valuemax={doses.length}
            aria-valuenow={feitas}
          >
            <div className="h-full rounded-full bg-success transition-all duration-300" style={{ width: `${(feitas / doses.length) * 100}%` }} />
          </div>
        )}
        {erro && <p className="text-sm text-danger" role="alert">{erro}</p>}
        {doses.length === 0 && <p className="text-sm text-subtle">Nenhuma dose prevista para hoje.</p>}
        {doses.length > 0 && pendentes.length === 0 && (
          <p className="rounded-xl bg-success/10 px-3 py-3 text-center text-base font-medium text-success">
            ✓ Tudo de hoje está marcado
          </p>
        )}

        {deAgora.length >= 2 && !conferindo && (
          <Button variant="primary" disabled={ocupado} onClick={() => setConferindo(deAgora.map(chaveDe))} className="h-14 w-full text-base">
            ✓ Dei todos de agora ({deAgora.length})
          </Button>
        )}
        {conferindo && (
          <div className="flex flex-col gap-3 rounded-xl border-2 border-primary p-3" role="group" aria-label="Conferir antes de marcar">
            <p className="text-base font-medium text-ink">Você deu todos estes?</p>
            <ul className="flex flex-col gap-1">
              {pendentes
                .filter((d) => conferindo.includes(chaveDe(d)))
                .map((d) => (
                  <li key={chaveDe(d)} className="text-base text-ink">
                    • {d.remedio.nome}
                    {d.remedio.dosagem ? ` ${d.remedio.dosagem}` : ""}
                    {d.horario ? <span className="text-subtle"> ({rotuloHorario(d.horario).toLowerCase()})</span> : null}
                  </li>
                ))}
            </ul>
            {deMaisTarde > 0 && (
              <p className="text-sm text-subtle">
                {deMaisTarde === 1 ? "1 dose de mais tarde não entra." : `${deMaisTarde} doses de mais tarde não entram.`}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="primary" disabled={ocupado} onClick={() => darTodos(conferindo)} className="h-12 text-base">
                {ocupado ? "Marcando..." : "Sim, dei todos"}
              </Button>
              <Button disabled={ocupado} onClick={() => setConferindo(null)} className="h-12 text-base">
                Não, voltar
              </Button>
            </div>
          </div>
        )}

        {pendentes.map((d) => {
          const k = chaveDe(d);
          return (
            <div
              key={k}
              className={cn("flex flex-col gap-3 rounded-xl border-2 bg-card p-3", d.atrasada ? "border-warn/70" : "border-line")}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-lg font-semibold leading-tight text-ink">{d.remedio.nome}</p>
                  <p className="text-sm text-subtle">
                    {[d.remedio.dosagem, d.remedio.instrucoes].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {(d.horario || d.atrasada) && (
                  <span
                    className={cn(
                      "shrink-0 rounded-lg px-2.5 py-1 text-center text-base font-semibold tabular-nums",
                      d.atrasada ? "bg-warn/15 text-warn" : "bg-primary-soft text-primary",
                    )}
                  >
                    {rotuloHorario(d.horario)}
                    {d.atrasada && <span className="block text-xs font-medium">atrasado</span>}
                  </span>
                )}
              </div>
              {perguntandoMotivo === k ? (
                <Motivos
                  ocupado={ocupado}
                  onEscolher={(m) => gravar(d.remedio.id, d.horario, "nao_dada", m)}
                  onVoltar={() => setPerguntandoMotivo(null)}
                />
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="primary" disabled={ocupado} onClick={() => gravar(d.remedio.id, d.horario, "dada", null)} className="h-12 text-base">
                    ✓ Dei
                  </Button>
                  <Button disabled={ocupado} onClick={() => setPerguntandoMotivo(k)} className="h-12 text-base">
                    Não dei
                  </Button>
                </div>
              )}
            </div>
          );
        })}

        {marcadas.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-subtle">Já marcados</p>
            {marcadas.map((d) => {
              const k = chaveDe(d);
              const reg = d.registro as RegistroDose;
              const naoDada = reg.status === "nao_dada";
              const editando = aberta === k;
              return (
                <div key={k} className="flex flex-col gap-2 rounded-xl bg-panel px-3 py-2.5">
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                        naoDada ? "bg-warn/20 text-warn" : "bg-subtle/25 text-subtle",
                      )}
                      aria-hidden
                    >
                      {naoDada ? "!" : "✓"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-subtle">
                        {d.remedio.nome}
                        {d.remedio.dosagem ? ` ${d.remedio.dosagem}` : ""}
                      </p>
                      <p className={cn("text-xs", naoDada ? "font-medium text-warn" : "text-subtle")}>
                        {d.horario ? `${rotuloHorario(d.horario)} · ` : ""}
                        {naoDada ? `Não dado: ${rotuloDoMotivo(reg.motivo).toLowerCase()}` : "Dado"}
                        {reg.registrado_por && nomes[reg.registrado_por] ? ` · ${nomes[reg.registrado_por]}` : ""}
                        {reg.registrado_em ? ` às ${horaBR(new Date(reg.registrado_em))}` : ""}
                        {d.horarioAntigo ? ` · no horário antigo (${rotuloHorario(reg.horario)})` : ""}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      aria-expanded={editando}
                      onClick={() => { setAberta(editando ? null : k); setPerguntandoMotivo(null); }}
                      className="h-10 shrink-0 px-2 text-xs text-subtle"
                    >
                      {editando ? "Fechar" : "Corrigir"}
                    </Button>
                  </div>
                  {editando &&
                    (perguntandoMotivo === k ? (
                      <Motivos
                        ocupado={ocupado}
                        onEscolher={(m) => gravar(d.remedio.id, reg.horario, "nao_dada", m)}
                        onVoltar={() => setPerguntandoMotivo(null)}
                      />
                    ) : (
                      // Corrigir usa o horário do PRÓPRIO registro, para alterar a mesma linha.
                      <div className="grid grid-cols-3 gap-2">
                        <Button disabled={ocupado} onClick={() => gravar(d.remedio.id, reg.horario, "dada", null)} className="h-11">
                          Dei
                        </Button>
                        <Button disabled={ocupado} onClick={() => setPerguntandoMotivo(k)} className="h-11">
                          Não dei
                        </Button>
                        <Button variant="ghost" disabled={ocupado} onClick={() => desmarcar(d)} className="h-11">
                          Desmarcar
                        </Button>
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
        )}
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

function Motivos({
  ocupado,
  onEscolher,
  onVoltar,
}: {
  ocupado: boolean;
  onEscolher: (motivo: string) => void;
  onVoltar: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-subtle">Por que não foi dado?</p>
      <div className="grid grid-cols-2 gap-2">
        {MOTIVOS.map((m) => (
          <Button key={m.valor} disabled={ocupado} onClick={() => onEscolher(m.valor)} className="h-12">
            {m.rotulo}
          </Button>
        ))}
        <Button variant="ghost" onClick={onVoltar} className="h-12">Voltar</Button>
      </div>
    </div>
  );
}
