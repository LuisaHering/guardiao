"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Badge, Button, Card, Field, Input } from "@/components/ui";
import { extensaoDoArquivo, reduzirParaIA } from "@/lib/imagem";
import { normalizar } from "@/lib/analitos";
import type { ReceitaExtraida } from "@/lib/ai/schemas";

type Linha = {
  incluir: boolean;
  nome: string;
  dosagem: string;
  frequencia: string;
  observacoes: string;
  jaExiste: boolean;
};

type Receita = {
  id: string;
  medico: string | null;
  data: string | null;
  arquivo_url: string | null;
  created_at: string;
};

function dataCurta(iso: string | null) {
  if (!iso) return "Sem data";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

export default function ReceitasPage() {
  const supabase = createClient();
  const membership = useRole();
  const idosoId = membership?.idosoId;

  const [carregando, setCarregando] = useState(true);
  const [receitas, setReceitas] = useState<Receita[]>([]);
  const [medsPorReceita, setMedsPorReceita] = useState<Record<string, string[]>>({});
  const [docs, setDocs] = useState<Record<string, string>>({});
  const [ativos, setAtivos] = useState<string[]>([]);

  const [arquivo, setArquivo] = useState<File | null>(null);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [revisao, setRevisao] = useState<{
    medico: string;
    data: string;
    legivel: boolean;
    linhas: Linha[];
  } | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    if (!idosoId) {
      setCarregando(false);
      return;
    }
    setCarregando(true);
    const [{ data: rs }, { data: ms }] = await Promise.all([
      supabase
        .from("receita")
        .select("id, medico, data, arquivo_url, created_at")
        .eq("idoso_id", idosoId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("medicacao")
        .select("nome, receita_id")
        .eq("idoso_id", idosoId)
        .eq("ativo", true)
        .is("deleted_at", null),
    ]);
    const lista = (rs ?? []) as Receita[];
    setReceitas(lista);

    const meds = (ms ?? []) as { nome: string; receita_id: string | null }[];
    setAtivos(meds.map((m) => normalizar(m.nome)));
    const porReceita: Record<string, string[]> = {};
    for (const m of meds) {
      if (!m.receita_id) continue;
      (porReceita[m.receita_id] ??= []).push(m.nome);
    }
    setMedsPorReceita(porReceita);

    const urls: Record<string, string> = {};
    await Promise.all(
      lista
        .filter((r) => r.arquivo_url)
        .map(async (r) => {
          const { data: a } = await supabase.storage
            .from("receitas")
            .createSignedUrl(r.arquivo_url as string, 3600);
          if (a?.signedUrl) urls[r.id] = a.signedUrl;
        }),
    );
    setDocs(urls);
    setCarregando(false);
  }, [supabase, idosoId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function ler() {
    if (!arquivo || !idosoId) return;
    setErro(null);
    setLendo(true);
    setRevisao(null);
    try {
      const enviado = await reduzirParaIA(arquivo);
      const form = new FormData();
      form.append("idosoId", idosoId);
      form.append("arquivo", enviado, arquivo.type === "application/pdf" ? "receita.pdf" : "receita.jpg");
      const resp = await fetch("/api/ia/receita", { method: "POST", body: form });
      const json = await resp.json();
      if (!resp.ok) {
        setErro(json.erro ?? "Nao consegui ler a receita.");
        setLendo(false);
        return;
      }
      const r = json.receita as ReceitaExtraida;
      setRevisao({
        medico: r.medico ?? "",
        data: r.data ?? "",
        legivel: r.legivel,
        linhas: r.medicamentos.map((m) => {
          const jaExiste = ativos.includes(normalizar(m.nome));
          return {
            incluir: !jaExiste,
            nome: m.nome,
            dosagem: m.dosagem ?? "",
            frequencia: m.frequencia ?? "",
            observacoes: m.observacoes ?? "",
            jaExiste,
          };
        }),
      });
    } catch {
      setErro("Sem conexao com o servidor. Tente de novo.");
    }
    setLendo(false);
  }

  function mudarLinha(i: number, parcial: Partial<Linha>) {
    setRevisao((r) =>
      r ? { ...r, linhas: r.linhas.map((l, j) => (j === i ? { ...l, ...parcial } : l)) } : r,
    );
  }

  async function confirmar() {
    if (!revisao || !arquivo || !idosoId) return;
    const escolhidas = revisao.linhas.filter((l) => l.incluir && l.nome.trim());
    if (escolhidas.length === 0) {
      setErro("Marque ao menos um medicamento para cadastrar.");
      return;
    }
    setErro(null);
    setSalvando(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    // O documento de origem vai para o Storage ANTES de virar medicacao,
    // e cada medicacao guarda receita_id: a origem nao se perde.
    const caminho = `${idosoId}/${crypto.randomUUID()}.${extensaoDoArquivo(arquivo)}`;
    const { error: upErro } = await supabase.storage
      .from("receitas")
      .upload(caminho, arquivo, { upsert: false, contentType: arquivo.type || undefined });
    if (upErro) {
      setErro(`Nao consegui guardar o documento: ${upErro.message}`);
      setSalvando(false);
      return;
    }

    const { data: nova, error: recErro } = await supabase
      .from("receita")
      .insert({
        idoso_id: idosoId,
        autor_id: user!.id,
        medico: revisao.medico.trim() || null,
        data: revisao.data || null,
        arquivo_url: caminho,
        status_processamento: "confirmada",
      })
      .select("id")
      .single();
    if (recErro || !nova) {
      setErro(recErro?.message ?? "Nao consegui salvar a receita.");
      setSalvando(false);
      return;
    }

    const { error: medErro } = await supabase.from("medicacao").insert(
      escolhidas.map((l) => ({
        idoso_id: idosoId,
        receita_id: nova.id,
        autor_id: user!.id,
        nome: l.nome.trim(),
        dosagem: l.dosagem.trim() || null,
        instrucoes:
          [l.frequencia.trim(), l.observacoes.trim()].filter(Boolean).join(" · ") || null,
        confirmado: true,
      })),
    );
    if (medErro) {
      setErro(medErro.message);
      setSalvando(false);
      return;
    }

    setRevisao(null);
    setArquivo(null);
    setSalvando(false);
    await carregar();
  }

  if (!membership) {
    return (
      <p className="text-sm text-subtle">
        Crie o perfil do idoso primeiro para cadastrar receitas.
      </p>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Receitas</h1>
        <p className="text-sm text-subtle">
          Tire uma foto (ou envie o PDF) da receita de {membership.idosoNome}. A IA
          sugere os remedios e voce confere antes de cadastrar. O documento fica
          guardado e ligado a cada remedio.
        </p>
      </div>

      <Card className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-ink">Nova receita</h2>
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
        {erro && !revisao && <p className="text-sm text-danger">{erro}</p>}
        <Button
          variant="primary"
          onClick={ler}
          disabled={!arquivo || lendo}
          className="self-start"
        >
          {lendo ? "Lendo a receita..." : "Ler receita"}
        </Button>
        <p className="text-xs text-subtle">
          A imagem e enviada a IA da Anthropic para a leitura. Nada e cadastrado
          sem a sua confirmacao.
        </p>
      </Card>

      {revisao && (
        <Card className="flex flex-col gap-4 border-primary/40">
          <h2 className="text-sm font-medium text-ink">Confira antes de cadastrar</h2>
          {!revisao.legivel && (
            <p className="rounded-lg bg-warn/10 p-3 text-sm text-warn">
              A leitura nao teve certeza de tudo. Compare cada linha com a receita
              em maos e corrija o que precisar.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Medico">
              <Input
                value={revisao.medico}
                onChange={(e) => setRevisao({ ...revisao, medico: e.target.value })}
              />
            </Field>
            <Field label="Data da receita">
              <Input
                type="date"
                value={revisao.data}
                onChange={(e) => setRevisao({ ...revisao, data: e.target.value })}
              />
            </Field>
          </div>

          {revisao.linhas.length === 0 && (
            <p className="text-sm text-subtle">
              Nao encontrei medicamentos legiveis nesta receita.
            </p>
          )}

          {revisao.linhas.map((l, i) => (
            <div key={i} className="flex flex-col gap-2 border-t border-line pt-3">
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={l.incluir}
                    onChange={(e) => mudarLinha(i, { incluir: e.target.checked })}
                  />
                  Cadastrar
                </label>
                {l.jaExiste && <Badge tone="warn">ja esta na lista de medicacao</Badge>}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  value={l.nome}
                  onChange={(e) => mudarLinha(i, { nome: e.target.value })}
                  placeholder="Nome"
                />
                <Input
                  value={l.dosagem}
                  onChange={(e) => mudarLinha(i, { dosagem: e.target.value })}
                  placeholder="Dosagem"
                />
                <Input
                  value={l.frequencia}
                  onChange={(e) => mudarLinha(i, { frequencia: e.target.value })}
                  placeholder="Frequencia (ex: 1 comprimido de 12 em 12 h)"
                />
                <Input
                  value={l.observacoes}
                  onChange={(e) => mudarLinha(i, { observacoes: e.target.value })}
                  placeholder="Observacoes"
                />
              </div>
            </div>
          ))}

          {erro && <p className="text-sm text-danger">{erro}</p>}
          <div className="flex gap-2">
            <Button variant="primary" onClick={confirmar} disabled={salvando}>
              {salvando ? "Cadastrando..." : "Confirmar e cadastrar"}
            </Button>
            <Button variant="ghost" onClick={() => setRevisao(null)} disabled={salvando}>
              Descartar
            </Button>
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-ink">Receitas cadastradas</h2>
        {carregando && <p className="text-sm text-subtle">Carregando...</p>}
        {!carregando && receitas.length === 0 && (
          <p className="text-sm text-subtle">Nenhuma receita ainda.</p>
        )}
        {receitas.map((r) => (
          <Card key={r.id} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-ink">
                {r.medico || "Receita"} · {dataCurta(r.data ?? r.created_at)}
              </p>
              {docs[r.id] && (
                <a
                  href={docs[r.id]}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline"
                >
                  Ver documento
                </a>
              )}
            </div>
            <p className="text-xs text-subtle">
              {(medsPorReceita[r.id] ?? []).join(", ") || "Nenhum remedio ativo ligado a esta receita."}
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}
