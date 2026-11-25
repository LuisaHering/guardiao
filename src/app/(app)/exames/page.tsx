"use client";

import { ResultadosExame } from "@/components/resultados-exame";
import { useCallback, useEffect, useState, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Badge, Button, Card, Field, Input } from "@/components/ui";
import { extensaoDoArquivo, reduzirParaIA } from "@/lib/imagem";
import { normalizarUnidade, numeroDoTexto as num, resolver } from "@/lib/analitos";
import { AVISO_PLANO_GRATIS, NOME_PROVEDOR } from "@/lib/ai/nome-provedor";
import { IACarregando } from "@/components/ia-carregando";
import type { ExameExtraido } from "@/lib/ai/schemas";
import { encerrarExame } from "@/lib/pedidos-exame";

type Analito = {
  id: string;
  nome_canonico: string;
  unidade_canonica: string | null;
};

type Linha = {
  nome: string;
  valor: string;
  unidade: string;
  refMin: string;
  refMax: string;
  analitoId: string | null;
  /** o usuario mexeu em algo que veio da IA */
  editado: boolean;
};

type ExameSalvo = {
  id: string;
  tipo: string | null;
  laboratorio: string | null;
  data: string | null;
  arquivo_url: string | null;
};

type ResultadoSalvo = {
  exame_id: string;
  analito_id: string;
  valor: number | null;
  unidade: string | null;
  ref_min: number | null;
  ref_max: number | null;
  convertido: boolean;
  valor_original: number | null;
  unidade_original: string | null;
  analito: { nome_canonico: string } | null;
};

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return "-";
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function faixaTexto(min: number | null, max: number | null) {
  if (min !== null && max !== null) return `${fmt(min)} a ${fmt(max)}`;
  if (max !== null) return `até ${fmt(max)}`;
  if (min !== null) return `a partir de ${fmt(min)}`;
  return "";
}

function dataCurta(iso: string | null) {
  if (!iso) return "Sem data";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

export default function ExamesPage() {
  const supabase = createClient();
  const membership = useRole();
  const idosoId = membership?.idosoId;

  const [carregando, setCarregando] = useState(true);
  const [exames, setExames] = useState<ExameSalvo[]>([]);
  const [resultados, setResultados] = useState<Record<string, ResultadoSalvo[]>>({});
  const [docs, setDocs] = useState<Record<string, string>>({});
  const [analitos, setAnalitos] = useState<Analito[]>([]);
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});

  const [manter, setManter] = useState("");
  const [unir, setUnir] = useState("");
  const [fundindo, setFundindo] = useState(false);
  const [erroFusao, setErroFusao] = useState<string | null>(null);

  const [arquivo, setArquivo] = useState<File | null>(null);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const [revisao, setRevisao] = useState<{
    tipo: string;
    laboratorio: string;
    data: string;
    legivel: boolean;
    linhas: Linha[];
  } | null>(null);

  const carregar = useCallback(async () => {
    if (!idosoId) {
      setCarregando(false);
      return;
    }
    setCarregando(true);
    const [{ data: es }, { data: as }] = await Promise.all([
      supabase
        .from("exame")
        .select("id, tipo, laboratorio, data, arquivo_url")
        .eq("idoso_id", idosoId)
        .is("deleted_at", null)
        .order("data", { ascending: false })
        .limit(30),
      supabase
        .from("analito")
        .select("id, nome_canonico, unidade_canonica")
        .eq("idoso_id", idosoId)
        .is("fundido_em", null)
        .order("nome_canonico"),
    ]);
    const lista = (es ?? []) as ExameSalvo[];
    setExames(lista);
    setAnalitos((as ?? []) as Analito[]);

    if (lista.length > 0) {
      const { data: rs } = await supabase
        .from("exame_resultado")
        .select(
          "exame_id, analito_id, valor, unidade, ref_min, ref_max, convertido, valor_original, unidade_original, analito:analito_id(nome_canonico)",
        )
        .in(
          "exame_id",
          lista.map((e) => e.id),
        );
      const mapa: Record<string, ResultadoSalvo[]> = {};
      for (const r of (rs ?? []) as unknown as ResultadoSalvo[]) {
        (mapa[r.exame_id] ??= []).push(r);
      }
      setResultados(mapa);
    } else {
      setResultados({});
    }

    const urls: Record<string, string> = {};
    await Promise.all(
      lista
        .filter((e) => e.arquivo_url)
        .map(async (e) => {
          const { data: a } = await supabase.storage
            .from("exames")
            .createSignedUrl(e.arquivo_url as string, 3600);
          if (a?.signedUrl) urls[e.id] = a.signedUrl;
        }),
    );
    setDocs(urls);
    setCarregando(false);
  }, [supabase, idosoId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Vindo de um pedido: carrega o resultado enviado. A leitura só começa no botão desta tela.
  const pedidoDeOrigem = useRef<string | null>(null);
  useEffect(() => {
    const parametros = new URLSearchParams(window.location.search);
    const id = parametros.get("documento");
    pedidoDeOrigem.current = parametros.get("pedido");
    if (!id) return;
    let cancelado = false;
    (async () => {
      const cliente = createClient();
      const { data: d } = await cliente.from("documento").select("nome, arquivo_url, tipo").eq("id", id).maybeSingle();
      if (!d) return;
      const { data: conteudo, error } = await cliente.storage.from("documentos").download(d.arquivo_url as string);
      if (cancelado) return;
      if (error || !conteudo) {
        setErro("Não consegui abrir o resultado enviado.");
        return;
      }
      const extensao = (d.arquivo_url as string).split(".").pop() ?? "jpg";
      setArquivo(new File([conteudo], `${d.nome}.${extensao}`, { type: (d.tipo as string) || conteudo.type }));
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  async function ler() {
    if (!arquivo || !idosoId) return;
    setErro(null);
    setLendo(true);
    setRevisao(null);
    try {
      const enviado = await reduzirParaIA(arquivo);
      const form = new FormData();
      form.append("idosoId", idosoId);
      form.append("arquivo", enviado, arquivo.type === "application/pdf" ? "exame.pdf" : "exame.jpg");
      const resp = await fetch("/api/ia/exame", { method: "POST", body: form });
      const json = await resp.json();
      if (!resp.ok) {
        setErro(json.erro ?? "Não consegui ler o exame.");
        setLendo(false);
        return;
      }
      const e = json.exame as ExameExtraido;
      setAnalitos(json.analitos as Analito[]);
      setRevisao({
        tipo: e.tipo ?? "",
        laboratorio: e.laboratorio ?? "",
        data: e.data ?? "",
        legivel: e.legivel,
        linhas: e.resultados.map((r) => ({
          nome: r.nome,
          valor: String(r.valor),
          unidade: r.unidade ?? "",
          refMin: r.ref_min === null ? "" : String(r.ref_min),
          refMax: r.ref_max === null ? "" : String(r.ref_max),
          analitoId: r.analito_id,
          editado: false,
        })),
      });
    } catch {
      setErro("Sem conexão com o servidor. Tente de novo.");
    }
    setLendo(false);
  }

  function mudar(i: number, parcial: Partial<Linha>) {
    setRevisao((r) =>
      r
        ? {
            ...r,
            linhas: r.linhas.map((l, j) => {
              if (j !== i) return l;
              const nova = { ...l, ...parcial, editado: true };
              // Mudou o nome: o casamento sugerido pela IA deixa de valer.
              if (parcial.nome !== undefined) nova.analitoId = null;
              return nova;
            }),
          }
        : r,
    );
  }

  function remover(i: number) {
    setRevisao((r) => (r ? { ...r, linhas: r.linhas.filter((_, j) => j !== i) } : r));
  }

  async function removerExame(id: string) {
    if (
      !window.confirm(
        "Remover este exame? Ele sai da timeline e do gráfico de tendência.",
      )
    ) {
      return;
    }
    await supabase
      .from("exame")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    await carregar();
  }

  async function unirNomes() {
    if (!manter || !unir) return;
    setErroFusao(null);
    setFundindo(true);
    const { error } = await supabase.rpc("fundir_analitos", {
      p_origem: unir,
      p_destino: manter,
    });
    if (error) {
      setErroFusao(error.message);
    } else {
      setManter("");
      setUnir("");
    }
    setFundindo(false);
    await carregar();
  }

  async function confirmar() {
    if (!revisao || !arquivo || !idosoId) return;
    const calc = revisao.linhas.map((l) => ({ l, r: resolver(l, analitos) }));
    if (calc.length === 0) {
      setErro("Não há resultados para confirmar.");
      return;
    }
    if (calc.some((c) => c.r.erro)) {
      setErro("Ainda há linhas com problema. Corrija ou remova antes de confirmar.");
      return;
    }
    if (!revisao.data) {
      setErro("Informe a data da coleta.");
      return;
    }
    setErro(null);
    setSalvando(true);

    const caminho = `${idosoId}/${crypto.randomUUID()}.${extensaoDoArquivo(arquivo)}`;
    const { error: upErro } = await supabase.storage
      .from("exames")
      .upload(caminho, arquivo, { upsert: false, contentType: arquivo.type || undefined });
    if (upErro) {
      setErro(`Não consegui guardar o documento: ${upErro.message}`);
      setSalvando(false);
      return;
    }

    const payload = calc.map(({ l, r }) => ({
      analito_id: r.alvo?.id ?? null,
      nome: l.nome.trim(),
      valor: r.valorFinal,
      unidade: r.unidadeFinal || null,
      valor_original: r.convertido ? num(l.valor) : null,
      unidade_original: r.convertido ? l.unidade.trim() : null,
      convertido: r.convertido,
      ref_min: r.refMinFinal,
      ref_max: r.refMaxFinal,
      corrigido_manualmente: l.editado,
    }));

    const { error } = await supabase.rpc("confirmar_exame", {
      p_idoso: idosoId,
      p_tipo: revisao.tipo.trim() || null,
      p_laboratorio: revisao.laboratorio.trim() || null,
      p_data: new Date(`${revisao.data}T12:00:00`).toISOString(),
      p_arquivo_url: caminho,
      p_resultados: payload,
    });
    if (error) {
      setErro(error.message);
      setSalvando(false);
      return;
    }

    if (pedidoDeOrigem.current) {
      const falha = await encerrarExame(supabase, pedidoDeOrigem.current);
      if (falha) setErro("Os valores foram salvos, mas o pedido continua aberto. Conclua em Pedidos de exame.");
      pedidoDeOrigem.current = null;
    }

    setRevisao(null);
    setArquivo(null);
    setSalvando(false);
    await carregar();
  }

  if (membership?.role === "cuidador") {
    return membership.idosoId ? (
      <div className="mx-auto flex max-w-md flex-col gap-4">
        <h1 className="text-2xl font-semibold text-ink">Exames</h1>
        <ResultadosExame idosoId={membership.idosoId} />
      </div>
    ) : null;
  }

  if (!membership) {
    return (
      <p className="text-sm text-subtle">
        Crie o perfil do idoso primeiro para cadastrar exames.
      </p>
    );
  }

  const calculadas = revisao?.linhas.map((l) => resolver(l, analitos)) ?? [];
  const temErro = calculadas.some((c) => c.erro);

  const contagem: Record<string, number> = {};
  for (const lista of Object.values(resultados)) {
    for (const r of lista) contagem[r.analito_id] = (contagem[r.analito_id] ?? 0) + 1;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Exames</h1>
        <p className="text-sm text-subtle">
          Envie o laudo de {membership.idosoNome} (foto ou PDF). A IA lê os valores
          e você confere todos de uma vez contra o papel. Só o que for confirmado
          entra no sistema.
        </p>
      </div>

      <Card className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-ink">Novo exame</h2>
        <input
          type="file"
          accept="image/*,application/pdf"
          onChange={(e) => {
            setArquivo(e.target.files?.[0] ?? null);
            setRevisao(null);
            setErro(null);
          }}
          className="text-sm text-subtle file:mr-3 file:rounded-lg file:border file:border-line file:bg-panel file:px-3 file:py-2 file:text-sm file:text-ink"
        />
        {arquivo && <p className="text-sm text-ink">Arquivo escolhido: {arquivo.name}</p>}
        {erro && !revisao && <p className="text-sm text-danger">{erro}</p>}
        <Button variant="primary" onClick={ler} disabled={!arquivo || lendo} className="self-start">
          {lendo ? "Lendo o exame..." : "Ler exame"}
        </Button>
        {lendo && <IACarregando rotulo="Lendo o exame..." />}
        <p className="text-xs text-subtle">
          O documento é enviado à {NOME_PROVEDOR} para a leitura. Enquanto você
          não confirma, nada é salvo aqui: nem o arquivo, nem os valores.
          {AVISO_PLANO_GRATIS}
        </p>
      </Card>

      {revisao && (
        <Card className="flex flex-col gap-4 border-primary/40">
          <h2 className="text-sm font-medium text-ink">
            Confira contra o documento ({revisao.linhas.length}{" "}
            {revisao.linhas.length === 1 ? "resultado" : "resultados"})
          </h2>
          {!revisao.legivel && (
            <p className="rounded-lg bg-warn/10 p-3 text-sm text-warn">
              A leitura não teve certeza de tudo. Confira com atenção cada linha.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Tipo de exame">
              <Input value={revisao.tipo} onChange={(e) => setRevisao({ ...revisao, tipo: e.target.value })} />
            </Field>
            <Field label="Laboratório">
              <Input
                value={revisao.laboratorio}
                onChange={(e) => setRevisao({ ...revisao, laboratorio: e.target.value })}
              />
            </Field>
            <Field label="Data da coleta">
              <Input
                type="date"
                value={revisao.data}
                onChange={(e) => setRevisao({ ...revisao, data: e.target.value })}
              />
            </Field>
          </div>

          <div className="flex flex-col">
            {revisao.linhas.map((l, i) => {
              const c = calculadas[i];
              return (
                <div key={i} className="flex flex-col gap-2 border-t border-line py-3">
                  <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_1fr]">
                    <Input value={l.nome} onChange={(e) => mudar(i, { nome: e.target.value })} placeholder="Exame" />
                    <Input value={l.valor} onChange={(e) => mudar(i, { valor: e.target.value })} placeholder="Valor" inputMode="decimal" />
                    <Input value={l.unidade} onChange={(e) => mudar(i, { unidade: e.target.value })} placeholder="Unidade" />
                    <Input value={l.refMin} onChange={(e) => mudar(i, { refMin: e.target.value })} placeholder="Ref. min" inputMode="decimal" />
                    <Input value={l.refMax} onChange={(e) => mudar(i, { refMax: e.target.value })} placeholder="Ref. max" inputMode="decimal" />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {c.erro ? (
                        <span className="text-xs text-danger">{c.erro}</span>
                      ) : c.novo ? (
                        <Badge tone="primary">exame novo</Badge>
                      ) : (
                        <Badge tone="neutral">{c.alvo?.nome_canonico}</Badge>
                      )}
                      {c.convertido && !c.erro && (
                        <Badge tone="warn">
                          convertido: {fmt(num(l.valor))} {l.unidade} → {fmt(c.valorFinal)} {c.unidadeFinal}
                        </Badge>
                      )}
                    </div>
                    <Button variant="ghost" onClick={() => remover(i)} className="h-7 px-2 text-xs">
                      Remover linha
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          {erro && <p className="text-sm text-danger">{erro}</p>}
          <div className="flex gap-2">
            <Button variant="primary" onClick={confirmar} disabled={salvando || temErro || revisao.linhas.length === 0}>
              {salvando ? "Confirmando..." : "Confirmar exame"}
            </Button>
            <Button variant="ghost" onClick={() => setRevisao(null)} disabled={salvando}>
              Descartar
            </Button>
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-ink">Exames confirmados</h2>
        {carregando && <p className="text-sm text-subtle">Carregando...</p>}
        {!carregando && exames.length === 0 && (
          <p className="text-sm text-subtle">Nenhum exame confirmado ainda.</p>
        )}
        {exames.map((e) => (
          <Card key={e.id} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setAbertos({ ...abertos, [e.id]: !abertos[e.id] })}
                className="text-left"
              >
                <p className="text-sm font-medium text-ink">
                  {e.tipo || "Exame"} · {dataCurta(e.data)}
                </p>
                <p className="text-xs text-subtle">
                  {[
                    e.laboratorio,
                    `${(resultados[e.id] ?? []).length} resultado${(resultados[e.id] ?? []).length === 1 ? "" : "s"}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </button>
              {docs[e.id] && (
                <a href={docs[e.id]} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                  Ver documento
                </a>
              )}
              {membership.admin && (
                <Link href={`/revisar?exame=${e.id}`} className="text-xs text-primary hover:underline">
                  Corrigir
                </Link>
              )}
              <Button
                variant="ghost"
                onClick={() => removerExame(e.id)}
                className="h-7 px-2 text-xs"
              >
                Remover
              </Button>
            </div>
            {abertos[e.id] && (
              <div className="flex flex-col gap-1 border-t border-line pt-2">
                {(resultados[e.id] ?? []).map((r, i) => (
                  <p key={i} className="text-sm text-ink">
                    <span className="font-medium">{r.analito?.nome_canonico}</span>{" "}
                    {fmt(r.valor)} {r.unidade}
                    {r.ref_min !== null || r.ref_max !== null ? (
                      <span className="text-subtle">
                        {" "}
                        (ref. {faixaTexto(r.ref_min, r.ref_max)})
                      </span>
                    ) : null}
                    {r.convertido && (
                      <span className="text-subtle">
                        {" "}
                        · original {fmt(r.valor_original)} {r.unidade_original}
                      </span>
                    )}
                  </p>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>

      {analitos.length >= 2 && (
        <details className="group rounded-xl border border-line bg-card">
          <summary className="cursor-pointer list-none px-5 py-3 text-sm text-subtle hover:text-ink">
            O mesmo exame apareceu com dois nomes?{" "}
            <span className="text-primary group-open:hidden">Unir nomes</span>
          </summary>
          <div className="flex flex-col gap-4 border-t border-line px-5 py-4">
            <p className="text-xs text-subtle">
              Acontece quando laboratórios chamam o mesmo exame de jeitos
              diferentes (por exemplo &quot;Glicemia&quot; e &quot;Glicose em
              jejum&quot;). Ao unir, os resultados passam a aparecer na mesma série
              do gráfico. Só da para unir nomes que usam a mesma unidade, e não
              existe botao para desfazer.
            </p>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-subtle">1. Qual nome deve ficar?</span>
              <select
                value={manter}
                onChange={(e) => {
                  setManter(e.target.value);
                  setUnir("");
                  setErroFusao(null);
                }}
                className="h-10 rounded-lg border border-line bg-card px-2 text-sm text-ink"
              >
                <option value="">Escolha...</option>
                {analitos.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nome_canonico}
                    {a.unidade_canonica ? ` (${a.unidade_canonica})` : ""}
                  </option>
                ))}
              </select>
            </label>

            {(() => {
              const fica = analitos.find((a) => a.id === manter);
              if (!fica) return null;
              const candidatos = analitos.filter(
                (b) =>
                  b.id !== fica.id &&
                  normalizarUnidade(b.unidade_canonica) ===
                    normalizarUnidade(fica.unidade_canonica),
              );
              const some = analitos.find((a) => a.id === unir);
              const n = some ? (contagem[some.id] ?? 0) : 0;

              if (candidatos.length === 0) {
                return (
                  <p className="rounded-lg bg-panel p-3 text-sm text-subtle">
                    Não há outro nome na mesma unidade
                    {fica.unidade_canonica ? ` (${fica.unidade_canonica})` : ""} para
                    unir a &quot;{fica.nome_canonico}&quot;.
                  </p>
                );
              }

              return (
                <>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-subtle">
                      2. Qual nome repetido deve sumir?
                    </span>
                    <select
                      value={unir}
                      onChange={(e) => setUnir(e.target.value)}
                      className="h-10 rounded-lg border border-line bg-card px-2 text-sm text-ink"
                    >
                      <option value="">Escolha...</option>
                      {candidatos.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.nome_canonico}
                        </option>
                      ))}
                    </select>
                  </label>

                  {some && (
                    <div className="flex flex-col gap-3 rounded-lg bg-panel p-3">
                      <p className="text-sm text-ink">
                        {n === 0
                          ? `"${some.nome_canonico}" não tem resultados; ele só deixa de aparecer na lista.`
                          : `${n} resultado${n > 1 ? "s" : ""} de "${some.nome_canonico}" passara${n > 1 ? "o" : ""} a aparecer como "${fica.nome_canonico}".`}
                      </p>
                      <Button
                        variant="primary"
                        onClick={unirNomes}
                        disabled={fundindo}
                        className="self-start"
                      >
                        {fundindo ? "Unindo..." : "Unir nomes"}
                      </Button>
                    </div>
                  )}
                </>
              );
            })()}

            {erroFusao && <p className="text-sm text-danger">{erroFusao}</p>}
          </div>
        </details>
      )}
    </div>
  );
}
