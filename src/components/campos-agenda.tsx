"use client";

import { Button, Input } from "@/components/ui";
import { DIAS_CURTOS, type Agenda, type Frequencia } from "@/lib/medicacao";
import { cn } from "@/lib/cn";

const FREQUENCIAS: { valor: Frequencia; rotulo: string }[] = [
  { valor: "diaria", rotulo: "Todo dia" },
  { valor: "semana", rotulo: "Alguns dias da semana" },
  { valor: "intervalo", rotulo: "A cada tantos dias" },
  { valor: "quando_precisar", rotulo: "Só quando precisar" },
];

const caixa = "h-10 rounded-lg border border-line bg-card px-2 text-sm text-ink";

export function CamposAgenda({ valor, onChange }: { valor: Agenda; onChange: (a: Agenda) => void }) {
  const muda = (parcial: Partial<Agenda>) => onChange({ ...valor, ...parcial });

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm text-subtle">
        Frequência
        <select value={valor.frequencia} onChange={(e) => muda({ frequencia: e.target.value as Frequencia })} className={caixa}>
          {FREQUENCIAS.map((f) => (
            <option key={f.valor} value={f.valor}>{f.rotulo}</option>
          ))}
        </select>
      </label>

      {valor.frequencia === "semana" && (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm text-subtle">Em quais dias</legend>
          <div className="flex flex-wrap gap-1">
            {DIAS_CURTOS.map((d, i) => {
              const marcado = valor.dias_semana.includes(i);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={marcado}
                  onClick={() =>
                    muda({ dias_semana: marcado ? valor.dias_semana.filter((x) => x !== i) : [...valor.dias_semana, i] })
                  }
                  className={cn(
                    "h-10 min-w-12 rounded-lg border px-2 text-sm",
                    marcado ? "border-primary bg-primary text-white" : "border-line bg-card text-ink",
                  )}
                >
                  {d}
                </button>
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

      {valor.frequencia !== "quando_precisar" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-subtle">Horários</p>
          {valor.horarios.length === 0 && (
            <p className="text-xs text-subtle">Sem horário definido: conta como uma dose no dia.</p>
          )}
          {valor.horarios.map((h, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="time"
                aria-label={`Horário ${i + 1}`}
                value={h}
                onChange={(e) => muda({ horarios: valor.horarios.map((x, j) => (j === i ? e.target.value : x)) })}
                className={cn(caixa, "w-32")}
              />
              <Button type="button" variant="ghost" onClick={() => muda({ horarios: valor.horarios.filter((_, j) => j !== i) })} className="h-10 px-2 text-xs">
                Tirar
              </Button>
            </div>
          ))}
          <div>
            <Button type="button" onClick={() => muda({ horarios: [...valor.horarios, ""] })} className="h-9 px-3 text-xs">
              + Adicionar horário
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-subtle">
          Começa em
          <Input type="date" value={valor.inicio} onChange={(e) => muda({ inicio: e.target.value || valor.inicio })} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-subtle">
          Termina em (vazio = sem data para acabar)
          <Input type="date" value={valor.fim ?? ""} onChange={(e) => muda({ fim: e.target.value || null })} />
        </label>
      </div>
    </div>
  );
}
