"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Badge, Button, Card, Field, Input } from "@/components/ui";
import { CompletudePerfil } from "@/components/completude-perfil";

type Preferencia = {
  id: string;
  categoria: string | null;
  chave: string | null;
  valor: string | null;
  autor_id: string | null;
  origem: string;
  origem_mensagem_id: string | null;
  confirmado: boolean;
  created_at: string;
};

type Memoria = {
  id: string;
  titulo: string | null;
  conteudo: string | null;
  autor_id: string | null;
  origem: string;
  origem_mensagem_id: string | null;
  confirmado: boolean;
  created_at: string;
};

type Mensagem = { id: string; conteudo: string | null; created_at: string };

const CATEGORIAS = [
  { valor: "comunicacao", rotulo: "Como gosta de ser tratado", dica: "Ex: gosta de ser chamado de seu Luiz; não gosta de ser chamado de querido." },
  { valor: "agrada", rotulo: "O que agrada", dica: "Ex: ouvir rádio de manhã, conversar sobre futebol." },
  { valor: "incomoda", rotulo: "O que incomoda", dica: "Ex: barulho alto, ser apressado na hora de comer." },
  { valor: "rotina", rotulo: "Rotina", dica: "Ex: acorda às 6h, cochila depois do almoço." },
  { valor: "alimentacao", rotulo: "Alimentação", dica: "Ex: não gosta de ovo cozido, adora café com leite morno." },
] as const;

function data(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

export default function IdentidadePage() {
  const supabase = createClient();
  const membership = useRole();
  const idosoId = membership?.idosoId;

  const [carregando, setCarregando] = useState(true);
  const [prefs, setPrefs] = useState<Preferencia[]>([]);
  const [mems, setMems] = useState<Memoria[]>([]);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [falas, setFalas] = useState<Record<string, Mensagem>>({});

  const [categoria, setCategoria] = useState<string>("comunicacao");
  const [chave, setChave] = useState("");
  const [valor, setValor] = useState("");
  const [titulo, setTitulo] = useState("");
  const [conteudo, setConteudo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState({ a: "", b: "" });

  const carregar = useCallback(async () => {
    if (!idosoId) {
      setCarregando(false);
      return;
    }
    const [{ data: ps }, { data: ms }] = await Promise.all([
      supabase
        .from("preferencia")
        .select("id, categoria, chave, valor, autor_id, origem, origem_mensagem_id, confirmado, created_at")
        .eq("idoso_id", idosoId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("memoria")
        .select("id, titulo, conteudo, autor_id, origem, origem_mensagem_id, confirmado, created_at")
        .eq("idoso_id", idosoId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
    ]);
    const prefsLista = (ps ?? []) as Preferencia[];
    const memsLista = (ms ?? []) as Memoria[];
    setPrefs(prefsLista);
    setMems(memsLista);

    // Quem registrou cada coisa, e a fala de origem quando veio de uma conversa.
    const autores = [
      ...new Set([...prefsLista, ...memsLista].map((x) => x.autor_id).filter(Boolean)),
    ] as string[];
    if (autores.length > 0) {
      const { data: us } = await supabase.from("usuario").select("id, nome").in("id", autores);
      setNomes(Object.fromEntries((us ?? []).map((u) => [u.id as string, u.nome as string])));
    }
    const msgIds = [
      ...new Set([...prefsLista, ...memsLista].map((x) => x.origem_mensagem_id).filter(Boolean)),
    ] as string[];
    if (msgIds.length > 0) {
      const { data: fs } = await supabase
        .from("mensagem")
        .select("id, conteudo, created_at")
        .in("id", msgIds);
      setFalas(Object.fromEntries(((fs ?? []) as Mensagem[]).map((m) => [m.id, m])));
    }
    setCarregando(false);
  }, [supabase, idosoId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function adicionarPreferencia(e: React.FormEvent) {
    e.preventDefault();
    if (!idosoId || !chave.trim()) return;
    setErro(null);
    setOcupado(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("preferencia").insert({
      idoso_id: idosoId,
      autor_id: user!.id,
      categoria,
      chave: chave.trim(),
      valor: valor.trim() || null,
      origem: "manual",
      confirmado: true,
    });
    if (error) setErro(error.message);
    else {
      setChave("");
      setValor("");
    }
    setOcupado(false);
    await carregar();
  }

  async function adicionarMemoria(e: React.FormEvent) {
    e.preventDefault();
    if (!idosoId || !titulo.trim()) return;
    setErro(null);
    setOcupado(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("memoria").insert({
      idoso_id: idosoId,
      autor_id: user!.id,
      titulo: titulo.trim(),
      conteudo: conteudo.trim() || null,
      origem: "manual",
      confirmado: true,
    });
    if (error) setErro(error.message);
    else {
      setTitulo("");
      setConteudo("");
    }
    setOcupado(false);
    await carregar();
  }

  async function confirmar(tabela: "preferencia" | "memoria", id: string) {
    await supabase.from(tabela).update({ confirmado: true }).eq("id", id);
    await carregar();
  }

  async function remover(tabela: "preferencia" | "memoria", id: string) {
    await supabase.from(tabela).update({ deleted_at: new Date().toISOString() }).eq("id", id);
    await carregar();
  }

  async function salvarEdicao(tabela: "preferencia" | "memoria", id: string) {
    if (!rascunho.a.trim()) return;
    if (tabela === "preferencia") {
      await supabase
        .from("preferencia")
        .update({ chave: rascunho.a.trim(), valor: rascunho.b.trim() || null })
        .eq("id", id);
    } else {
      await supabase
        .from("memoria")
        .update({ titulo: rascunho.a.trim(), conteudo: rascunho.b.trim() || null })
        .eq("id", id);
    }
    setEditando(null);
    await carregar();
  }

  if (!membership) {
    return (
      <p className="text-sm text-subtle">
        Crie o perfil do idoso primeiro para registrar preferências e história.
      </p>
    );
  }

  const aguardando = [
    ...prefs.filter((p) => !p.confirmado).map((p) => ({ tabela: "preferencia" as const, p })),
    ...mems.filter((m) => !m.confirmado).map((m) => ({ tabela: "memoria" as const, m })),
  ];

  function Origem({ autor, origem, mensagem, criado }: { autor: string | null; origem: string; mensagem: string | null; criado: string }) {
    const fala = mensagem ? falas[mensagem] : null;
    return (
      <div className="flex flex-col gap-1">
        <p className="text-xs text-subtle">
          Registrado por {autor ? (nomes[autor] ?? "alguém") : "alguém"} em {data(criado)}
          {origem === "manual" ? "" : ` · origem: ${origem}`}
        </p>
        {fala && (
          <p className="rounded-lg bg-panel p-2 text-xs text-subtle">
            Frase de origem ({data(fala.created_at)}): &quot;{fala.conteudo}&quot;
          </p>
        )}
      </div>
    );
  }

  function LinhaEditavel({ id, tabela, a, b }: { id: string; tabela: "preferencia" | "memoria"; a: string; b: string }) {
    if (editando !== id) return null;
    return (
      <div className="flex flex-col gap-2 rounded-lg bg-panel p-3">
        <Input value={rascunho.a} onChange={(e) => setRascunho({ ...rascunho, a: e.target.value })} placeholder={tabela === "preferencia" ? "Assunto" : "Título"} />
        <textarea
          value={rascunho.b}
          onChange={(e) => setRascunho({ ...rascunho, b: e.target.value })}
          rows={2}
          className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        />
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => salvarEdicao(tabela, id)} className="h-8 px-3 text-xs">
            Salvar
          </Button>
          <Button variant="ghost" onClick={() => setEditando(null)} className="h-8 px-3 text-xs">
            Cancelar
          </Button>
        </div>
        <span className="sr-only">{a}{b}</span>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Quem é {membership.idosoNome}</h1>
        <p className="text-sm text-subtle">
          Preferências, rotinas, o que agrada e o que incomoda, e a história de vida. Quem
          cuida lê isto para tratar a pessoa do jeito que ela quer ser tratada, e qualquer
          um que cuida pode complementar e corrigir.
        </p>
      </div>

      <CompletudePerfil />

      {aguardando.length > 0 && (
        <Card className="flex flex-col gap-4 border-warn/40 bg-warn/5">
          <div>
            <h2 className="text-sm font-medium text-ink">Aguardando confirmação ({aguardando.length})</h2>
            <p className="mt-1 text-xs text-subtle">
              Estes registros vieram de uma conversa. Confirmar quer dizer que o texto está{" "}
              <strong className="font-medium text-ink">fiel ao que a pessoa disse</strong>, e não
              que o conteúdo é verdade. Se a IA entendeu errado, descarte ou edite.
            </p>
          </div>
          {aguardando.map((x) =>
            x.tabela === "preferencia" ? (
              <div key={x.p.id} className="flex flex-col gap-2 border-t border-line pt-3 first:border-0 first:pt-0">
                <p className="text-sm text-ink">
                  <span className="font-medium">{x.p.chave}</span>
                  {x.p.valor ? `: ${x.p.valor}` : ""}
                </p>
                <Origem autor={x.p.autor_id} origem={x.p.origem} mensagem={x.p.origem_mensagem_id} criado={x.p.created_at} />
                <div className="flex gap-2">
                  <Button variant="primary" onClick={() => confirmar("preferencia", x.p.id)} className="h-8 px-3 text-xs">
                    Confirmar: está fiel
                  </Button>
                  <Button variant="ghost" onClick={() => remover("preferencia", x.p.id)} className="h-8 px-3 text-xs">
                    Descartar
                  </Button>
                </div>
              </div>
            ) : (
              <div key={x.m.id} className="flex flex-col gap-2 border-t border-line pt-3 first:border-0 first:pt-0">
                <p className="text-sm text-ink">
                  <span className="font-medium">{x.m.titulo}</span>
                  {x.m.conteudo ? `: ${x.m.conteudo}` : ""}
                </p>
                <Origem autor={x.m.autor_id} origem={x.m.origem} mensagem={x.m.origem_mensagem_id} criado={x.m.created_at} />
                <div className="flex gap-2">
                  <Button variant="primary" onClick={() => confirmar("memoria", x.m.id)} className="h-8 px-3 text-xs">
                    Confirmar: está fiel
                  </Button>
                  <Button variant="ghost" onClick={() => remover("memoria", x.m.id)} className="h-8 px-3 text-xs">
                    Descartar
                  </Button>
                </div>
              </div>
            ),
          )}
        </Card>
      )}

      <Card className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-ink">Nova preferência</h2>
        <form onSubmit={adicionarPreferencia} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Tipo">
              <select
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                className="h-10 rounded-lg border border-line bg-card px-2 text-sm text-ink"
              >
                {CATEGORIAS.map((c) => (
                  <option key={c.valor} value={c.valor}>
                    {c.rotulo}
                  </option>
                ))}
              </select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Assunto">
                <Input value={chave} onChange={(e) => setChave(e.target.value)} placeholder="Ex: café da manhã" maxLength={120} />
              </Field>
            </div>
          </div>
          <Field label="Detalhe (opcional)">
            <Input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Ex: pão com manteiga e café com leite morno" maxLength={300} />
          </Field>
          <p className="text-xs text-subtle">{CATEGORIAS.find((c) => c.valor === categoria)?.dica}</p>
          <Button variant="primary" type="submit" disabled={ocupado || !chave.trim()} className="self-start">
            Adicionar preferência
          </Button>
        </form>
      </Card>

      {carregando && <p className="text-sm text-subtle">Carregando...</p>}

      {CATEGORIAS.map((cat) => {
        const lista = prefs.filter((p) => p.confirmado && p.categoria === cat.valor);
        if (lista.length === 0) return null;
        return (
          <Card key={cat.valor} className="flex flex-col gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">{cat.rotulo}</h2>
            {lista.map((p) => (
              <div key={p.id} className="flex flex-col gap-1.5 border-t border-line pt-3 first:border-0 first:pt-0">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm text-ink">
                    <span className="font-medium">{p.chave}</span>
                    {p.valor ? `: ${p.valor}` : ""}
                  </p>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setEditando(p.id);
                        setRascunho({ a: p.chave ?? "", b: p.valor ?? "" });
                      }}
                      className="h-7 px-2 text-xs"
                    >
                      Editar
                    </Button>
                    <Button variant="ghost" onClick={() => remover("preferencia", p.id)} className="h-7 px-2 text-xs">
                      Remover
                    </Button>
                  </div>
                </div>
                <Origem autor={p.autor_id} origem={p.origem} mensagem={p.origem_mensagem_id} criado={p.created_at} />
                <LinhaEditavel id={p.id} tabela="preferencia" a={p.chave ?? ""} b={p.valor ?? ""} />
              </div>
            ))}
          </Card>
        );
      })}

      <Card className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-ink">História de vida e memórias</h2>
        <form onSubmit={adicionarMemoria} className="flex flex-col gap-3">
          <Field label="Título">
            <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex: o melhor amigo de infância" maxLength={150} />
          </Field>
          <Field label="Conte um pouco (opcional)">
            <textarea
              value={conteudo}
              onChange={(e) => setConteudo(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            />
          </Field>
          <Button variant="primary" type="submit" disabled={ocupado || !titulo.trim()} className="self-start">
            Adicionar memória
          </Button>
        </form>
        {erro && <p className="text-sm text-danger">{erro}</p>}

        {mems
          .filter((m) => m.confirmado)
          .map((m) => (
            <div key={m.id} className="flex flex-col gap-1.5 border-t border-line pt-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-ink">
                  <span className="font-medium">{m.titulo}</span>
                  {m.conteudo ? `: ${m.conteudo}` : ""}
                </p>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setEditando(m.id);
                      setRascunho({ a: m.titulo ?? "", b: m.conteudo ?? "" });
                    }}
                    className="h-7 px-2 text-xs"
                  >
                    Editar
                  </Button>
                  <Button variant="ghost" onClick={() => remover("memoria", m.id)} className="h-7 px-2 text-xs">
                    Remover
                  </Button>
                </div>
              </div>
              <Origem autor={m.autor_id} origem={m.origem} mensagem={m.origem_mensagem_id} criado={m.created_at} />
              <LinhaEditavel id={m.id} tabela="memoria" a={m.titulo ?? ""} b={m.conteudo ?? ""} />
            </div>
          ))}
        {!carregando && mems.filter((m) => m.confirmado).length === 0 && (
          <p className="text-sm text-subtle">Nenhuma memória registrada ainda.</p>
        )}
      </Card>

      {prefs.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-subtle">
          <Badge tone="neutral">{prefs.filter((p) => p.confirmado).length}</Badge>
          preferências confirmadas ·
          <Badge tone="neutral">{mems.filter((m) => m.confirmado).length}</Badge>
          memórias
        </div>
      )}
    </div>
  );
}
