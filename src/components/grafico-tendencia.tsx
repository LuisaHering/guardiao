"use client";

import { useMemo, useState } from "react";

export type Ponto = {
  data: string; // ISO
  valor: number;
  refMin: number | null;
  refMax: number | null;
  laboratorio: string | null;
  convertidoDe: string | null; // ex: "5,5 mmol/L"
};

const W = 640;
const H = 292;
const M = { l: 52, r: 20, t: 28, b: 34 };
const PW = W - M.l - M.r;
const PH = H - M.t - M.b;

function fmt(n: number) {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function dataCurta(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

function passoBonito(faixa: number, alvo: number) {
  const bruto = faixa / alvo;
  const mag = Math.pow(10, Math.floor(Math.log10(bruto)));
  const n = bruto / mag;
  const f = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return f * mag;
}

function foraDaFaixa(p: Ponto) {
  if (p.refMin !== null && p.valor < p.refMin) return "abaixo da faixa";
  if (p.refMax !== null && p.valor > p.refMax) return "acima da faixa";
  return null;
}

export function GraficoTendencia({
  nome,
  unidade,
  pontos,
}: {
  nome: string;
  unidade: string;
  pontos: Ponto[];
}) {
  const [ativo, setAtivo] = useState<number | null>(null);
  const [tabela, setTabela] = useState(false);

  const g = useMemo(() => {
    const ordenados = [...pontos].sort(
      (a, b) => new Date(a.data).getTime() - new Date(b.data).getTime(),
    );
    const tempos = ordenados.map((p) => new Date(p.data).getTime());
    const t0 = Math.min(...tempos);
    const t1 = Math.max(...tempos);

    const x = (t: number) =>
      t1 === t0 ? M.l + PW / 2 : M.l + ((t - t0) / (t1 - t0)) * PW;

    const todos: number[] = [];
    for (const p of ordenados) {
      todos.push(p.valor);
      if (p.refMin !== null) todos.push(p.refMin);
      if (p.refMax !== null) todos.push(p.refMax);
    }
    let lo = Math.min(...todos);
    let hi = Math.max(...todos);
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    const folga = (hi - lo) * 0.12;
    lo -= folga;
    hi += folga;
    const passo = passoBonito(hi - lo, 4);
    const base = Math.floor(lo / passo) * passo;
    const topo = Math.ceil(hi / passo) * passo;
    const ticks: number[] = [];
    for (let v = base; v <= topo + passo / 2; v += passo) ticks.push(Number(v.toFixed(6)));

    const y = (v: number) => M.t + PH - ((v - base) / (topo - base)) * PH;
    const xs = ordenados.map((p) => x(new Date(p.data).getTime()));

    // Faixa de referencia pertence ao RESULTADO: cada ponto governa o trecho
    // ate o meio do caminho para os vizinhos. Sem faixa impressa, sem banda.
    const bandas = ordenados.map((p, i) => {
      if (p.refMin === null && p.refMax === null) return null;
      const esq = i === 0 ? M.l : (xs[i - 1] + xs[i]) / 2;
      const dir = i === ordenados.length - 1 ? M.l + PW : (xs[i] + xs[i + 1]) / 2;
      const yTop = p.refMax === null ? M.t : y(p.refMax);
      const yBase = p.refMin === null ? M.t + PH : y(p.refMin);
      return { esq, dir, yTop, yBase };
    });

    // ate 5 marcas de data no eixo X
    const marcas: { x: number; rotulo: string }[] = [];
    if (t1 === t0) {
      marcas.push({ x: x(t0), rotulo: dataCurta(new Date(t0).toISOString()) });
    } else {
      const n = Math.min(5, ordenados.length);
      for (let i = 0; i < n; i++) {
        const t = t0 + ((t1 - t0) * i) / (n - 1);
        marcas.push({ x: x(t), rotulo: dataCurta(new Date(t).toISOString()) });
      }
    }

    return { ordenados, xs, y, ticks, bandas, marcas };
  }, [pontos]);

  const n = g.ordenados.length;
  const caminho = g.ordenados
    .map((p, i) => `${i === 0 ? "M" : "L"}${g.xs[i].toFixed(1)},${g.y(p.valor).toFixed(1)}`)
    .join(" ");

  function achar(clientX: number, el: SVGSVGElement) {
    const r = el.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    let melhor = 0;
    let dist = Infinity;
    g.xs.forEach((xv, i) => {
      const d = Math.abs(xv - px);
      if (d < dist) {
        dist = d;
        melhor = i;
      }
    });
    setAtivo(melhor);
  }

  const a = ativo !== null ? g.ordenados[ativo] : null;
  const ax = ativo !== null ? g.xs[ativo] : 0;
  const resumo = `${nome}: ${n} resultado${n > 1 ? "s" : ""}, de ${fmt(
    Math.min(...g.ordenados.map((p) => p.valor)),
  )} a ${fmt(Math.max(...g.ordenados.map((p) => p.valor)))} ${unidade}.`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-subtle">
          Cada ponto vem de um exame conferido por uma pessoa. A faixa verde e a
          que estava impressa em cada laudo.
        </p>
        <button
          type="button"
          onClick={() => setTabela(!tabela)}
          className="whitespace-nowrap text-xs text-primary hover:underline"
        >
          {tabela ? "Ver grafico" : "Ver como tabela"}
        </button>
      </div>

      {tabela ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-subtle">
              <tr>
                <th className="py-1 pr-3 font-medium">Data</th>
                <th className="py-1 pr-3 font-medium">Valor</th>
                <th className="py-1 pr-3 font-medium">Faixa impressa</th>
                <th className="py-1 pr-3 font-medium">Situacao</th>
                <th className="py-1 font-medium">Laboratorio</th>
              </tr>
            </thead>
            <tbody>
              {g.ordenados.map((p, i) => (
                <tr key={i} className="border-t border-line text-ink">
                  <td className="py-1.5 pr-3">{dataCurta(p.data)}</td>
                  <td className="py-1.5 pr-3 font-medium">
                    {fmt(p.valor)} {unidade}
                  </td>
                  <td className="py-1.5 pr-3 text-subtle">
                    {p.refMin === null && p.refMax === null
                      ? "sem faixa"
                      : `${p.refMin === null ? "ate" : fmt(p.refMin)}${
                          p.refMin !== null && p.refMax !== null ? " a " : ""
                        }${p.refMax === null ? " em diante" : p.refMin === null ? ` ${fmt(p.refMax)}` : fmt(p.refMax)}`}
                  </td>
                  <td className="py-1.5 pr-3">
                    {foraDaFaixa(p) ?? (p.refMin === null && p.refMax === null ? "-" : "dentro da faixa")}
                  </td>
                  <td className="py-1.5 text-subtle">{p.laboratorio ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full touch-pan-y"
            role="img"
            aria-label={resumo}
            onPointerMove={(e) => achar(e.clientX, e.currentTarget)}
            onPointerLeave={() => setAtivo(null)}
          >
            {/* grade e eixo Y */}
            {g.ticks.map((t) => (
              <g key={t}>
                <line
                  x1={M.l}
                  x2={W - M.r}
                  y1={g.y(t)}
                  y2={g.y(t)}
                  className="stroke-line"
                  strokeWidth={1}
                />
                <text
                  x={M.l - 8}
                  y={g.y(t) + 4}
                  textAnchor="end"
                  className="fill-subtle"
                  fontSize={11}
                >
                  {fmt(t)}
                </text>
              </g>
            ))}

            {/* faixa de referencia de cada resultado */}
            {g.bandas.map(
              (b, i) =>
                b && (
                  <rect
                    key={i}
                    x={b.esq}
                    width={Math.max(0, b.dir - b.esq)}
                    y={b.yTop}
                    height={Math.max(0, b.yBase - b.yTop)}
                    className="fill-success/15"
                  />
                ),
            )}

            {/* eixo X */}
            {g.marcas.map((m, i) => (
              <text
                key={i}
                x={m.x}
                y={H - 10}
                textAnchor={i === 0 && g.marcas.length > 1 ? "start" : i === g.marcas.length - 1 && g.marcas.length > 1 ? "end" : "middle"}
                className="fill-subtle"
                fontSize={11}
              >
                {m.rotulo}
              </text>
            ))}
            <text x={M.l} y={12} textAnchor="start" className="fill-subtle" fontSize={11}>
              {unidade}
            </text>

            {/* cursor */}
            {a && (
              <line
                x1={ax}
                x2={ax}
                y1={M.t}
                y2={M.t + PH}
                className="stroke-subtle"
                strokeWidth={1}
              />
            )}

            {/* serie */}
            {n > 1 && (
              <path
                d={caminho}
                fill="none"
                className="stroke-primary"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {g.ordenados.map((p, i) => {
              const cx = g.xs[i];
              const cy = g.y(p.valor);
              const fora = foraDaFaixa(p);
              return fora ? (
                <rect
                  key={i}
                  x={cx - 5.5}
                  y={cy - 5.5}
                  width={11}
                  height={11}
                  transform={`rotate(45 ${cx} ${cy})`}
                  className="fill-warn stroke-card"
                  strokeWidth={2}
                />
              ) : (
                <circle
                  key={i}
                  cx={cx}
                  cy={cy}
                  r={4.5}
                  className="fill-primary stroke-card"
                  strokeWidth={2}
                />
              );
            })}

            {/* alvos de toque e foco: bem maiores que a marca */}
            {g.ordenados.map((p, i) => (
              <circle
                key={i}
                cx={g.xs[i]}
                cy={g.y(p.valor)}
                r={14}
                fill="transparent"
                tabIndex={0}
                role="img"
                aria-label={`${dataCurta(p.data)}: ${fmt(p.valor)} ${unidade}${
                  foraDaFaixa(p) ? `, ${foraDaFaixa(p)}` : ""
                }`}
                onFocus={() => setAtivo(i)}
                onBlur={() => setAtivo(null)}
                className="outline-none focus-visible:stroke-primary"
                strokeWidth={2}
              />
            ))}
          </svg>

          {a && (
            <div
              className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-lg border border-line bg-card px-3 py-2 text-xs shadow-sm"
              style={{
                left: `${(ax / W) * 100}%`,
                transform: ax > W * 0.6 ? "translateX(calc(-100% - 10px))" : "translateX(10px)",
              }}
            >
              <p className="text-subtle">{dataCurta(a.data)}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-ink">
                <span className="inline-block h-0.5 w-3 rounded bg-primary" />
                {fmt(a.valor)} {unidade}
              </p>
              <p className="mt-1 text-subtle">
                {a.refMin === null && a.refMax === null
                  ? "Sem faixa impressa neste laudo"
                  : `Faixa: ${a.refMin === null ? "ate" : fmt(a.refMin)}${
                      a.refMin !== null && a.refMax !== null ? " a " : ""
                    }${a.refMax === null ? " em diante" : a.refMin === null ? ` ${fmt(a.refMax)}` : fmt(a.refMax)}`}
              </p>
              {foraDaFaixa(a) && (
                <p className="mt-0.5 font-medium text-warn">◆ {foraDaFaixa(a)}</p>
              )}
              {a.laboratorio && <p className="mt-0.5 text-subtle">{a.laboratorio}</p>}
              {a.convertidoDe && (
                <p className="mt-0.5 text-subtle">Convertido de {a.convertidoDe}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
