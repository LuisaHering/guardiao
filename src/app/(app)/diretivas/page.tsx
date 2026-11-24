"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Badge, Button, Card, Input } from "@/components/ui";
import {
  INTRODUCAO,
  SECOES,
  VERSAO_QUESTIONARIO,
  montarItens,
  quantasRespondidas,
  type Pergunta,
  type Pessoa,
  type Respostas,
} from "@/lib/diretivas/questionario";

type Diretiva = {
  id: string;
  gerada_em: string;
  modo_preenchimento: "titular" | "assistido";
  assistido_por: string | null;
  vigente: boolean;
  pdf_url: string | null;
};

function dataHora(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const PESSOA_VAZIA: Pessoa = { nome: "", relacao: "", telefone: "" };

function CampoPergunta({
  p,
  valor,
  onChange,
}: {
  p: Pergunta;
  valor: Respostas[string];
  onChange: (v: Respostas[string]) => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-4 first:border-0 first:pt-0">
      <div>
        <p className="text-sm font-medium text-ink">{p.rotulo}</p>
        {p.ajuda && <p className="text-xs text-subtle">{p.ajuda}</p>}
      </div>

      {p.tipo === "opcao" && (
        <div className="flex flex-col gap-1.5">
          {p.opcoes.map((o) => (
            <label
              key={o.valor}
              className="flex cursor-pointer items-start gap-2 rounded-lg px-1 py-1 text-sm text-ink hover:bg-panel"
            >
              <input
                type="radio"
                name={p.id}
                checked={valor === o.valor}
                onChange={() => onChange(o.valor)}
                className="mt-1"
              />
              {o.rotulo}
            </label>
          ))}
          {valor && (
            <button
              type="button"
              onClick={() => onChange(undefined)}
              className="self-start text-xs text-subtle hover:text-ink hover:underline"
            >
              Limpar resposta
            </button>
          )}
        </div>
      )}

      {p.tipo === "texto" && (
        <textarea
          value={typeof valor === "string" ? valor : ""}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          maxLength={2000}
          className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        />
      )}

      {p.tipo === "pessoa" && (
        <div className="grid gap-2 sm:grid-cols-3">
          {(
            [
              ["nome", "Nome"],
              ["relacao", "Relação (ex: filha)"],
              ["telefone", "Telefone"],
            ] as const
          ).map(([campo, rotulo]) => (
            <Input
              key={campo}
              placeholder={rotulo}
              maxLength={200}
              value={(typeof valor === "object" ? valor[campo] : "") ?? ""}
              onChange={(e) =>
                onChange({
                  ...(typeof valor === "object" ? valor : PESSOA_VAZIA),
                  [campo]: e.target.value,
                })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DiretivasPage() {
  const supabase = createClient();
  const membership = useRole();
  const idosoId = membership?.idosoId;
  const nomeTitular = membership?.idosoNomeCompleto ?? membership?.idosoNome ?? "o titular";
  const ehTitular = membership?.role === "idoso";
  const podeGerar = ehTitular || !!membership?.admin;

  const [carregando, setCarregando] = useState(true);
  const [lista, setLista] = useState<Diretiva[]>([]);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [nomes, setNomes] = useState<Record<string, string>>({});

  const [preenchendo, setPreenchendo] = useState(false);
  const [etapa, setEtapa] = useState(0);
  const [respostas, setRespostas] = useState<Respostas>({});
  const [presente, setPresente] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [geradaId, setGeradaId] = useState<string | null>(null);

  const chaveRascunho = `guardiao:diretiva:${idosoId}:${VERSAO_QUESTIONARIO}`;
  const ultimaEtapa = SECOES.length; // a etapa depois das seções é a revisão

  const carregar = useCallback(async () => {
    if (!idosoId) {
      setCarregando(false);
      return;
    }
    const { data } = await supabase
      .from("diretiva")
      .select("id, gerada_em, modo_preenchimento, assistido_por, vigente, pdf_url")
      .eq("idoso_id", idosoId)
      .order("gerada_em", { ascending: false })
      .limit(30);
    const ds = (data ?? []) as Diretiva[];
    setLista(ds);

    const urls: Record<string, string> = {};
    await Promise.all(
      ds
        .filter((d) => d.pdf_url)
        .map(async (d) => {
          const { data: a } = await supabase.storage
            .from("diretivas")
            .createSignedUrl(d.pdf_url as string, 3600);
          if (a?.signedUrl) urls[d.id] = a.signedUrl;
        }),
    );
    setLinks(urls);

    const ids = [...new Set(ds.map((d) => d.assistido_por).filter(Boolean))] as string[];
    if (ids.length > 0) {
      const { data: us } = await supabase.from("usuario").select("id, nome").in("id", ids);
      setNomes(Object.fromEntries((us ?? []).map((u) => [u.id as string, u.nome as string])));
    }
    setCarregando(false);
  }, [supabase, idosoId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Rascunho: fica só neste navegador até a diretiva ser gerada. O banco só
  // guarda diretivas prontas, porque elas nunca mudam depois de geradas.
  useEffect(() => {
    if (!preenchendo) return;
    try {
      localStorage.setItem(chaveRascunho, JSON.stringify({ respostas, etapa }));
    } catch {
      // sem armazenamento local: o preenchimento continua, só não guarda rascunho
    }
  }, [preenchendo, respostas, etapa, chaveRascunho]);

  function comecar() {
    let r: Respostas = {};
    let e = 0;
    try {
      const salvo = localStorage.getItem(chaveRascunho);
      if (salvo) {
        const p = JSON.parse(salvo);
        r = p.respostas ?? {};
        e = Math.min(Number(p.etapa) || 0, ultimaEtapa);
      }
    } catch {
      // rascunho ilegível: começa do zero
    }
    setRespostas(r);
    setEtapa(e);
    setPresente(false);
    setErro(null);
    setGeradaId(null);
    setPreenchendo(true);
  }

  function descartar() {
    if (!window.confirm("Descartar o que foi respondido até agora?")) return;
    try {
      localStorage.removeItem(chaveRascunho);
    } catch {
      // nada a fazer
    }
    setRespostas({});
    setEtapa(0);
    setPreenchendo(false);
  }

  async function gerar() {
    if (!idosoId) return;
    setErro(null);
    setGerando(true);
    try {
      const resp = await fetch("/api/diretivas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idosoId, respostas, titularPresente: presente }),
      });
      const json = await resp.json();
      if (!resp.ok) {
        setErro(json.erro ?? "Não consegui gerar a diretiva.");
      } else {
        try {
          localStorage.removeItem(chaveRascunho);
        } catch {
          // nada a fazer
        }
        setGeradaId(json.id);
        setPreenchendo(false);
        setRespostas({});
        await carregar();
      }
    } catch {
      setErro("Sem conexão com o servidor. Tente de novo.");
    }
    setGerando(false);
  }

  if (!membership) {
    return (
      <p className="text-sm text-subtle">
        Crie o perfil do idoso primeiro para registrar diretivas.
      </p>
    );
  }

  const vigente = lista.find((d) => d.vigente);
  const anteriores = lista.filter((d) => !d.vigente);

  function quemPreencheu(d: Diretiva) {
    return d.modo_preenchimento === "titular"
      ? "Preenchida pelo próprio titular"
      : `Preenchida com assistência de ${d.assistido_por ? (nomes[d.assistido_por] ?? "outra pessoa") : "outra pessoa"}`;
  }

  // ---------- assistente de preenchimento ----------
  if (preenchendo) {
    const revisao = etapa === ultimaEtapa;
    const secao = SECOES[etapa];
    const montado = montarItens(respostas);
    const respondidas = montado.itens ? quantasRespondidas(montado.itens) : 0;

    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div>
          <p className="text-xs text-subtle">
            Etapa {etapa + 1} de {ultimaEtapa + 1}
          </p>
          <h1 className="text-2xl font-semibold text-ink">
            {revisao ? "Revisar e gerar" : secao.titulo}
          </h1>
          {!revisao && secao.intro && <p className="text-sm text-subtle">{secao.intro}</p>}
        </div>

        {!revisao && secao && (
          <Card className="flex flex-col gap-4">
            {secao.perguntas.map((p) => (
              <CampoPergunta
                key={p.id}
                p={p}
                valor={respostas[p.id]}
                onChange={(v) => setRespostas({ ...respostas, [p.id]: v })}
              />
            ))}
          </Card>
        )}

        {revisao && (
          <>
            <Card className="flex flex-col gap-4">
              {montado.erro && <p className="text-sm text-danger">{montado.erro}</p>}
              {montado.itens &&
                SECOES.map((s) => (
                  <div key={s.id} className="flex flex-col gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
                      {s.titulo}
                    </p>
                    {montado.itens
                      .filter((i) => i.secao === s.titulo)
                      .map((i) => (
                        <div key={i.id} className="text-sm">
                          <p className="text-subtle">{i.pergunta}</p>
                          <p className={i.texto ? "text-ink" : "italic text-subtle"}>
                            {i.texto ?? "Não respondido"}
                          </p>
                        </div>
                      ))}
                  </div>
                ))}
            </Card>

            <Card className="flex flex-col gap-3 border-primary/40">
              <p className="text-sm font-medium text-ink">Como isto vai constar no documento</p>
              <p className="text-sm text-subtle">
                {ehTitular
                  ? "Preenchido pelo próprio titular."
                  : `Preenchido por você, com assistência a ${nomeTitular}. O PDF vai dizer isso em destaque e não vai se apresentar como declaração autônoma do titular.`}
              </p>
              <label className="flex cursor-pointer items-start gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={presente}
                  onChange={(e) => setPresente(e.target.checked)}
                  className="mt-1"
                />
                {ehTitular
                  ? "Confirmo que sou o titular e que estas respostas são minhas."
                  : `Declaro que ${nomeTitular} estava presente durante o preenchimento e que as respostas refletem o que a própria pessoa disse.`}
              </label>
              <p className="text-xs text-subtle">
                Esta declaração é de quem preenche: fica registrada com a data e aparece no
                PDF, mas o sistema não a verifica.
              </p>
            </Card>

            <p className="rounded-lg bg-warn/10 p-3 text-sm text-warn">
              Depois de gerada, a diretiva não pode ser alterada. Para mudar algo, gera-se
              uma nova, e esta continua guardada no histórico.
            </p>
            {erro && <p className="text-sm text-danger">{erro}</p>}
          </>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {etapa > 0 && (
            <Button onClick={() => setEtapa(etapa - 1)} disabled={gerando}>
              Voltar
            </Button>
          )}
          {!revisao ? (
            <Button variant="primary" onClick={() => setEtapa(etapa + 1)}>
              {etapa === ultimaEtapa - 1 ? "Revisar" : "Continuar"}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={gerar}
              disabled={gerando || !presente || respondidas === 0 || !!montado.erro}
            >
              {gerando ? "Gerando..." : "Gerar diretiva"}
            </Button>
          )}
          <Button variant="ghost" onClick={descartar} disabled={gerando}>
            Descartar
          </Button>
          <span className="text-xs text-subtle">
            O que você responde fica salvo neste navegador até gerar.
          </span>
        </div>
        {revisao && respondidas === 0 && (
          <p className="text-xs text-subtle">Responda ao menos uma pergunta para gerar.</p>
        )}
      </div>
    );
  }

  // ---------- lista ----------
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Diretivas</h1>
        <p className="text-sm text-subtle">{INTRODUCAO}</p>
      </div>

      <Card className="flex flex-col gap-2">
        <p className="text-sm font-medium text-ink">O que este documento é, e o que não é</p>
        <p className="text-sm text-subtle">
          O PDF registra as preferências de {nomeTitular} e diz quem as preencheu. Ele{" "}
          <strong className="font-medium text-ink">não tem validade jurídica por si só</strong>:
          para isso, precisa ser levado a um cartório ou ao médico, para registro no
          prontuário (Resolução CFM nº 1.995/2012).
        </p>
      </Card>

      {geradaId && (
        <Card className="border-success/40 bg-success/10">
          <p className="text-sm font-medium text-success">Diretiva gerada.</p>
          <p className="mt-1 text-sm text-ink">
            O PDF está na lista abaixo, em &quot;Vigente&quot;.
          </p>
        </Card>
      )}

      {podeGerar ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={comecar}>
            {vigente ? "Preencher uma nova diretiva" : "Preencher a diretiva"}
          </Button>
          {(() => {
            try {
              return localStorage.getItem(chaveRascunho) ? (
                <span className="text-xs text-subtle">Há um rascunho salvo: ele será retomado.</span>
              ) : null;
            } catch {
              return null;
            }
          })()}
        </div>
      ) : (
        <p className="text-sm text-subtle">
          Somente o titular ou um administrador pode preencher diretivas.
        </p>
      )}

      {carregando && <p className="text-sm text-subtle">Carregando...</p>}

      {!carregando && lista.length === 0 && (
        <p className="text-sm text-subtle">Nenhuma diretiva gerada ainda.</p>
      )}

      {vigente && (
        <Card className="flex flex-col gap-2 border-primary/40">
          <div className="flex items-center justify-between gap-3">
            <Badge tone="success">Vigente</Badge>
            {links[vigente.id] && (
              <a
                href={links[vigente.id]}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-primary hover:underline"
              >
                Baixar PDF
              </a>
            )}
          </div>
          <p className="text-sm text-ink">Gerada em {dataHora(vigente.gerada_em)}</p>
          <p className="text-xs text-subtle">{quemPreencheu(vigente)}.</p>
        </Card>
      )}

      {anteriores.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-ink">Histórico</h2>
          <p className="text-xs text-subtle">
            As diretivas anteriores ficam guardadas: mostram o que foi registrado em cada
            momento e que as mudanças partiram do titular.
          </p>
          {anteriores.map((d) => (
            <Card key={d.id} className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-ink">{dataHora(d.gerada_em)}</p>
                <p className="text-xs text-subtle">{quemPreencheu(d)}.</p>
              </div>
              {links[d.id] && (
                <a
                  href={links[d.id]}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline"
                >
                  Baixar PDF
                </a>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
