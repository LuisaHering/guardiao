"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, Field, Input } from "@/components/ui";

type Idoso = {
  id: string;
  nome: string;
  como_chamar: string | null;
  data_nascimento: string | null;
  tipo_sanguineo: string | null;
  observacoes: string | null;
};
type Contato = {
  id: string;
  nome: string;
  telefone: string | null;
  relacao: string | null;
};
type Condicao = { id: string; nome: string; desde: string | null };

const vazio = {
  nome: "",
  como_chamar: "",
  data_nascimento: "",
  tipo_sanguineo: "",
  observacoes: "",
};

export default function PerfilPage() {
  const supabase = createClient();
  const router = useRouter();
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [idoso, setIdoso] = useState<Idoso | null>(null);
  const [form, setForm] = useState({ ...vazio });
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [condicoes, setCondicoes] = useState<Condicao[]>([]);

  const [novoContato, setNovoContato] = useState({ nome: "", telefone: "", relacao: "" });
  const [novaCondicao, setNovaCondicao] = useState({ nome: "", desde: "" });

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data } = await supabase
      .from("vinculo")
      .select("idoso(*)")
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    const i = (data?.idoso ?? null) as Idoso | null;
    setIdoso(i);
    if (i) {
      setForm({
        nome: i.nome ?? "",
        como_chamar: i.como_chamar ?? "",
        data_nascimento: i.data_nascimento ?? "",
        tipo_sanguineo: i.tipo_sanguineo ?? "",
        observacoes: i.observacoes ?? "",
      });
      const [cts, cds] = await Promise.all([
        supabase.from("contato_emergencia").select("*").eq("idoso_id", i.id).is("deleted_at", null),
        supabase.from("condicao").select("*").eq("idoso_id", i.id).is("deleted_at", null),
      ]);
      setContatos((cts.data ?? []) as Contato[]);
      setCondicoes((cds.data ?? []) as Condicao[]);
    }
    setCarregando(false);
  }, [supabase]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function salvarIdoso(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    const payload = {
      nome: form.nome,
      como_chamar: form.como_chamar || null,
      data_nascimento: form.data_nascimento || null,
      tipo_sanguineo: form.tipo_sanguineo || null,
      observacoes: form.observacoes || null,
    };
    if (idoso) {
      const { error } = await supabase.from("idoso").update(payload).eq("id", idoso.id);
      if (error) setErro(error.message);
    } else {
      const { error } = await supabase.rpc("criar_idoso", {
        p_nome: form.nome,
        p_como_chamar: form.como_chamar || null,
        p_data_nascimento: form.data_nascimento || null,
        p_tipo_sanguineo: form.tipo_sanguineo || null,
        p_observacoes: form.observacoes || null,
      });
      if (error) setErro(error.message);
    }
    setSalvando(false);
    await carregar();
    router.refresh();
  }

  async function addContato(e: React.FormEvent) {
    e.preventDefault();
    if (!idoso || !novoContato.nome) return;
    await supabase.from("contato_emergencia").insert({
      idoso_id: idoso.id,
      nome: novoContato.nome,
      telefone: novoContato.telefone || null,
      relacao: novoContato.relacao || null,
    });
    setNovoContato({ nome: "", telefone: "", relacao: "" });
    await carregar();
  }

  async function addCondicao(e: React.FormEvent) {
    e.preventDefault();
    if (!idoso || !novaCondicao.nome) return;
    await supabase.from("condicao").insert({
      idoso_id: idoso.id,
      nome: novaCondicao.nome,
      desde: novaCondicao.desde || null,
    });
    setNovaCondicao({ nome: "", desde: "" });
    await carregar();
  }

  async function remover(tabela: "contato_emergencia" | "condicao", id: string) {
    await supabase.from(tabela).update({ deleted_at: new Date().toISOString() }).eq("id", id);
    await carregar();
  }

  if (carregando) {
    return <p className="text-sm text-subtle">Carregando...</p>;
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">
          {idoso ? "Perfil do idoso" : "Criar perfil do idoso"}
        </h1>
        <p className="text-sm text-subtle">
          {idoso
            ? "Dados básicos, condições e contatos de emergência."
            : "Cadastre a pessoa que será cuidada. Você fica como administradora."}
        </p>
      </div>

      <Card>
        <form onSubmit={salvarIdoso} className="flex flex-col gap-4">
          <Field label="Nome">
            <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Como prefere ser chamado">
              <Input value={form.como_chamar} onChange={(e) => setForm({ ...form, como_chamar: e.target.value })} placeholder="ex: Seu João" />
            </Field>
            <Field label="Data de nascimento">
              <Input type="date" value={form.data_nascimento} onChange={(e) => setForm({ ...form, data_nascimento: e.target.value })} />
            </Field>
            <Field label="Tipo sanguíneo">
              <Input value={form.tipo_sanguineo} onChange={(e) => setForm({ ...form, tipo_sanguineo: e.target.value })} placeholder="ex: O+" />
            </Field>
          </div>
          <Field label="Observações">
            <textarea
              value={form.observacoes}
              onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              rows={3}
              className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            />
          </Field>
          {erro && <p className="text-sm text-danger">{erro}</p>}
          <div>
            <Button variant="primary" type="submit" disabled={salvando}>
              {salvando ? "Salvando..." : idoso ? "Salvar" : "Criar perfil"}
            </Button>
          </div>
        </form>
      </Card>

      {idoso && (
        <>
          <Card className="flex flex-col gap-4">
            <h2 className="text-sm font-medium text-ink">Contatos de emergência</h2>
            {contatos.length === 0 && (
              <p className="text-sm text-subtle">Nenhum contato ainda.</p>
            )}
            {contatos.map((c) => (
              <div key={c.id} className="flex items-center justify-between border-b border-line pb-2 last:border-0 last:pb-0">
                <div>
                  <p className="text-sm text-ink">{c.nome}</p>
                  <p className="text-xs text-subtle">
                    {[c.relacao, c.telefone].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <Button variant="ghost" onClick={() => remover("contato_emergencia", c.id)} className="h-8 px-2 text-xs">
                  Remover
                </Button>
              </div>
            ))}
            <form onSubmit={addContato} className="grid gap-2 sm:grid-cols-4">
              <Input placeholder="Nome" value={novoContato.nome} onChange={(e) => setNovoContato({ ...novoContato, nome: e.target.value })} />
              <Input placeholder="Telefone" value={novoContato.telefone} onChange={(e) => setNovoContato({ ...novoContato, telefone: e.target.value })} />
              <Input placeholder="Relação" value={novoContato.relacao} onChange={(e) => setNovoContato({ ...novoContato, relacao: e.target.value })} />
              <Button type="submit">Adicionar</Button>
            </form>
          </Card>

          <Card className="flex flex-col gap-4">
            <h2 className="text-sm font-medium text-ink">Condições</h2>
            {condicoes.length === 0 && (
              <p className="text-sm text-subtle">Nenhuma condição registrada.</p>
            )}
            {condicoes.map((c) => (
              <div key={c.id} className="flex items-center justify-between border-b border-line pb-2 last:border-0 last:pb-0">
                <div>
                  <p className="text-sm text-ink">{c.nome}</p>
                  {c.desde && <p className="text-xs text-subtle">desde {c.desde}</p>}
                </div>
                <Button variant="ghost" onClick={() => remover("condicao", c.id)} className="h-8 px-2 text-xs">
                  Remover
                </Button>
              </div>
            ))}
            <form onSubmit={addCondicao} className="grid gap-2 sm:grid-cols-3">
              <Input placeholder="Condição (ex: hipertensão)" value={novaCondicao.nome} onChange={(e) => setNovaCondicao({ ...novaCondicao, nome: e.target.value })} className="sm:col-span-2" />
              <Input type="date" value={novaCondicao.desde} onChange={(e) => setNovaCondicao({ ...novaCondicao, desde: e.target.value })} />
              <Button type="submit" className="sm:col-span-3">Adicionar condição</Button>
            </form>
          </Card>

          <p className="text-xs text-subtle">
            Foto do perfil entra junto com o upload de arquivos (card de Storage).
          </p>
        </>
      )}
    </div>
  );
}
