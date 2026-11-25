"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Badge, Card } from "@/components/ui";
import { CompletudePerfil } from "@/components/completude-perfil";
import { ResumoTarefas } from "@/components/resumo-tarefas";
import { FotosRecentes } from "@/components/fotos-recentes";
import { dataCurta, fmt, posicaoNaFaixa, rotuloPosicao } from "@/lib/tendencia";
import {
  COLUNAS_DOSE,
  COLUNAS_REMEDIO,
  resumoDoDia,
  type RegistroDose,
  type Remedio,
  type SituacaoDia,
} from "@/lib/medicacao";


type AlertaResumo = {
  id: string;
  texto: string | null;
  titulo: string;
  severidade: string | null;
  geradoEm: string;
};

type Recente = { id: string; tipo: string; titulo: string; detalhe: string | null; data: string };

type ForaDaFaixa = { nome: string; texto: string; data: string };

const SITUACAO: Record<SituacaoDia, { simbolo: string; rotulo: string; classe: string }> = {
  dada: { simbolo: "✓", rotulo: "deu", classe: "bg-success/15 text-success" },
  parcial: { simbolo: "◐", rotulo: "falta registrar dose", classe: "bg-warn/10 text-warn" },
  nao_dada: { simbolo: "✕", rotulo: "alguma dose não foi dada", classe: "bg-warn/15 text-warn" },
  sem_registro: { simbolo: "·", rotulo: "sem registro", classe: "bg-panel text-subtle" },
  sem_dose: { simbolo: "–", rotulo: "sem dose prevista", classe: "text-subtle" },
};

const ROTULO_TIPO: Record<string, string> = {
  sintoma: "Sintoma",
  diario: "Diário",
  consulta: "Consulta",
  exame: "Exame",
};

function diasRecentes(n: number) {
  const saida: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    saida.push(`${d.getFullYear()}-${mm}-${dd}`);
  }
  return saida;
}

function quando(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Titulo({ children, href, link }: { children: React.ReactNode; href?: string; link?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">{children}</h2>
      {href && (
        <Link href={href} className="text-xs text-primary hover:underline">
          {link}
        </Link>
      )}
    </div>
  );
}

export function Dashboard() {
  const supabase = createClient();
  const membership = useRole();
  const idosoId = membership?.idosoId;
  const clinico = membership?.role === "familiar";

  const [carregando, setCarregando] = useState(true);
  const [dias] = useState(() => diasRecentes(7));
  const [remedios, setRemedios] = useState<Remedio[]>([]);
  const [registros, setRegistros] = useState<RegistroDose[]>([]);
  const [alertas, setAlertas] = useState<AlertaResumo[]>([]);
  const [totalNaoLidos, setTotalNaoLidos] = useState(0);
  const [visao, setVisao] = useState<{ resumo: string; geradoEm: string } | null>(null);
  const [recentes, setRecentes] = useState<Recente[]>([]);
  const [fora, setFora] = useState<ForaDaFaixa[]>([]);
  const [pauta, setPauta] = useState(0);
  const [semMarcar, setSemMarcar] = useState<string[]>([]);

  const carregar = useCallback(async () => {
    if (!idosoId) {
      setCarregando(false);
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const [
      { data: meds },
      { data: alerts },
      { data: v },
      { data: sint },
      { data: diar },
      { data: cons },
      { data: exames },
      { count: nPauta },
    ] = await Promise.all([
      supabase
        .from("medicacao")
        .select(COLUNAS_REMEDIO)
        .eq("idoso_id", idosoId)
        .eq("ativo", true)
        .is("deleted_at", null)
        .order("nome"),
      user
        ? supabase
            .from("alerta_destinatario")
            .select("id, texto, alerta:alerta_id(titulo, severidade, gerado_em)")
            .eq("usuario_id", user.id)
            .is("lido_em", null)
            .limit(50)
        : Promise.resolve({ data: [] }),
      supabase
        .from("visao_360")
        .select("conteudo, gerado_em")
        .eq("idoso_id", idosoId)
        .order("gerado_em", { ascending: false })
        .limit(1),
      supabase
        .from("sintoma")
        .select("id, data, descricao, gravidade")
        .eq("idoso_id", idosoId)
        .is("deleted_at", null)
        .order("data", { ascending: false })
        .limit(4),
      supabase
        .from("entrada_diario")
        .select("id, data, alimentacao, ocorrencias, sono, legenda, foto_url")
        .eq("idoso_id", idosoId)
        .is("deleted_at", null)
        .order("data", { ascending: false })
        .limit(4),
      supabase
        .from("consulta")
        .select("id, data, medico, especialidade")
        .eq("idoso_id", idosoId)
        .is("deleted_at", null)
        .order("data", { ascending: false })
        .limit(3),
      supabase
        .from("exame")
        .select("id, data, tipo, laboratorio")
        .eq("idoso_id", idosoId)
        .is("deleted_at", null)
        .order("data", { ascending: false })
        .limit(3),
      supabase
        .from("item_pauta")
        .select("id", { count: "exact", head: true })
        .eq("idoso_id", idosoId)
        .is("resolvido_em", null)
        .is("deleted_at", null),
    ]);

    // Adesão dos últimos 7 dias, por remédio.
    const lista = (meds ?? []) as Remedio[];
    setRemedios(lista);
    if (lista.length > 0) {
      const { data: regs } = await supabase
        .from("registro_medicacao")
        .select(COLUNAS_DOSE)
        .in(
          "medicacao_id",
          lista.map((m) => m.id),
        )
        .is("deleted_at", null)
        .gte("data", dias[0]);
      setRegistros((regs ?? []) as unknown as RegistroDose[]);
    }

    // Alertas não lidos (mais recentes primeiro).
    type LinhaAlerta = {
      id: string;
      texto: string | null;
      alerta: { titulo: string | null; severidade: string | null; gerado_em: string } | null;
    };
    const naoLidos = ((alerts ?? []) as unknown as LinhaAlerta[])
      .filter((a) => a.alerta)
      .sort(
        (a, b) =>
          Number(b.alerta!.severidade === "urgente") - Number(a.alerta!.severidade === "urgente") ||
          new Date(b.alerta!.gerado_em).getTime() - new Date(a.alerta!.gerado_em).getTime(),
      );
    setTotalNaoLidos(naoLidos.length);
    setAlertas(
      naoLidos.slice(0, 3).map((a) => ({
        id: a.id,
        texto: a.texto,
        titulo: a.alerta!.titulo ?? "Alerta",
        severidade: a.alerta!.severidade,
        geradoEm: a.alerta!.gerado_em,
      })),
    );

    // Resumo da última visão 360.
    const ultima = v?.[0];
    if (ultima?.conteudo) {
      try {
        const c = JSON.parse(ultima.conteudo as string) as { resumo?: string };
        setVisao(c.resumo ? { resumo: c.resumo, geradoEm: ultima.gerado_em as string } : null);
      } catch {
        setVisao(null);
      }
    }

    // Últimos registros, de várias fontes, em ordem.
    const todos: Recente[] = [];
    for (const s of (sint ?? []) as Record<string, string | number | null>[]) {
      todos.push({
        id: `s-${s.id}`,
        tipo: "sintoma",
        titulo: String(s.descricao),
        detalhe: s.gravidade ? `gravidade ${s.gravidade} de 5` : null,
        data: String(s.data),
      });
    }
    for (const d of (diar ?? []) as Record<string, string | null>[]) {
      todos.push({
        id: `d-${d.id}`,
        tipo: "diario",
        titulo: d.foto_url ? "Foto do dia" : "Entrada no diário",
        detalhe: [d.legenda, d.alimentacao, d.sono ? `Sono: ${d.sono}` : null, d.ocorrencias].filter(Boolean).join(" · ") || null,
        data: String(d.data),
      });
    }
    for (const c of (cons ?? []) as Record<string, string | null>[]) {
      if (!c.data) continue;
      todos.push({
        id: `c-${c.id}`,
        tipo: "consulta",
        titulo: [c.medico, c.especialidade].filter(Boolean).join(" · ") || "Consulta",
        detalhe: null,
        data: String(c.data),
      });
    }
    for (const e of (exames ?? []) as Record<string, string | null>[]) {
      if (!e.data) continue;
      todos.push({
        id: `e-${e.id}`,
        tipo: "exame",
        titulo: e.tipo || "Exame",
        detalhe: e.laboratorio,
        data: String(e.data),
      });
    }
    todos.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());
    setRecentes(todos.slice(0, 6));

    setPauta(nPauta ?? 0);

    const { data: paraMarcar } = await supabase
      .from("pedido_exame")
      .select("exames")
      .eq("idoso_id", idosoId)
      .eq("status", "falta_marcar");
    setSemMarcar((paraMarcar ?? []).map((p) => (p.exames as string[]).join(", ")));

    // Resultados mais recentes que estão fora da faixa do próprio laudo (só para quem vê o clínico).
    if (clinico) {
      type Res = {
        valor: number;
        unidade: string | null;
        ref_min: number | null;
        ref_max: number | null;
        analito: { nome_canonico: string; fundido_em: string | null; idoso_id: string } | null;
        exame: { data: string | null; deleted_at: string | null } | null;
      };
      const { data: res } = await supabase
        .from("exame_resultado")
        .select(
          "valor, unidade, ref_min, ref_max, analito:analito_id(nome_canonico, fundido_em, idoso_id), exame:exame_id(data, deleted_at)",
        )
        .limit(500);
      const ultimo = new Map<string, Res & { data: string }>();
      for (const r of (res ?? []) as unknown as Res[]) {
        if (!r.analito || r.analito.fundido_em || r.analito.idoso_id !== idosoId) continue;
        if (!r.exame?.data || r.exame.deleted_at) continue;
        const atual = ultimo.get(r.analito.nome_canonico);
        if (!atual || new Date(r.exame.data) > new Date(atual.data)) {
          ultimo.set(r.analito.nome_canonico, { ...r, data: r.exame.data });
        }
      }
      const lista: ForaDaFaixa[] = [];
      for (const [nome, r] of ultimo) {
        const alvo = { valor: Number(r.valor), refMin: r.ref_min, refMax: r.ref_max };
        const pos = posicaoNaFaixa(alvo);
        if (pos === "acima" || pos === "abaixo") {
          lista.push({
            nome,
            texto: `${fmt(alvo.valor)} ${r.unidade ?? ""} · ${rotuloPosicao(alvo)}`,
            data: r.data,
          });
        }
      }
      setFora(lista.slice(0, 5));
    }

    setCarregando(false);
  }, [supabase, idosoId, dias, clinico]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  if (!membership || carregando) {
    return carregando ? <p className="text-sm text-subtle">Carregando o resumo...</p> : null;
  }

  const hoje = dias[dias.length - 1];

  return (
    <div className="flex flex-col gap-4">
      {semMarcar.length > 0 && (
        <Link href="/pedidos" className="rounded-xl border-2 border-danger bg-danger/10 p-4">
          <p className="text-sm font-semibold text-danger">
            {semMarcar.length === 1 ? "1 exame falta marcar" : `${semMarcar.length} pedidos de exame faltam marcar`}
          </p>
          <p className="text-sm text-ink">{semMarcar.join(" · ")}</p>
        </Link>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Adesão */}
        <Card>
          <Titulo href="/medicacao" link="Registrar">
            Medicação, últimos 7 dias
          </Titulo>
          {remedios.length === 0 ? (
            <p className="text-sm text-subtle">Nenhum remédio ativo cadastrado.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {remedios.map((m) => {
                const deHoje = resumoDoDia(m, registros, hoje);
                return (
                  <div key={m.id} className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm text-ink">
                        {m.nome}
                        {m.dosagem && <span className="text-xs text-subtle"> · {m.dosagem}</span>}
                      </p>
                      <span className="shrink-0 text-xs text-subtle">
                        {deHoje.previstas
                          ? `hoje: ${deHoje.registradas} de ${deHoje.previstas}`
                          : deHoje.registradas
                            ? `hoje: ${deHoje.registradas}x`
                            : "sem dose prevista hoje"}
                      </span>
                    </div>
                    <div className="flex gap-1" aria-label={`Últimos 7 dias de ${m.nome}`}>
                      {dias.map((d) => {
                        const { situacao } = resumoDoDia(m, registros, d);
                        const v = SITUACAO[situacao];
                        return (
                          <span
                            key={d}
                            title={`${dataCurta(d)}: ${v.rotulo}`}
                            className={`flex h-6 w-6 items-center justify-center rounded text-[11px] font-semibold ${v.classe}`}
                          >
                            {v.simbolo}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <p className="text-xs text-subtle">
                ✓ deu · ◐ falta dose · ✕ alguma não foi dada · – sem dose prevista · · sem registro (não quer
                dizer que a dose não foi dada).
              </p>
            </div>
          )}
        </Card>

        {/* Alertas */}
        <Card>
          <Titulo href="/alertas" link={totalNaoLidos > 3 ? `Ver todos (${totalNaoLidos})` : "Ver alertas"}>
            Alertas não lidos
          </Titulo>
          {alertas.length === 0 ? (
            <p className="text-sm text-subtle">Nenhum alerta novo.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {alertas.map((a) => (
                <div key={a.id} className="flex flex-col gap-0.5 border-t border-line pt-3 first:border-0 first:pt-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-ink">{a.titulo}</p>
                    {a.severidade === "atencao" && <Badge tone="warn">atenção</Badge>}
                    {a.severidade === "urgente" && <Badge tone="danger">urgente</Badge>}
                  </div>
                  <p className="text-xs text-subtle">{a.texto}</p>
                  <p className="text-[11px] text-subtle">{quando(a.geradoEm)}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Resumo (clínico: só para o familiar) */}
      {clinico && <Card>
        <Titulo href="/visao-360" link={visao ? "Ver visão 360" : "Gerar visão 360"}>
          Resumo
        </Titulo>
        {visao ? (
          <>
            <p className="line-clamp-4 text-sm text-ink">{visao.resumo}</p>
            <p className="mt-2 text-xs text-subtle">
              Visão 360 gerada em {quando(visao.geradoEm)}.
              {pauta > 0 ? ` Pauta médica: ${pauta} ${pauta === 1 ? "item em aberto" : "itens em aberto"}.` : ""}
            </p>
          </>
        ) : (
          <p className="text-sm text-subtle">
            Ainda não há uma visão 360. Ela reúne tudo o que foi registrado em um panorama atual.
          </p>
        )}
      </Card>}

      {idosoId && membership.role === "familiar" && <ResumoTarefas idosoId={idosoId} />}

      {idosoId && <FotosRecentes idosoId={idosoId} />}

      <CompletudePerfil />

      <div className={`grid gap-4 ${clinico ? "md:grid-cols-2" : ""}`}>
        {/* Últimos registros */}
        <Card>
          <Titulo href="/timeline" link="Timeline completa">
            Últimos registros
          </Titulo>
          {recentes.length === 0 ? (
            <p className="text-sm text-subtle">Nada registrado ainda.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {recentes.map((r) => (
                <div key={r.id} className="flex flex-col gap-0.5 border-t border-line pt-3 first:border-0 first:pt-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="line-clamp-1 text-sm text-ink">{r.titulo}</p>
                    <span className="whitespace-nowrap text-[11px] text-subtle">
                      {ROTULO_TIPO[r.tipo]} · {dataCurta(r.data)}
                    </span>
                  </div>
                  {r.detalhe && <p className="line-clamp-1 text-xs text-subtle">{r.detalhe}</p>}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Exames fora da faixa (só clínico) */}
        {clinico && (
          <Card>
            <Titulo href="/tendencias" link="Ver tendências">
              Exames fora da faixa do laudo
            </Titulo>
            {fora.length === 0 ? (
              <p className="text-sm text-subtle">
                Nenhum resultado recente fora da faixa impressa nos laudos.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {fora.map((f) => (
                  <div key={f.nome} className="flex flex-col gap-0.5 border-t border-line pt-3 first:border-0 first:pt-0">
                    <p className="text-sm font-medium text-ink">
                      <span className="mr-1.5 text-warn" aria-hidden>
                        ◆
                      </span>
                      {f.nome}
                    </p>
                    <p className="text-xs text-subtle">
                      {f.texto} · {dataCurta(f.data)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
