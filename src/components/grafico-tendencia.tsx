"use client";

import { useMemo, useState } from "react";
import {
  dataCurta,
  fmt,
  posicaoNaFaixa,
  textoFaixa,
} from "@/lib/tendencia";

export type Ponto = {
  data: string; // ISO
  valor: number;
  refMin: number | null;
  refMax: number | null;
  laboratorio: string | null;
  convertidoDe: string | null; // ex: "5,6 mmol/L"
};

const W = 640;
const H = 300;
// Margem direita larga: é onde fica o rótulo do limite do laudo, longe dos pontos.
const M = { l: 52, r: 78, t: 28, b: 34 };
const PW = W - M.l - M.r;
const PH = H - M.t - M.b;

function passoBonito(faixa: number, alvo: number) {
  const bruto = faixa / alvo;
  const mag = Math.pow(10, Math.floor(Math.log10(bruto)));
  const n = bruto / mag;
  const f = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return f * mag;
}

function dataEixo(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
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

    // A faixa pertence ao RESULTADO: cada ponto governa o trecho até o meio do
    // caminho para os vizinhos. Sem faixa impressa, nada é desenhado.
    //  - mínimo e máximo: banda (tem os dois lados, então não engana)
    //  - só um limite: LINHA, porque uma banda sugeriria um outro limite
    //    que o laudo não tem (ex: "até 190" não significa "entre 180 e 190")
    const trechos = ordenados.map((p, i) => {
      const esq = i === 0 ? M.l : (xs[i - 1] + xs[i]) / 2;
      const dir = i === ordenados.length - 1 ? M.l + PW : (xs[i] + xs[i + 1]) / 2;
      if (p.refMin !== null && p.refMax !== null) {
        return {
          tipo: "banda" as const,
          esq,
          dir,
          yTop: y(p.refMax),
          yBase: y(p.refMin),
        };
      }
      if (p.refMax !== null) {
        return { tipo: "limite" as const, esq, dir, y: y(p.refMax), valor: p.refMax, lado: "max" as const };
      }
      if (p.refMin !== null) {
        return { tipo: "limite" as const, esq, dir, y: y(p.refMin), valor: p.refMin, lado: "min" as const };
      }
      return null;
    });

    const marcas: { x: number; rotulo: string }[] = [];
    if (t1 === t0) {
      marcas.push({ x: x(t0), rotulo: dataEixo(new Date(t0).toISOString()) });
    } else {
      const n = Math.min(5, ordenados.length);
      for (let i = 0; i < n; i++) {
        const t = t0 + ((t1 - t0) * i) / (n - 1);
        marcas.push({ x: x(t), rotulo: dataEixo(new Date(t).toISOString()) });
      }
    }

    return { ordenados, xs, y, ticks, trechos, marcas };
  }, [pontos]);

  const n = g.ordenados.length;
  const caminho = g.ordenados
    .map((p, i) => `${i === 0 ? "M" : "L"}${g.xs[i].toFixed(1)},${g.y(p.valor).toFixed(1)}`)
    .join(" ");

  const temFora = g.ordenados.some((p) => {
    const pos = posicaoNaFaixa(p);
    return pos === "acima" || pos === "abaixo";
  });
  const temBanda = g.trechos.some((t) => t?.tipo === "banda");
  const temLimite = g.trechos.some((t) => t?.tipo === "limite");
  // O rótulo do limite fica na margem direita e vale para o resultado mais recente.
  const ultimoTrecho = g.trechos[g.trechos.length - 1];

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

  // Valor escrito só nas pontas: rótulo em todos os pontos vira ruído.
  const comRotulo = n === 1 ? [0] : [0, n - 1];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-subtle">
          Cada ponto vem de um exame conferido por uma pessoa. A faixa ou o
          limite é o que estava impresso em cada laudo.
        </p>
        <button
          type="button"
          onClick={() => setTabela(!tabela)}
          className="whitespace-nowrap text-xs text-primary hover:underline"
        >
          {tabela ? "Ver gráfico" : "Ver como tabela"}
        </button>
      </div>

      {tabela ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-subtle">
              <tr>
                <th className="py-1 pr-3 font-medium">Data</th>
                <th className="py-1 pr-3 font-medium">Valor</th>
                <th className="py-1 pr-3 font-medium">Faixa do laudo</th>
                <th className="py-1 pr-3 font-medium">Situação</th>
                <th className="py-1 font-medium">Laboratório</th>
              </tr>
            </thead>
            <tbody>
              {g.ordenados.map((p, i) => {
                const pos = posicaoNaFaixa(p);
                return (
                  <tr key={i} className="border-t border-line text-ink">
                    <td className="py-1.5 pr-3">{dataCurta(p.data)}</td>
                    <td className="py-1.5 pr-3 font-medium">
                      {fmt(p.valor)} {unidade}
                    </td>
                    <td className="py-1.5 pr-3 text-subtle">
                      {textoFaixa(p.refMin, p.refMax) || "sem faixa"}
                    </td>
                    <td className="py-1.5 pr-3">
                      {pos === "acima"
                        ? "◆ acima da faixa"
                        : pos === "abaixo"
                          ? "◆ abaixo da faixa"
                          : pos === "dentro"
                            ? "dentro da faixa"
                            : "-"}
                    </td>
                    <td className="py-1.5 text-subtle">{p.laboratorio ?? "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <>
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
                    x2={M.l + PW}
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

              {/* banda: faixa com mínimo e máximo */}
              {g.trechos.map(
                (t, i) =>
                  t?.tipo === "banda" && (
                    <rect
                      key={i}
                      x={t.esq}
                      width={Math.max(0, t.dir - t.esq)}
                      y={t.yTop}
                      height={Math.max(0, t.yBase - t.yTop)}
                      className="fill-success/15"
                    />
                  ),
              )}

              {/* linha de limite: laudo com um limite só */}
              {g.trechos.map(
                (t, i) =>
                  t?.tipo === "limite" && (
                    <line
                      key={i}
                      x1={t.esq}
                      x2={t.dir}
                      y1={t.y}
                      y2={t.y}
                      className="stroke-success"
                      strokeWidth={1.5}
                    />
                  ),
              )}
              {ultimoTrecho?.tipo === "limite" && (
                <text
                  x={M.l + PW + 8}
                  y={ultimoTrecho.y + 4}
                  className="fill-subtle"
                  fontSize={11}
                >
                  {ultimoTrecho.lado === "max" ? "limite" : "mínimo"} {fmt(ultimoTrecho.valor)}
                </text>
              )}

              {/* eixo X */}
              {g.marcas.map((m, i) => (
                <text
                  key={i}
                  x={m.x}
                  y={H - 10}
                  textAnchor={
                    g.marcas.length > 1 && i === 0
                      ? "start"
                      : g.marcas.length > 1 && i === g.marcas.length - 1
                        ? "end"
                        : "middle"
                  }
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

              {/* série */}
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
                const pos = posicaoNaFaixa(p);
                const fora = pos === "acima" || pos === "abaixo";
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

              {/* valor escrito só nas pontas */}
              {comRotulo.map((i) => {
                const p = g.ordenados[i];
                const cx = g.xs[i];
                const cy = g.y(p.valor);
                const acima = cy - 12 > M.t + 4;
                const ancora = n === 1 ? "middle" : i === 0 ? "start" : "end";
                const dx = n === 1 ? 0 : i === 0 ? 4 : -4;
                return (
                  <text
                    key={`r${i}`}
                    x={cx + dx}
                    y={acima ? cy - 12 : cy + 22}
                    textAnchor={ancora}
                    className="fill-ink"
                    fontSize={12}
                    fontWeight={600}
                  >
                    {fmt(p.valor)}
                  </text>
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
                    posicaoNaFaixa(p) === "acima"
                      ? ", acima da faixa"
                      : posicaoNaFaixa(p) === "abaixo"
                        ? ", abaixo da faixa"
                        : ""
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
                  {textoFaixa(a.refMin, a.refMax)
                    ? `Faixa do laudo: ${textoFaixa(a.refMin, a.refMax)}`
                    : "Este laudo não trouxe faixa"}
                </p>
                {posicaoNaFaixa(a) === "acima" && (
                  <p className="mt-0.5 font-medium text-warn">◆ acima da faixa</p>
                )}
                {posicaoNaFaixa(a) === "abaixo" && (
                  <p className="mt-0.5 font-medium text-warn">◆ abaixo da faixa</p>
                )}
                {a.laboratorio && <p className="mt-0.5 text-subtle">{a.laboratorio}</p>}
                {a.convertidoDe && (
                  <p className="mt-0.5 text-subtle">Convertido de {a.convertidoDe}</p>
                )}
              </div>
            )}
          </div>

          {/* chave: explica cada marca que aparece, sem depender de passar o mouse */}
          <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-subtle">
            <li className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary" aria-hidden />
              resultado dentro da faixa, ou laudo sem faixa
            </li>
            {temFora && (
              <li className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rotate-45 bg-warn" aria-hidden />
                resultado fora da faixa do laudo
              </li>
            )}
            {temBanda && (
              <li className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-5 rounded-sm bg-success/15" aria-hidden />
                faixa de referência do laudo
              </li>
            )}
            {temLimite && (
              <li className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-5 bg-success" aria-hidden />
                limite do laudo
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}
