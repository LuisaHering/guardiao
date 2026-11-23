"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Badge, Button, Card } from "@/components/ui";
import { IACarregando } from "@/components/ia-carregando";
import { AVISO_PLANO_GRATIS, NOME_PROVEDOR } from "@/lib/ai/nome-provedor";
import { MARCA_ERRO } from "@/lib/chat-marca";
import { gravarProposta } from "@/lib/ingestao";
import { ROTULO_TIPO, type DadosProposta, type Proposta } from "@/lib/propostas";

type Conversa = {
  id: string;
  tipo: "livre" | "checkin_diario";
  status: "pendente" | "concluida";
  data_referencia: string | null;
  created_at: string;
};

type Mensagem = {
  id: string;
  papel_emissor: "user" | "assistant";
  conteudo: string;
  autor_id: string | null;
  created_at: string;
};

function dataBr(iso: string | null) {
  return iso ? iso.slice(0, 10).split("-").reverse().join("/") : "";
}

function rotuloConversa(c: Conversa) {
  const dia = dataBr(c.data_referencia ?? c.created_at);
  return `${c.tipo === "checkin_diario" ? "Check-in" : "Conversa"} de ${dia}${c.status === "concluida" ? " (encerrada)" : ""}`;
}

/** Campos editaveis de cada tipo de proposta. */
function camposDe(d: DadosProposta): { campo: string; rotulo: string; valor: string }[] {
  switch (d.tipo) {
    case "preferencia":
      return [
        { campo: "chave", rotulo: "Sobre", valor: d.chave },
        { campo: "valor", rotulo: "O quê", valor: d.valor },
      ];
    case "memoria":
      return [
        { campo: "titulo", rotulo: "Título", valor: d.titulo },
        { campo: "conteudo", rotulo: "Memória", valor: d.conteudo },
      ];
    case "humor":
      return [{ campo: "valor", rotulo: "Humor", valor: d.valor }];
    case "diario":
      return [
        { campo: "alimentacao", rotulo: "Alimentação", valor: d.alimentacao ?? "" },
        { campo: "ocorrencias", rotulo: "Ocorrências", valor: d.ocorrencias ?? "" },
      ];
    case "sintoma":
      return [{ campo: "descricao", rotulo: "Sintoma", valor: d.descricao }];
    case "medicacao":
      return [];
    case "pauta":
      return [
        { campo: "titulo", rotulo: "Para a pauta", valor: d.titulo },
        { campo: "detalhe", rotulo: "Detalhe", valor: d.detalhe ?? "" },
      ];
  }
}

export default function ConversaPage() {
  const supabase = createClient();
  const membership = useRole();
  const idosoId = membership?.idosoId;

  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [atual, setAtual] = useState<Conversa | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [meuId, setMeuId] = useState<string | null>(null);

  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [parcial, setParcial] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const [propostas, setPropostas] = useState<Proposta[] | null>(null);
  const [descartadas, setDescartadas] = useState(0);
  const [marcadas, setMarcadas] = useState<Record<string, boolean>>({});
  const [edicoes, setEdicoes] = useState<Record<string, Record<string, string>>>({});
  const [extraindo, setExtraindo] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const fim = useRef<HTMLDivElement>(null);

  const carregarLista = useCallback(async () => {
    if (!idosoId) return;
    const { data } = await supabase
      .from("conversa")
      .select("id, tipo, status, data_referencia, created_at")
      .eq("idoso_id", idosoId)
      .order("created_at", { ascending: false })
      .limit(20);
    setConversas((data ?? []) as Conversa[]);
  }, [supabase, idosoId]);

  const carregarMensagens = useCallback(
    async (conversaId: string) => {
      const { data } = await supabase
        .from("mensagem")
        .select("id, papel_emissor, conteudo, autor_id, created_at")
        .eq("conversa_id", conversaId)
        .order("created_at");
      const lista = (data ?? []) as Mensagem[];
      setMensagens(lista);
      const ids = [...new Set(lista.map((m) => m.autor_id).filter(Boolean))] as string[];
      if (ids.length) {
        const { data: us } = await supabase.from("usuario").select("id, nome").in("id", ids);
        setNomes(Object.fromEntries((us ?? []).map((u) => [u.id as string, (u.nome as string) ?? "Alguém da rede"])));
      }
    },
    [supabase],
  );

  useEffect(() => {
    if (!idosoId) return;
    let cancelado = false;
    (async () => {
      const { data } = await supabase
        .from("conversa")
        .select("id, tipo, status, data_referencia, created_at")
        .eq("idoso_id", idosoId)
        .order("created_at", { ascending: false })
        .limit(20);
      const { data: eu } = await supabase.auth.getUser();
      if (cancelado) return;
      setConversas((data ?? []) as Conversa[]);
      setMeuId(eu.user?.id ?? null);
    })();
    return () => {
      cancelado = true;
    };
  }, [supabase, idosoId]);

  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mensagens, parcial]);

  function limparRevisao() {
    setPropostas(null);
    setMarcadas({});
    setEdicoes({});
    setAviso(null);
  }

  async function abrir(c: Conversa) {
    setAtual(c);
    setErro(null);
    limparRevisao();
    await carregarMensagens(c.id);
  }

  /** Envia uma fala (ou so pede a abertura da IA, quando texto vem vazio) e le a resposta em fluxo. */
  async function enviar(conversa: Conversa | null, tipo: Conversa["tipo"], fala: string) {
    if (!idosoId || enviando) return;
    setErro(null);
    setEnviando(true);
    setParcial("");
    if (fala) {
      setMensagens((ms) => [
        ...ms,
        { id: "tmp", papel_emissor: "user", conteudo: fala, autor_id: meuId, created_at: new Date().toISOString() },
      ]);
    }
    try {
      const resp = await fetch("/api/conversa/mensagem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idosoId, conversaId: conversa?.id, tipo, texto: fala }),
      });
      if (!resp.ok || !resp.body) {
        const j = await resp.json().catch(() => null);
        setErro(j?.erro ?? "Não consegui enviar a mensagem.");
        if (conversa) await carregarMensagens(conversa.id);
        setEnviando(false);
        return;
      }
      const conversaId = resp.headers.get("X-Conversa-Id") as string;
      const leitor = resp.body.getReader();
      const dec = new TextDecoder();
      let acumulado = "";
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        acumulado += dec.decode(value, { stream: true });
        const i = acumulado.indexOf(MARCA_ERRO);
        setParcial(i === -1 ? acumulado : acumulado.slice(0, i));
      }
      const i = acumulado.indexOf(MARCA_ERRO);
      if (i !== -1) setErro(acumulado.slice(i + MARCA_ERRO.length));

      setParcial("");
      await carregarMensagens(conversaId);
      await carregarLista();
      setAtual((a) => a ?? ({ id: conversaId, tipo, status: "pendente", data_referencia: null, created_at: new Date().toISOString() } as Conversa));
    } catch {
      setErro("Sem conexão com o servidor. Tente de novo.");
    }
    setEnviando(false);
  }

  async function iniciarCheckin() {
    limparRevisao();
    setMensagens([]);
    // Reabre o check-in de hoje, se ainda estiver aberto; senao, comeca um.
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    const aberto = conversas.find((c) => c.tipo === "checkin_diario" && c.status === "pendente" && c.data_referencia === hoje);
    if (aberto) {
      setAtual(aberto);
      await carregarMensagens(aberto.id);
      return;
    }
    setAtual(null);
    await enviar(null, "checkin_diario", "");
    await carregarLista();
  }

  function novaLivre() {
    limparRevisao();
    setAtual(null);
    setMensagens([]);
    setErro(null);
  }

  async function mandar(e: React.FormEvent) {
    e.preventDefault();
    const fala = texto.trim();
    if (!fala) return;
    setTexto("");
    await enviar(atual, atual?.tipo ?? "livre", fala);
  }

  async function extrair() {
    if (!idosoId || !atual) return;
    setErro(null);
    setAviso(null);
    setExtraindo(true);
    try {
      const resp = await fetch("/api/conversa/extrair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idosoId, conversaId: atual.id }),
      });
      const j = await resp.json();
      if (!resp.ok) {
        setErro(j.erro ?? "Não consegui ler a conversa.");
      } else {
        const lista = j.propostas as Proposta[];
        setPropostas(lista);
        setDescartadas(j.descartadas ?? 0);
        setMarcadas(Object.fromEntries(lista.map((p) => [p.id, !p.jaRegistrado])));
        setEdicoes({});
      }
    } catch {
      setErro("Sem conexão com o servidor. Tente de novo.");
    }
    setExtraindo(false);
  }

  async function registrar() {
    if (!idosoId || !propostas) return;
    setGravando(true);
    setErro(null);
    let ok = 0;
    const falhas: string[] = [];
    const restantes: Proposta[] = [];
    for (const p of propostas) {
      if (!marcadas[p.id]) {
        restantes.push(p);
        continue;
      }
      const r = await gravarProposta(supabase, idosoId, p, edicoes[p.id]);
      if (r.ok) ok += 1;
      else {
        falhas.push(r.erro ?? "erro");
        restantes.push(p);
      }
    }
    setPropostas(restantes);
    setAviso(
      falhas.length
        ? `${ok} registrado(s); ${falhas.length} não deu(ram) certo: ${falhas[0]}`
        : `${ok} ${ok === 1 ? "item registrado" : "itens registrados"}, cada um com a fala de origem.`,
    );
    setGravando(false);
  }

  async function encerrar() {
    if (!atual) return;
    await supabase.from("conversa").update({ status: "concluida" }).eq("id", atual.id);
    setAtual({ ...atual, status: "concluida" });
    await carregarLista();
  }

  if (!membership) {
    return <p className="text-sm text-subtle">Crie o perfil do idoso primeiro para conversar.</p>;
  }

  const encerrada = atual?.status === "concluida";
  const falasUsuario = mensagens.filter((m) => m.papel_emissor === "user").length;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Conversa</h1>
        <p className="text-sm text-subtle">
          Converse sobre {membership.idosoNome} ou faça o check-in do dia. Nada do que for dito
          vira registro sozinho: depois da conversa você revisa o que será guardado, e cada item
          mostra a fala de onde saiu e quem disse.
        </p>
      </div>

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={iniciarCheckin} disabled={enviando}>
            Check-in de hoje
          </Button>
          <Button onClick={novaLivre} disabled={enviando}>
            Nova conversa livre
          </Button>
        </div>
        {conversas.length > 0 && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-subtle">Conversas anteriores</span>
            <select
              value={atual?.id ?? ""}
              onChange={(e) => {
                const c = conversas.find((x) => x.id === e.target.value);
                if (c) abrir(c);
              }}
              className="h-10 rounded-lg border border-line bg-card px-2 text-sm text-ink"
            >
              <option value="">Escolha uma conversa</option>
              {conversas.map((c) => (
                <option key={c.id} value={c.id}>
                  {rotuloConversa(c)}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="text-xs text-subtle">
          As mensagens e o contexto do cuidado são enviados à {NOME_PROVEDOR} para gerar a resposta.
          {AVISO_PLANO_GRATIS}
        </p>
      </Card>

      <Card className="flex flex-col gap-3">
        {atual && (
          <div className="flex items-center justify-between gap-2">
            <Badge tone="neutral">{rotuloConversa(atual)}</Badge>
          </div>
        )}

        <div className="flex max-h-[28rem] min-h-40 flex-col gap-3 overflow-y-auto pr-1" aria-live="polite">
          {mensagens.length === 0 && !parcial && !enviando && (
            <p className="text-sm text-subtle">
              Comece o check-in do dia ou escreva uma mensagem abaixo.
            </p>
          )}
          {mensagens.map((m) => (
            <Balao
              key={m.id}
              souEu={m.papel_emissor === "user"}
              autor={
                m.papel_emissor === "assistant"
                  ? "Guardião"
                  : m.autor_id === meuId
                    ? "Você"
                    : (m.autor_id && nomes[m.autor_id]) || "Alguém da rede"
              }
              texto={m.conteudo}
            />
          ))}
          {parcial && <Balao souEu={false} autor="Guardião" texto={parcial} />}
          {enviando && !parcial && <IACarregando rotulo="Pensando..." />}
          <div ref={fim} />
        </div>

        {erro && <p className="text-sm text-danger">{erro}</p>}

        {!encerrada ? (
          <form onSubmit={mandar} className="flex gap-2">
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              rows={2}
              maxLength={2000}
              placeholder="Escreva aqui. Enter envia, Shift+Enter pula linha."
              className="min-h-10 flex-1 resize-none rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            />
            <Button type="submit" variant="primary" disabled={enviando || !texto.trim()}>
              Enviar
            </Button>
          </form>
        ) : (
          <p className="text-sm text-subtle">Esta conversa foi encerrada. Dá para revisar o que foi dito, mas não escrever mais.</p>
        )}
      </Card>

      {atual && falasUsuario > 0 && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">
            Registrar o que foi dito
          </h2>
          <p className="text-sm text-subtle">
            A IA lê só as falas das pessoas e propõe registros (sintomas, humor, diário,
            preferências, memórias e dúvidas para a consulta). Você escolhe o que entra.
            Confirmar significa que a proposta é fiel ao que foi dito, não que é verdade.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={extrair} disabled={extraindo || enviando}>
              {extraindo ? "Lendo a conversa..." : propostas ? "Ler de novo" : "Propor registros"}
            </Button>
            {atual.tipo === "checkin_diario" && !encerrada && (
              <Button onClick={encerrar} disabled={extraindo || gravando}>
                Encerrar check-in
              </Button>
            )}
          </div>
          {extraindo && <IACarregando rotulo="Lendo a conversa..." />}

          {propostas && propostas.length === 0 && !aviso && (
            <p className="text-sm text-ink">
              Nada para registrar com segurança nesta conversa.
              {descartadas > 0 ? ` (${descartadas} sugestão(ões) da IA foram descartadas por não baterem com a fala.)` : ""}
            </p>
          )}

          {propostas && propostas.length > 0 && (
            <div className="flex flex-col gap-3">
              {propostas.map((p) => (
                <div
                  key={p.id}
                  className={`flex flex-col gap-2 rounded-lg border border-line p-3 ${marcadas[p.id] ? "" : "opacity-60"}`}
                >
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!!marcadas[p.id]}
                      onChange={(e) => setMarcadas((m) => ({ ...m, [p.id]: e.target.checked }))}
                    />
                    <Badge tone="primary">{ROTULO_TIPO[p.dados.tipo]}</Badge>
                    {p.jaRegistrado && <Badge tone="neutral">já registrado</Badge>}
                  </label>
                  {camposDe(p.dados).map((c) => (
                    <label key={c.campo} className="flex flex-col gap-0.5 text-xs text-subtle">
                      {c.rotulo}
                      <input
                        value={edicoes[p.id]?.[c.campo] ?? c.valor}
                        onChange={(e) =>
                          setEdicoes((ed) => ({ ...ed, [p.id]: { ...ed[p.id], [c.campo]: e.target.value } }))
                        }
                        className="h-9 rounded-md border border-line bg-card px-2 text-sm text-ink"
                      />
                    </label>
                  ))}
                  {p.dados.tipo === "medicacao" && (
                    <p className="text-sm text-ink">
                      Registrar <strong>{p.dados.nome}</strong> como tomado hoje (adesão).
                    </p>
                  )}
                  <p className="text-xs text-subtle">
                    {p.autorNome} disse: “{p.trecho}”
                  </p>
                </div>
              ))}
              <Button variant="primary" onClick={registrar} disabled={gravando || !Object.values(marcadas).some(Boolean)}>
                {gravando ? "Registrando..." : "Registrar os selecionados"}
              </Button>
              {descartadas > 0 && (
                <p className="text-xs text-subtle">
                  {descartadas} sugestão(ões) da IA foram descartadas por não baterem com o que foi dito.
                </p>
              )}
            </div>
          )}
          {aviso && <p className="text-sm text-ink">{aviso}</p>}
        </Card>
      )}
    </div>
  );
}

function Balao({ souEu, autor, texto }: { souEu: boolean; autor: string; texto: string }) {
  return (
    <div className={`flex flex-col gap-0.5 ${souEu ? "items-end" : "items-start"}`}>
      <span className="text-xs text-subtle">{autor}</span>
      <p
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
          souEu ? "bg-primary text-white" : "bg-panel text-ink"
        }`}
      >
        {texto}
      </p>
    </div>
  );
}
