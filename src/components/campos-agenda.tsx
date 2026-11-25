"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";
import {
  DIAS_CURTOS,
  diasEntre,
  ehPeriodo,
  hojeBR,
  PERIODOS,
  somarDias,
  type Agenda,
  type Frequencia,
} from "@/lib/medicacao";
import { cn } from "@/lib/cn";

const FREQUENCIAS: { valor: Frequencia; rotulo: string }[] = [
  { valor: "diaria", rotulo: "Todo dia" },
  { valor: "semana", rotulo: "Alguns dias da semana" },
  { valor: "intervalo", rotulo: "A cada tantos dias" },
  { valor: "mensal", rotulo: "Todo mês, ou a cada tantos meses" },
  { valor: "unica", rotulo: "Uma dose só" },
  { valor: "quando_precisar", rotulo: "Só quando precisar" },
];

const caixa = "h-10 rounded-lg border border-line bg-card px-2 text-sm text-ink";

/** Botão de escolha: grande, e o marcado fica preenchido. */
function Opcao({ marcada, onClick, children }: { marcada: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={marcada}
      onClick={onClick}
      className={cn(
        "min-h-11 rounded-lg border px-1 text-[13px] font-medium transition-colors sm:text-sm",
        marcada ? "border-primary bg-primary text-white" : "border-line bg-card text-ink hover:bg-panel",
      )}
    >
      {children}
    </button>
  );
}

const diaMesAno = (iso: string) => iso.split("-").reverse().join("/");

type Duracao = "continuo" | "dias" | "data";

export function CamposAgenda({ valor, onChange }: { valor: Agenda; onChange: (a: Agenda) => void }) {
  const muda = (parcial: Partial<Agenda>) => onChange({ ...valor, ...parcial });
  const hoje = hojeBR();

  const [modoHora, setModoHora] = useState<"periodo" | "hora">(
    valor.horarios.some((h) => !ehPeriodo(h)) ? "hora" : "periodo",
  );
  const [duracao, setDuracao] = useState<Duracao>(valor.fim ? "data" : "continuo");
  const [quantosDias, setQuantosDias] = useState("");
  const [mudandoInicio, setMudandoInicio] = useState(false);

  // Trocar de modo limpa o outro: "manhã" junto com "08:00" criaria duas doses sem querer.
  function escolherModo(modo: "periodo" | "hora") {
    if (modo === modoHora) return;
    setModoHora(modo);
    muda({ horarios: modo === "hora" ? [""] : [] });
  }

  // Dias e meses usam o mesmo campo: trocar de tipo limpa o número. Dose única não tem duração.
  function trocarFrequencia(frequencia: Frequencia) {
    if (frequencia === "unica") {
      setDuracao("continuo");
      muda({ frequencia, intervalo_dias: null, fim: null });
    } else {
      muda({ frequencia, intervalo_dias: null });
    }
  }

  const fimPorDias = (dias: string, inicio: string) => {
    const n = Number(dias);
    return Number.isInteger(n) && n >= 1 && n <= 3650 ? somarDias(inicio, n - 1) : "";
  };

  function escolherDuracao(d: Duracao) {
    if (d === duracao) return;
    setDuracao(d);
    if (d === "continuo") muda({ fim: null });
    // "" = tem fim, mas ainda falta dizer qual (o formulário não deixa salvar assim).
    else if (d === "dias") muda({ fim: fimPorDias(quantosDias, valor.inicio) });
    else muda({ fim: valor.fim || "" });
  }

  function mudarInicio(inicio: string) {
    muda(duracao === "dias" ? { inicio, fim: fimPorDias(quantosDias, inicio) } : { inicio });
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm text-subtle">
        Frequência
        <select value={valor.frequencia} onChange={(e) => trocarFrequencia(e.target.value as Frequencia)} className={caixa}>
          {FREQUENCIAS.map((f) => (
            <option key={f.valor} value={f.valor}>{f.rotulo}</option>
          ))}
        </select>
      </label>

      {valor.frequencia === "semana" && (
        <fieldset>
          <legend className="mb-1 text-sm text-subtle">Em quais dias</legend>
          <div className="grid grid-cols-4 gap-1 sm:grid-cols-7">
            {DIAS_CURTOS.map((d, i) => {
              const marcado = valor.dias_semana.includes(i);
              return (
                <Opcao
                  key={d}
                  marcada={marcado}
                  onClick={() =>
                    muda({ dias_semana: marcado ? valor.dias_semana.filter((x) => x !== i) : [...valor.dias_semana, i] })
                  }
                >
                  {d}
                </Opcao>
              );
            })}
          </div>
        </fieldset>
      )}

      {valor.frequencia === "intervalo" && (
        <label className="flex flex-col gap-1 text-sm text-subtle">
          De quantos em quantos dias (a contar do início)
          <Input
            type="number"
            min={2}
            max={365}
            value={valor.intervalo_dias ?? ""}
            onChange={(e) => muda({ intervalo_dias: e.target.value ? Number(e.target.value) : null })}
            placeholder="2"
          />
        </label>
      )}

      {valor.frequencia === "mensal" && (
        <label className="flex flex-col gap-1 text-sm text-subtle">
          De quantos em quantos meses (vazio é todo mês)
          <Input
            type="number"
            min={1}
            max={24}
            value={valor.intervalo_dias ?? ""}
            onChange={(e) => muda({ intervalo_dias: e.target.value ? Number(e.target.value) : null })}
            placeholder="1"
          />
          <span className="text-xs">O dia do mês é o do primeiro dia, escolhido abaixo.</span>
        </label>
      )}

      {valor.frequencia !== "quando_precisar" && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm text-subtle">Quando tomar no dia</legend>
          <div className="grid grid-cols-2 gap-1">
            <Opcao marcada={modoHora === "periodo"} onClick={() => escolherModo("periodo")}>Por período</Opcao>
            <Opcao marcada={modoHora === "hora"} onClick={() => escolherModo("hora")}>Horário específico</Opcao>
          </div>

          {modoHora === "periodo" ? (
            <>
              <div className="grid grid-cols-3 gap-1">
                {PERIODOS.map((p) => {
                  const marcado = valor.horarios.includes(p.valor);
                  return (
                    <Opcao
                      key={p.valor}
                      marcada={marcado}
                      onClick={() =>
                        muda({ horarios: marcado ? valor.horarios.filter((x) => x !== p.valor) : [...valor.horarios, p.valor] })
                      }
                    >
                      {p.rotulo}
                    </Opcao>
                  );
                })}
              </div>
              <p className="text-xs text-subtle">
                Pode marcar mais de um: cada um vira uma dose. Sem marcar nada, conta uma dose no dia.
              </p>
            </>
          ) : (
            <>
              {valor.horarios.map((h, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="time"
                    aria-label={`Horário ${i + 1}`}
                    value={h}
                    onChange={(e) => muda({ horarios: valor.horarios.map((x, j) => (j === i ? e.target.value : x)) })}
                    className={cn(caixa, "h-11 w-36 text-base")}
                  />
                  {valor.horarios.length > 1 && (
                    <Button type="button" variant="ghost" onClick={() => muda({ horarios: valor.horarios.filter((_, j) => j !== i) })} className="h-11 px-2 text-xs">
                      Tirar
                    </Button>
                  )}
                </div>
              ))}
              <div>
                <Button type="button" onClick={() => muda({ horarios: [...valor.horarios, ""] })} className="h-9 px-3 text-xs">
                  + Outro horário
                </Button>
              </div>
            </>
          )}
        </fieldset>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm text-subtle">{valor.frequencia === "unica" ? "Dia para tomar" : "Por quanto tempo"}</legend>
        <div className={valor.frequencia === "unica" ? "hidden" : "grid grid-cols-1 gap-1 sm:grid-cols-3"}>
          <Opcao marcada={duracao === "continuo"} onClick={() => escolherDuracao("continuo")}>Sem data para acabar</Opcao>
          <Opcao marcada={duracao === "dias"} onClick={() => escolherDuracao("dias")}>Por alguns dias</Opcao>
          <Opcao marcada={duracao === "data"} onClick={() => escolherDuracao("data")}>Até uma data</Opcao>
        </div>

        {duracao === "dias" && (
          <label className="flex items-center gap-2 text-sm text-ink">
            Tomar por
            <input
              type="number"
              min={1}
              inputMode="numeric"
              value={quantosDias}
              onChange={(e) => {
                setQuantosDias(e.target.value);
                muda({ fim: fimPorDias(e.target.value, valor.inicio) });
              }}
              placeholder="7"
              className={cn(caixa, "w-20 text-center")}
            />
            dias
          </label>
        )}
        {duracao === "data" && (
          <label className="flex items-center gap-2 text-sm text-ink">
            Último dia
            <input type="date" min={valor.inicio} value={valor.fim ?? ""} onChange={(e) => muda({ fim: e.target.value })} className={caixa} />
          </label>
        )}
        {duracao !== "continuo" && valor.fim && valor.fim >= valor.inicio && (
          <p className="text-sm text-ink">
            Último dia: {diaMesAno(valor.fim)} ({diasEntre(valor.inicio, valor.fim) + 1}{" "}
            {valor.fim === valor.inicio ? "dia" : "dias"} no total)
          </p>
        )}

        {/* O começo quase sempre é hoje: fica em uma linha, e só abre se precisar mudar. */}
        <div className="flex flex-wrap items-center gap-2 text-sm text-subtle">
          {mudandoInicio ? (
            <label className="flex items-center gap-2">
              Primeiro dia
              <input type="date" value={valor.inicio} onChange={(e) => e.target.value && mudarInicio(e.target.value)} className={caixa} />
            </label>
          ) : (
            <>
              <span>
                {valor.inicio === hoje
                  ? "Começa hoje"
                  : `${valor.inicio > hoje ? "Começa" : "Começou"} em ${diaMesAno(valor.inicio)}`}
              </span>
              <button type="button" onClick={() => setMudandoInicio(true)} className="text-primary underline-offset-2 hover:underline">
                mudar
              </button>
            </>
          )}
        </div>
      </fieldset>
    </div>
  );
}
