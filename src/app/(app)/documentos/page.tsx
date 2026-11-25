"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Badge, Button, Card, Input } from "@/components/ui";
import { DocumentosCuidadora } from "@/components/papeis";
import { abrirArquivo, LIMITE_DOCUMENTO as LIMITE, nomeSeguro, rotuloEnvio, TIPOS_ACEITOS } from "@/lib/documentos";

type Pasta = { id: string; pai_id: string | null; nome: string };

type Doc = {
  id: string;
  pasta_id: string | null;
  nome: string;
  arquivo_url: string;
  tipo: string | null;
  tamanho: number | null;
  autor_id: string | null;
  created_at: string;
  levar_consulta: boolean;
  envio: string | null;
  guardado_em: string | null;
};

/** Pastas que o sistema monta sozinho a partir do que já existe: nada é duplicado. */
type Auto = {
  id: "exames" | "receitas" | "consultas" | "diretivas" | "folha";
  titulo: string;
  descricao: string;
};

const AUTOMATICAS: Auto[] = [
  { id: "exames", titulo: "Exames", descricao: "Laudos já enviados e confirmados." },
  { id: "receitas", titulo: "Receitas", descricao: "Fotos e PDFs das receitas." },
  { id: "consultas", titulo: "Consultas", descricao: "Áudios das consultas gravadas." },
  { id: "diretivas", titulo: "Diretivas", descricao: "PDFs das diretivas antecipadas." },
  { id: "folha", titulo: "Folha de cuidado", descricao: "Resumo para quem começa a cuidar." },
];

const SUGESTOES = ["Identificação", "Plano de saúde", "Benefícios e INSS", "Contratos e financeiro", "Outros"];

type ItemAuto = { id: string; rotulo: string; detalhe: string; bucket: string; caminho: string };

function dataBr(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
}

function tamanhoLegivel(b: number | null) {
  if (!b) return "";
  return b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function IconePasta({ auto }: { auto?: boolean }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        {auto && <path d="M12 11v4M10 13h4" />}
      </svg>
    </span>
  );
}

/** Quem cuida não vê pastas: só o que levar e o envio de foto. */
export default function DocumentosPage() {
  const membership = useRole();
  if (membership?.role === "cuidador" && membership.idosoId) {
    return <DocumentosCuidadora idosoId={membership.idosoId} nome={membership.idosoNome ?? ""} />;
  }
  return <DocumentosFamilia />;
}

function DocumentosFamilia() {
  const supabase = createClient();
  const membership = useRole();
  const idosoId = membership?.idosoId;
  const admin = !!membership?.admin;

  const [versao, setVersao] = useState(0);
  const [pastas, setPastas] = useState<Pasta[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [contagemAuto, setContagemAuto] = useState<Record<string, number>>({});
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [carregando, setCarregando] = useState(true);

  // null = raiz; "auto:exames" etc. = pasta automática; senão, o id de uma pasta
  const [atual, setAtual] = useState<string | null>(null);
  const [itensAuto, setItensAuto] = useState<ItemAuto[]>([]);

  const [novaPasta, setNovaPasta] = useState(false);
  const [nomePasta, setNomePasta] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = () => setVersao((v) => v + 1);

  useEffect(() => {
    if (!idosoId) return;
    let cancelado = false;
    (async () => {
      const [{ data: ps }, { data: ds }] = await Promise.all([
        supabase
          .from("documento_pasta")
          .select("id, pai_id, nome")
          .eq("idoso_id", idosoId)
          .is("deleted_at", null)
          .order("nome"),
        supabase
          .from("documento")
          .select("id, pasta_id, nome, arquivo_url, tipo, tamanho, autor_id, created_at, levar_consulta, envio, guardado_em")
          .eq("idoso_id", idosoId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
      ]);

      // `suave`: a tabela tem deleted_at (a de diretivas não tem, pois é imutável).
      const cont = async (tabela: string, coluna: string, suave = true) => {
        let q = supabase
          .from(tabela)
          .select("id", { count: "exact", head: true })
          .eq("idoso_id", idosoId)
          .not(coluna, "is", null);
        if (suave) q = q.is("deleted_at", null);
        const { count } = await q;
        return count ?? 0;
      };
      const [ex, re, co, di] = await Promise.all([
        cont("exame", "arquivo_url"),
        cont("receita", "arquivo_url"),
        cont("consulta", "audio_url"),
        cont("diretiva", "pdf_url", false),
      ]);

      const autores = [...new Set((ds ?? []).map((d) => d.autor_id as string | null).filter(Boolean))] as string[];
      const { data: us } = autores.length
        ? await supabase.from("usuario").select("id, nome").in("id", autores)
        : { data: [] as { id: string; nome: string | null }[] };

      if (cancelado) return;
      setPastas((ps ?? []) as Pasta[]);
      setDocs((ds ?? []) as Doc[]);
      setContagemAuto({ exames: ex, receitas: re, consultas: co, diretivas: di });
      setNomes(Object.fromEntries((us ?? []).map((u) => [u.id as string, (u.nome as string) ?? "Alguém da rede"])));
      setCarregando(false);
    })();
    return () => {
      cancelado = true;
    };
  }, [supabase, idosoId, versao]);

  // Conteúdo de uma pasta automática, lido da tabela de origem.
  useEffect(() => {
    if (!idosoId || !atual?.startsWith("auto:")) return;
    const qual = atual.slice(5);
    let cancelado = false;
    (async () => {
      let itens: ItemAuto[] = [];
      if (qual === "exames") {
        const { data } = await supabase
          .from("exame")
          .select("id, tipo, laboratorio, data, arquivo_url")
          .eq("idoso_id", idosoId)
          .is("deleted_at", null)
          .not("arquivo_url", "is", null)
          .order("data", { ascending: false });
        itens = (data ?? []).map((e) => ({
          id: e.id as string,
          rotulo: `Exame ${e.data ? dataBr(e.data as string) : ""}`.trim(),
          detalhe: [e.laboratorio, e.tipo].filter(Boolean).join(" · "),
          bucket: "exames",
          caminho: e.arquivo_url as string,
        }));
      } else if (qual === "receitas") {
        const { data } = await supabase
          .from("receita")
          .select("id, medico, data, arquivo_url, created_at")
          .eq("idoso_id", idosoId)
          .is("deleted_at", null)
          .not("arquivo_url", "is", null)
          .order("created_at", { ascending: false });
        itens = (data ?? []).map((r) => ({
          id: r.id as string,
          rotulo: `Receita ${dataBr((r.data as string) ?? (r.created_at as string))}`,
          detalhe: (r.medico as string) ?? "",
          bucket: "receitas",
          caminho: r.arquivo_url as string,
        }));
      } else if (qual === "consultas") {
        const { data } = await supabase
          .from("consulta")
          .select("id, data, medico, especialidade, audio_url")
          .eq("idoso_id", idosoId)
          .is("deleted_at", null)
          .not("audio_url", "is", null)
          .order("data", { ascending: false });
        itens = (data ?? []).map((c) => ({
          id: c.id as string,
          rotulo: `Áudio da consulta ${c.data ? dataBr(c.data as string) : ""}`.trim(),
          detalhe: [c.medico, c.especialidade].filter(Boolean).join(" · "),
          bucket: "consultas",
          caminho: c.audio_url as string,
        }));
      } else if (qual === "diretivas") {
        const { data } = await supabase
          .from("diretiva")
          .select("id, gerada_em, vigente, pdf_url")
          .eq("idoso_id", idosoId)
          .not("pdf_url", "is", null)
          .order("gerada_em", { ascending: false });
        itens = (data ?? []).map((d) => ({
          id: d.id as string,
          rotulo: `Diretiva de ${dataBr(d.gerada_em as string)}`,
          detalhe: d.vigente ? "vigente" : "substituída",
          bucket: "diretivas",
          caminho: d.pdf_url as string,
        }));
      }
      if (!cancelado) setItensAuto(itens);
    })();
    return () => {
      cancelado = true;
    };
  }, [supabase, idosoId, atual]);

  async function abrir(bucket: string, caminho: string) {
    setErro(await abrirArquivo(supabase, bucket, caminho));
  }

  async function criarPasta(nome: string) {
    if (!idosoId || !nome.trim()) return;
    setErro(null);
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase.from("documento_pasta").insert({
      idoso_id: idosoId,
      pai_id: atual && !atual.startsWith("auto:") ? atual : null,
      nome: nome.trim(),
      criado_por: auth.user?.id ?? null,
    });
    if (error) setErro("Não consegui criar a pasta.");
    setNomePasta("");
    setNovaPasta(false);
    recarregar();
  }

  async function enviar(arquivo: File) {
    if (!idosoId) return;
    setErro(null);
    if (!TIPOS_ACEITOS.includes(arquivo.type)) {
      setErro("Tipo de arquivo não aceito. Use PDF ou imagem (JPG, PNG, WEBP ou HEIC).");
      return;
    }
    if (arquivo.size > LIMITE) {
      setErro("O arquivo passa de 15 MB. Envie uma versão menor.");
      return;
    }
    setEnviando(true);
    const { data: auth } = await supabase.auth.getUser();
    const caminho = `${idosoId}/${crypto.randomUUID()}-${nomeSeguro(arquivo.name)}`;
    const pastaId = atual && !atual.startsWith("auto:") ? atual : null;

    // A linha entra primeiro (e a política só deixa o administrador); se o envio falhar, ela é escondida.
    const { data: linha, error: e1 } = await supabase
      .from("documento")
      .insert({
        idoso_id: idosoId,
        pasta_id: pastaId,
        nome: arquivo.name.replace(/\.[^.]+$/, ""),
        arquivo_url: caminho,
        tipo: arquivo.type,
        tamanho: arquivo.size,
        autor_id: auth.user?.id ?? null,
      })
      .select("id")
      .single();
    if (e1 || !linha) {
      setErro("Não consegui registrar o documento.");
      setEnviando(false);
      return;
    }
    const { error: e2 } = await supabase.storage.from("documentos").upload(caminho, arquivo, {
      contentType: arquivo.type,
      upsert: false,
    });
    if (e2) {
      await supabase.from("documento").update({ deleted_at: new Date().toISOString() }).eq("id", linha.id);
      setErro("O envio falhou. Tente de novo.");
    }
    setEnviando(false);
    recarregar();
  }

  async function renomearDoc(d: Doc) {
    const novo = window.prompt("Novo nome do documento:", d.nome)?.trim();
    if (!novo || novo === d.nome) return;
    await supabase.from("documento").update({ nome: novo }).eq("id", d.id);
    recarregar();
  }

  async function atualizarDoc(d: Doc, campos: Record<string, unknown>) {
    const { error } = await supabase.from("documento").update(campos).eq("id", d.id);
    setErro(error ? "Não consegui salvar." : null);
    recarregar();
  }

  // Mexer num envio de quem cuida já o tira da caixa de entrada.
  const aoOrganizar = (d: Doc) => (d.envio && !d.guardado_em ? { guardado_em: new Date().toISOString() } : {});
  const moverDoc = (d: Doc, pastaId: string) => atualizarDoc(d, { pasta_id: pastaId || null, ...aoOrganizar(d) });
  const alternarLevar = (d: Doc) => atualizarDoc(d, { levar_consulta: !d.levar_consulta, ...aoOrganizar(d) });

  async function removerDoc(d: Doc) {
    if (!window.confirm(`Remover "${d.nome}"? Ele deixa de aparecer na lista.`)) return;
    await supabase.from("documento").update({ deleted_at: new Date().toISOString() }).eq("id", d.id);
    recarregar();
  }

  async function renomearPasta(p: Pasta) {
    const novo = window.prompt("Novo nome da pasta:", p.nome)?.trim();
    if (!novo || novo === p.nome) return;
    await supabase.from("documento_pasta").update({ nome: novo }).eq("id", p.id);
    recarregar();
  }

  async function removerPasta(p: Pasta) {
    const temConteudo =
      docs.some((d) => d.pasta_id === p.id) || pastas.some((x) => x.pai_id === p.id);
    if (temConteudo) {
      setErro("Esta pasta ainda tem documentos ou subpastas. Mova ou remova o conteúdo antes.");
      return;
    }
    if (!window.confirm(`Remover a pasta "${p.nome}"?`)) return;
    await supabase.from("documento_pasta").update({ deleted_at: new Date().toISOString() }).eq("id", p.id);
    setAtual(p.pai_id);
    recarregar();
  }

  if (!membership) {
    return <p className="text-sm text-subtle">Crie o perfil do idoso primeiro para guardar documentos.</p>;
  }

  const pastaAtual = atual && !atual.startsWith("auto:") ? pastas.find((p) => p.id === atual) ?? null : null;
  const autoAtual = atual?.startsWith("auto:") ? AUTOMATICAS.find((a) => a.id === atual.slice(5)) ?? null : null;
  const subpastas = pastas.filter((p) => (p.pai_id ?? null) === (pastaAtual?.id ?? null));
  // Envios de quem cuida que ainda ninguém guardou ficam numa caixa própria.
  const novos = docs.filter((d) => d.envio && !d.guardado_em);
  const docsAqui = docs.filter(
    (d) => (d.pasta_id ?? null) === (pastaAtual?.id ?? null) && !(d.envio && !d.guardado_em),
  );
  const nDocsEm = (id: string) => docs.filter((d) => d.pasta_id === id).length;

  // caminho de migalhas
  const migalhas: Pasta[] = [];
  for (let p = pastaAtual; p; p = pastas.find((x) => x.id === p!.pai_id) ?? null) migalhas.unshift(p);

  const naRaiz = !atual;
  const autoVisiveis = AUTOMATICAS;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Documentos</h1>
        <p className="text-sm text-subtle">
          Os documentos de {membership.idosoNome} num só lugar: certidões, carteirinha do plano, RG e o que mais
          fizer falta. {admin ? "Só você, como administrador, envia e organiza." : "Quem administra envia e organiza; aqui você consulta."}
        </p>
      </div>

      {/* migalhas */}
      <nav aria-label="Caminho" className="flex flex-wrap items-center gap-1 text-sm">
        <button type="button" onClick={() => setAtual(null)} className={naRaiz ? "font-medium text-ink" : "text-primary hover:underline"}>
          Documentos
        </button>
        {autoAtual && (
          <>
            <span className="text-subtle">/</span>
            <span className="font-medium text-ink">{autoAtual.titulo}</span>
          </>
        )}
        {migalhas.map((m, i) => (
          <span key={m.id} className="flex items-center gap-1">
            <span className="text-subtle">/</span>
            {i === migalhas.length - 1 ? (
              <span className="font-medium text-ink">{m.nome}</span>
            ) : (
              <button type="button" onClick={() => setAtual(m.id)} className="text-primary hover:underline">
                {m.nome}
              </button>
            )}
          </span>
        ))}
      </nav>

      {erro && <p className="text-sm text-danger" role="alert">{erro}</p>}

      {/* pasta automática aberta */}
      {autoAtual ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-subtle">
            Pasta automática: reúne o que já está no sistema, sem copiar arquivo. Para mudar algo, vá à tela de origem.
          </p>
          {autoAtual.id === "folha" ? (
            <Card className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-ink">Folha &quot;como cuidar de {membership.idosoNome}&quot;</p>
                <p className="text-xs text-subtle">Gerada na hora, com os dados mais recentes.</p>
              </div>
              <Link href="/folha" className="text-sm font-medium text-primary hover:underline">Abrir</Link>
            </Card>
          ) : itensAuto.length === 0 ? (
            <Card><p className="text-sm text-subtle">Nada aqui ainda.</p></Card>
          ) : (
            itensAuto.map((it) => (
              <Card key={it.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{it.rotulo}</p>
                  {it.detalhe && <p className="truncate text-xs text-subtle">{it.detalhe}</p>}
                </div>
                <Button onClick={() => abrir(it.bucket, it.caminho)} className="h-8 shrink-0 px-3 text-xs">Abrir</Button>
              </Card>
            ))
          )}
        </div>
      ) : (
        <>
          {/* ações do administrador */}
          {admin && (
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => setNovaPasta(!novaPasta)}>Nova pasta</Button>
              <label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-white hover:opacity-90">
                {enviando ? "Enviando..." : "Enviar documento"}
                <input
                  type="file"
                  className="sr-only"
                  accept=".pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
                  disabled={enviando}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) enviar(f);
                  }}
                />
              </label>
              <span className="text-xs text-subtle">PDF ou imagem, até 15 MB.</span>
            </div>
          )}

          {admin && novaPasta && (
            <Card className="flex flex-col gap-3">
              <h2 className="text-sm font-medium text-ink">Nova pasta{pastaAtual ? ` dentro de ${pastaAtual.nome}` : ""}</h2>
              <Input
                value={nomePasta}
                onChange={(e) => setNomePasta(e.target.value)}
                placeholder="Ex: Plano de saúde"
                maxLength={80}
                autoFocus
              />
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => criarPasta(nomePasta)} disabled={!nomePasta.trim()}>
                  Criar pasta
                </Button>
                <Button variant="ghost" onClick={() => setNovaPasta(false)}>Cancelar</Button>
              </div>
            </Card>
          )}

          {naRaiz && novos.length > 0 && (
            <Card className="flex flex-col gap-3 border-warn/50">
              <h2 className="text-sm font-semibold text-ink">Enviados por quem cuida ({novos.length})</h2>
              {novos.map((d) => (
                <div key={d.id} className="flex flex-col gap-2 border-t border-line pt-3">
                  <p className="text-sm text-ink">
                    <strong>{rotuloEnvio(d.envio)}</strong> · {d.nome}
                    <span className="block text-xs text-subtle">
                      {dataBr(d.created_at)}
                      {d.autor_id ? ` · enviado por ${nomes[d.autor_id] ?? "alguém da rede"}` : ""}
                    </span>
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={() => abrir("documentos", d.arquivo_url)} className="h-9 px-3 text-xs">Abrir</Button>
                    {d.envio === "receita" && (
                      <Link href={`/receitas?documento=${d.id}`} className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-xs font-medium text-ink hover:bg-panel">
                        Ler como receita
                      </Link>
                    )}
                    {admin && (
                      <>
                        <select aria-label={`Guardar ${d.nome} em uma pasta`} value="" onChange={(e) => e.target.value && moverDoc(d, e.target.value === "-" ? "" : e.target.value)} className="h-9 rounded-lg border border-line bg-card px-2 text-xs text-ink">
                          <option value="">Guardar em...</option>
                          <option value="-">Sem pasta</option>
                          {pastas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                        </select>
                        <Button variant="ghost" onClick={() => alternarLevar(d)} className="h-9 px-2 text-xs">Levar nas consultas</Button>
                        <Button variant="ghost" onClick={() => removerDoc(d)} className="h-9 px-2 text-xs">Remover</Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </Card>
          )}

          {/* pastas automáticas (só na raiz) */}
          {naRaiz && (
            <section className="flex flex-col gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">Automáticas</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {autoVisiveis.map((a) => (
                  <button key={a.id} type="button" onClick={() => setAtual(`auto:${a.id}`)} className="text-left">
                    <Card className="flex h-full items-center gap-3 transition-colors hover:border-primary/40">
                      <IconePasta auto />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-ink">{a.titulo}</span>
                        <span className="block truncate text-xs text-subtle">
                          {a.id === "folha" ? a.descricao : `${contagemAuto[a.id] ?? 0} ${(contagemAuto[a.id] ?? 0) === 1 ? "arquivo" : "arquivos"}`}
                        </span>
                      </span>
                    </Card>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* pastas do usuário */}
          <section className="flex flex-col gap-2">
            {(naRaiz || subpastas.length > 0) && (
              <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">
                {naRaiz ? "Suas pastas" : "Subpastas"}
              </h2>
            )}
            {carregando && <p className="text-sm text-subtle">Carregando...</p>}
            {!carregando && naRaiz && subpastas.length === 0 && (
              <Card className="flex flex-col gap-3">
                <p className="text-sm text-ink">Ainda não há pastas.</p>
                {admin ? (
                  <>
                    <p className="text-xs text-subtle">Comece por uma sugestão, ou crie a sua em &quot;Nova pasta&quot;:</p>
                    <div className="flex flex-wrap gap-2">
                      {SUGESTOES.map((s) => (
                        <Button key={s} onClick={() => criarPasta(s)} className="h-8 px-3 text-xs">
                          + {s}
                        </Button>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-subtle">Quem administra ainda não organizou os documentos.</p>
                )}
              </Card>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {subpastas.map((p) => (
                <Card key={p.id} className="flex items-center gap-3">
                  <button type="button" onClick={() => setAtual(p.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <IconePasta />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{p.nome}</span>
                      <span className="block text-xs text-subtle">
                        {nDocsEm(p.id)} {nDocsEm(p.id) === 1 ? "arquivo" : "arquivos"}
                      </span>
                    </span>
                  </button>
                </Card>
              ))}
            </div>
          </section>

          {/* ações da pasta aberta */}
          {admin && pastaAtual && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Button variant="ghost" onClick={() => renomearPasta(pastaAtual)} className="h-8 px-2 text-xs">Renomear</Button>
              <Button variant="ghost" onClick={() => removerPasta(pastaAtual)} className="h-8 px-2 text-xs">Remover pasta</Button>
            </div>
          )}

          {/* documentos */}
          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">
              {naRaiz ? "Documentos soltos" : "Documentos"}
            </h2>
            {!carregando && docsAqui.length === 0 && (
              <p className="text-sm text-subtle">
                {naRaiz ? "Nenhum documento solto." : "Nenhum documento nesta pasta."}
                {admin ? " Use Enviar documento." : ""}
              </p>
            )}
            {docsAqui.map((d) => (
              <Card key={d.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{d.nome}</p>
                  <p className="text-xs text-subtle">
                    {[dataBr(d.created_at), tamanhoLegivel(d.tamanho), d.autor_id ? `enviado por ${nomes[d.autor_id] ?? "alguém da rede"}` : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {admin ? (
                    <label className="mt-1 flex w-fit cursor-pointer items-center gap-2 text-xs text-ink">
                      <input type="checkbox" checked={d.levar_consulta} onChange={() => alternarLevar(d)} />
                      Levar nas consultas (quem cuida vê)
                    </label>
                  ) : (
                    d.levar_consulta && <Badge tone="primary">levar nas consultas</Badge>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1">
                  <Button onClick={() => abrir("documentos", d.arquivo_url)} className="h-8 px-3 text-xs">Abrir</Button>
                  {admin && (
                    <>
                      <select
                        aria-label={`Mover ${d.nome} para outra pasta`}
                        value={d.pasta_id ?? ""}
                        onChange={(e) => moverDoc(d, e.target.value)}
                        className="h-8 max-w-32 rounded-lg border border-line bg-card px-1 text-xs text-ink"
                      >
                        <option value="">Sem pasta</option>
                        {pastas.map((p) => (
                          <option key={p.id} value={p.id}>{p.nome}</option>
                        ))}
                      </select>
                      <Button variant="ghost" onClick={() => renomearDoc(d)} className="h-8 px-2 text-xs">Renomear</Button>
                      <Button variant="ghost" onClick={() => removerDoc(d)} className="h-8 px-2 text-xs">Remover</Button>
                    </>
                  )}
                </div>
              </Card>
            ))}
          </section>

          {naRaiz && admin && (
            <p className="text-xs text-subtle">
              Quem cuida não vê as pastas: vê só os documentos marcados como &quot;levar nas consultas&quot; e o que ela
              mesma enviou.
            </p>
          )}
          <p className="text-xs text-subtle">
            Os documentos ficam guardados com acesso restrito e não são enviados à IA, a não ser que você escolha ler uma receita. Os links de abertura valem por poucos minutos.
          </p>
        </>
      )}
    </div>
  );
}
