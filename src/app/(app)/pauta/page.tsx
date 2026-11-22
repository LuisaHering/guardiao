"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Badge, Button, Card, Field, Input } from "@/components/ui";

type Item = {
  id: string;
  titulo: string;
  detalhe: string | null;
  origem_mensagem_id: string | null;
  consulta_id: string | null;
  resolvido_em: string | null;
  created_at: string;
};

type Consulta = { id: string; data: string | null; medico: string | null; especialidade: string | null };
type Mensagem = { id: string; conteudo: string | null; created_at: string };

function data(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function rotuloConsulta(c: Consulta) {
  const quem = [c.medico, c.especialidade].filter(Boolean).join(", ") || "Consulta";
  return `${quem}${c.data ? ` (${data(c.data)})` : ""}`;
}

export default function PautaPage() {
  const supabase = createClient();
  const membership = useRole();
  const idosoId = membership?.idosoId;

  const [carregando, setCarregando] = useState(true);
  const [itens, setItens] = useState<Item[]>([]);
  const [consultas, setConsultas] = useState<Consulta[]>([]);
  const [origens, setOrigens] = useState<Record<string, Mensagem>>({});

  const [titulo, setTitulo] = useState("");
  const [detalhe, setDetalhe] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [resolvendo, setResolvendo] = useState<string | null>(null);
  const [consultaEscolhida, setConsultaEscolhida] = useState("");

  const carregar = useCallback(async () => {
    if (!idosoId) {
      setCarregando(false);
      return;
    }
    const [{ data: its }, { data: cons }] = await Promise.all([
      supabase
        .from("item_pauta")
        .select("id, titulo, detalhe, origem_mensagem_id, consulta_id, resolvido_em, created_at")
        .eq("idoso_id", idosoId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("consulta")
        .select("id, data, medico, especialidade")
        .eq("idoso_id", idosoId)
        .is("deleted_at", null)
        .order("data", { ascending: false })
        .limit(15),
    ]);
    const lista = (its ?? []) as Item[];
    setItens(lista);
    setConsultas((cons ?? []) as Consulta[]);

    // A fala de onde o item saiu: a pauta guarda a origem, não uma cópia do texto.
    const ids = [...new Set(lista.map((i) => i.origem_mensagem_id).filter(Boolean))] as string[];
    if (ids.length > 0) {
      const { data: ms } = await supabase
        .from("mensagem")
        .select("id, conteudo, created_at")
        .in("id", ids);
      setOrigens(Object.fromEntries(((ms ?? []) as Mensagem[]).map((m) => [m.id, m])));
    } else {
      setOrigens({});
    }
    setCarregando(false);
  }, [supabase, idosoId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function adicionar(e: React.FormEvent) {
    e.preventDefault();
    if (!idosoId || !titulo.trim()) return;
    setErro(null);
    setSalvando(true);
    const { error } = await supabase.from("item_pauta").insert({
      idoso_id: idosoId,
      titulo: titulo.trim(),
      detalhe: detalhe.trim() || null,
    });
    if (error) setErro(error.message);
    else {
      setTitulo("");
      setDetalhe("");
    }
    setSalvando(false);
    await carregar();
  }

  async function resolver(id: string) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase
      .from("item_pauta")
      .update({
        resolvido_em: new Date().toISOString(),
        resolvido_por: user?.id ?? null,
        consulta_id: consultaEscolhida || null,
      })
      .eq("id", id);
    setResolvendo(null);
    setConsultaEscolhida("");
    await carregar();
  }

  async function reabrir(id: string) {
    await supabase
      .from("item_pauta")
      .update({ resolvido_em: null, resolvido_por: null, consulta_id: null })
      .eq("id", id);
    await carregar();
  }

  async function remover(id: string) {
    if (!window.confirm("Remover este item da pauta?")) return;
    await supabase
      .from("item_pauta")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    await carregar();
  }

  if (!membership) {
    return (
      <p className="text-sm text-subtle">
        Crie o perfil do idoso primeiro para montar a pauta médica.
      </p>
    );
  }

  const abertos = itens.filter((i) => !i.resolvido_em);
  const resolvidos = itens.filter((i) => i.resolvido_em);
  const consultaPorId = new Map(consultas.map((c) => [c.id, c]));

  function CartaoItem({ item }: { item: Item }) {
    const origem = item.origem_mensagem_id ? origens[item.origem_mensagem_id] : null;
    const consulta = item.consulta_id ? consultaPorId.get(item.consulta_id) : null;
    const aberto = !item.resolvido_em;
    return (
      <Card className={`flex flex-col gap-2 ${aberto ? "" : "opacity-70"}`}>
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium text-ink">{item.titulo}</p>
          <Badge tone={aberto ? "primary" : "success"}>{aberto ? "em aberto" : "resolvido"}</Badge>
        </div>
        {item.detalhe && <p className="text-sm text-subtle">{item.detalhe}</p>}

        {origem && (
          <p className="rounded-lg bg-panel p-2 text-xs text-subtle">
            Veio de uma conversa em {data(origem.created_at)}: &quot;{origem.conteudo}&quot;
          </p>
        )}

        <p className="text-xs text-subtle">
          Adicionado em {data(item.created_at)}
          {item.resolvido_em ? ` · resolvido em ${data(item.resolvido_em)}` : ""}
          {consulta ? ` · na consulta ${rotuloConsulta(consulta)}` : ""}
        </p>

        {resolvendo === item.id && (
          <div className="flex flex-col gap-2 rounded-lg bg-panel p-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-subtle">Foi resolvido em qual consulta? (opcional)</span>
              <select
                value={consultaEscolhida}
                onChange={(e) => setConsultaEscolhida(e.target.value)}
                className="h-10 rounded-lg border border-line bg-card px-2 text-sm text-ink"
              >
                <option value="">Sem consulta específica</option>
                {consultas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {rotuloConsulta(c)}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => resolver(item.id)} className="h-9 px-3 text-xs">
                Marcar como resolvido
              </Button>
              <Button variant="ghost" onClick={() => setResolvendo(null)} className="h-9 px-3 text-xs">
                Cancelar
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {aberto ? (
            <Button
              onClick={() => {
                setResolvendo(item.id);
                setConsultaEscolhida("");
              }}
              className="h-8 px-3 text-xs"
            >
              Resolver
            </Button>
          ) : (
            <Button onClick={() => reabrir(item.id)} className="h-8 px-3 text-xs">
              Reabrir
            </Button>
          )}
          <Button variant="ghost" onClick={() => remover(item.id)} className="h-8 px-3 text-xs">
            Remover
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Pauta médica</h1>
        <p className="text-sm text-subtle">
          O que levar à próxima consulta de {membership.idosoNome}: dúvidas, queixas e
          coisas a perguntar. Os itens ficam aqui até serem marcados como resolvidos, e a
          Visão 360 mostra esta lista em vez de reescrevê-la.
        </p>
      </div>

      <Card className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-ink">Novo item</h2>
        <form onSubmit={adicionar} className="flex flex-col gap-3">
          <Field label="O que levar ou perguntar">
            <Input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex: perguntar sobre a tontura ao levantar"
              maxLength={200}
            />
          </Field>
          <Field label="Detalhes (opcional)">
            <textarea
              value={detalhe}
              onChange={(e) => setDetalhe(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            />
          </Field>
          {erro && <p className="text-sm text-danger">{erro}</p>}
          <Button variant="primary" type="submit" disabled={salvando || !titulo.trim()} className="self-start">
            {salvando ? "Salvando..." : "Adicionar à pauta"}
          </Button>
        </form>
      </Card>

      {carregando && <p className="text-sm text-subtle">Carregando...</p>}

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-ink">Em aberto ({abertos.length})</h2>
        {!carregando && abertos.length === 0 && (
          <p className="text-sm text-subtle">Nada aguardando a próxima consulta.</p>
        )}
        {abertos.map((i) => (
          <CartaoItem key={i.id} item={i} />
        ))}
      </div>

      {resolvidos.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-ink">Resolvidos ({resolvidos.length})</h2>
          {resolvidos.map((i) => (
            <CartaoItem key={i.id} item={i} />
          ))}
        </div>
      )}
    </div>
  );
}
