"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { SemAcesso } from "@/components/sem-acesso";
import { Badge, Button, Card, Field, Input } from "@/components/ui";
import { hojeBR, horaBR, DIAS_CURTOS } from "@/lib/medicacao";
import {
  COLUNAS_REGISTRO_TAREFA,
  COLUNAS_TAREFA,
  descreverQuando,
  tarefasDoDia,
  validarTarefa,
  type FrequenciaTarefa,
  type RegistroTarefa,
  type Tarefa,
} from "@/lib/tarefas";
import { cn } from "@/lib/cn";

type Formulario = {
  titulo: string;
  instrucao: string;
  frequencia: FrequenciaTarefa;
  dias_semana: number[];
  data: string;
};

const QUANDO: { valor: FrequenciaTarefa; rotulo: string }[] = [
  { valor: "diaria", rotulo: "Todo dia" },
  { valor: "semana", rotulo: "Alguns dias da semana" },
  { valor: "uma_vez", rotulo: "Só uma vez" },
];

const vazio = (): Formulario => ({ titulo: "", instrucao: "", frequencia: "diaria", dias_semana: [], data: hojeBR() });

const diaMes = (iso: string) => iso.split("-").reverse().slice(0, 2).join("/");

function FormTarefa({
  inicial,
  rotulo,
  onSalvar,
  onCancelar,
}: {
  inicial: Formulario;
  rotulo: string;
  onSalvar: (f: Formulario) => Promise<string | null>;
  onCancelar?: () => void;
}) {
  const [f, setF] = useState(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const muda = (p: Partial<Formulario>) => setF((a) => ({ ...a, ...p }));
  const opcao = (marcada: boolean) =>
    cn("min-h-11 rounded-lg border px-2 text-sm font-medium", marcada ? "border-primary bg-primary text-white" : "border-line bg-card text-ink hover:bg-panel");

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const problema = validarTarefa(f);
    if (problema) {
      setErro(problema);
      return;
    }
    setErro(null);
    setSalvando(true);
    const falha = await onSalvar(f);
    setSalvando(false);
    if (falha) setErro(falha);
    else if (!onCancelar) setF(vazio());
  }

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-3">
      <Field label="O que fazer">
        <Input value={f.titulo} maxLength={120} onChange={(e) => muda({ titulo: e.target.value })} placeholder="ex: Medir a pressão" />
      </Field>
      <Field label="Instrução (opcional)">
        <Input value={f.instrucao} maxLength={300} onChange={(e) => muda({ instrucao: e.target.value })} placeholder="ex: depois do café, anotar o número" />
      </Field>
      <fieldset>
        <legend className="mb-1 text-sm text-subtle">Quando</legend>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
          {QUANDO.map((q) => (
            <button key={q.valor} type="button" aria-pressed={f.frequencia === q.valor} onClick={() => muda({ frequencia: q.valor, data: hojeBR() })} className={opcao(f.frequencia === q.valor)}>
              {q.rotulo}
            </button>
          ))}
        </div>
      </fieldset>
      {f.frequencia === "semana" && (
        <div className="grid grid-cols-4 gap-1 sm:grid-cols-7">
          {DIAS_CURTOS.map((d, i) => {
            const marcado = f.dias_semana.includes(i);
            return (
              <button key={d} type="button" aria-pressed={marcado} onClick={() => muda({ dias_semana: marcado ? f.dias_semana.filter((x) => x !== i) : [...f.dias_semana, i] })} className={opcao(marcado)}>
                {d}
              </button>
            );
          })}
        </div>
      )}
      {f.frequencia === "uma_vez" && (
        <Field label="Em que dia">
          <Input type="date" value={f.data} onChange={(e) => muda({ data: e.target.value })} />
        </Field>
      )}
      {erro && <p className="text-sm text-danger" role="alert">{erro}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={salvando}>
          {salvando ? "Salvando..." : rotulo}
        </Button>
        {onCancelar && <Button type="button" variant="ghost" onClick={onCancelar}>Cancelar</Button>}
      </div>
    </form>
  );
}

export default function TarefasPage() {
  const supabase = createClient();
  const membership = useRole();
  const idosoId = membership?.idosoId;
  const admin = !!membership?.admin;

  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [respostas, setRespostas] = useState<RegistroTarefa[]>([]);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [carregando, setCarregando] = useState(true);
  const [versao, setVersao] = useState(0);
  const [editando, setEditando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const hoje = hojeBR();

  useEffect(() => {
    if (!idosoId) return;
    let cancelado = false;
    (async () => {
      const { data: ts } = await supabase.from("tarefa").select(COLUNAS_TAREFA).eq("idoso_id", idosoId).is("deleted_at", null).order("created_at");
      const lista = (ts ?? []) as unknown as Tarefa[];
      const { data: rs } = lista.length
        ? await supabase.from("tarefa_registro").select(COLUNAS_REGISTRO_TAREFA).in("tarefa_id", lista.map((t) => t.id)).is("deleted_at", null).order("data", { ascending: false }).limit(500)
        : { data: [] };
      const regs = (rs ?? []) as unknown as RegistroTarefa[];
      const ids = [...new Set(regs.map((r) => r.registrado_por).filter(Boolean))] as string[];
      const { data: us } = ids.length ? await supabase.from("usuario").select("id, nome").in("id", ids) : { data: [] };
      if (cancelado) return;
      setTarefas(lista);
      setRespostas(regs);
      setNomes(Object.fromEntries((us ?? []).map((u) => [u.id as string, (u.nome as string) || "Alguém da rede"])));
      setCarregando(false);
    })();
    return () => {
      cancelado = true;
    };
  }, [supabase, idosoId, versao]);

  const recarregar = () => setVersao((v) => v + 1);
  const paraGravar = (f: Formulario) => ({
    titulo: f.titulo.trim(),
    instrucao: f.instrucao.trim() || null,
    frequencia: f.frequencia,
    dias_semana: f.frequencia === "semana" ? [...f.dias_semana].sort() : [],
  });

  async function criar(f: Formulario) {
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase.from("tarefa").insert({ idoso_id: idosoId, ...paraGravar(f), data: f.data, criado_por: auth.user?.id });
    if (error) return "Não consegui criar a tarefa.";
    recarregar();
    return null;
  }

  async function salvar(t: Tarefa, f: Formulario) {
    // A data de início de uma tarefa repetida não muda ao editar; a de "uma vez" é o dia dela.
    const { error } = await supabase
      .from("tarefa")
      .update({ ...paraGravar(f), data: f.frequencia === "uma_vez" ? f.data : t.data })
      .eq("id", t.id);
    if (error) return "Não consegui salvar.";
    setEditando(null);
    recarregar();
    return null;
  }

  async function remover(t: Tarefa) {
    if (!window.confirm(`Remover a tarefa "${t.titulo}"? As respostas já dadas continuam no histórico.`)) return;
    const { error } = await supabase.from("tarefa").update({ deleted_at: new Date().toISOString() }).eq("id", t.id);
    if (error) setErro("Não consegui remover.");
    recarregar();
  }

  if (membership?.role === "cuidador" || membership?.role === "idoso") return <SemAcesso area="Tarefas" />;
  if (!membership) return <p className="text-sm text-subtle">Crie o perfil do idoso primeiro.</p>;

  const deHoje = new Map(tarefasDoDia(tarefas, respostas, hoje).map((i) => [i.tarefa.id, i]));
  const titulos = new Map(tarefas.map((t) => [t.id, t.titulo]));

  function situacao(t: Tarefa): { texto: string; tom: "neutral" | "success" | "warn" } {
    const item = deHoje.get(t.id);
    const r = item?.registro;
    if (r) {
      const quem = r.registrado_por ? nomes[r.registrado_por] : "";
      const quando = r.registrado_em ? `às ${horaBR(new Date(r.registrado_em))}` : "";
      return r.status === "feito"
        ? { texto: `Feito hoje${quem ? ` por ${quem}` : ""} ${quando}`, tom: "success" }
        : { texto: `Não conseguiu${quem ? ` (${quem})` : ""}`, tom: "warn" };
    }
    if (item) return item.atrasada ? { texto: "Atrasada", tom: "warn" } : { texto: "Falta fazer hoje", tom: "neutral" };
    if (t.frequencia === "uma_vez") {
      const antiga = respostas.find((x) => x.tarefa_id === t.id);
      if (antiga) return { texto: `${antiga.status === "feito" ? "Feita" : "Não foi possível"} em ${diaMes(antiga.data)}`, tom: antiga.status === "feito" ? "success" : "warn" };
      return { texto: `Agendada para ${diaMes(t.data)}`, tom: "neutral" };
    }
    return { texto: "Hoje não é dia", tom: "neutral" };
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Tarefas de quem cuida</h1>
        <p className="text-sm text-subtle">
          O que você pedir aqui aparece na lista do dia de quem cuida de {membership.idosoNome}.
          {admin ? " Remédios não entram aqui: eles já têm a própria lista." : " Só o administrador cria e edita."}
        </p>
      </div>

      {admin && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-ink">Nova tarefa</h2>
          <FormTarefa inicial={vazio()} rotulo="Criar tarefa" onSalvar={criar} />
        </Card>
      )}

      {erro && <p className="text-sm text-danger" role="alert">{erro}</p>}

      <Card className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-ink">Tarefas ({tarefas.length})</h2>
        {carregando && <p className="text-sm text-subtle">Carregando...</p>}
        {!carregando && tarefas.length === 0 && <p className="text-sm text-subtle">Nenhuma tarefa ainda.</p>}
        {tarefas.map((t) => {
          const s = situacao(t);
          const nota = deHoje.get(t.id)?.registro?.nota;
          return (
            <div key={t.id} className="flex flex-col gap-2 border-t border-line pt-3">
              {editando === t.id ? (
                <FormTarefa
                  inicial={{ titulo: t.titulo, instrucao: t.instrucao ?? "", frequencia: t.frequencia, dias_semana: t.dias_semana, data: t.data }}
                  rotulo="Salvar"
                  onSalvar={(f) => salvar(t, f)}
                  onCancelar={() => setEditando(null)}
                />
              ) : (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">{t.titulo}</p>
                      <p className="text-sm text-subtle">{[descreverQuando(t), t.instrucao].filter(Boolean).join(" · ")}</p>
                    </div>
                    <Badge tone={s.tom}>{s.texto}</Badge>
                  </div>
                  {nota && <p className="text-sm text-ink">Anotação: {nota}</p>}
                  {admin && (
                    <div className="flex gap-1">
                      <Button variant="ghost" onClick={() => setEditando(t.id)} className="h-9 px-2 text-xs">Editar</Button>
                      <Button variant="ghost" onClick={() => remover(t)} className="h-9 px-2 text-xs">Remover</Button>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </Card>

      {respostas.length > 0 && (
        <Card className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-ink">Últimas respostas</h2>
          {respostas.slice(0, 12).map((r) => (
            <div key={`${r.tarefa_id}-${r.data}`} className="flex flex-wrap justify-between gap-2 border-t border-line pt-2 text-sm">
              <span className="text-ink">
                {diaMes(r.data)} · {titulos.get(r.tarefa_id)}
                {r.nota ? <span className="text-subtle"> · {r.nota}</span> : null}
              </span>
              <span className={r.status === "feito" ? "text-success" : "text-warn"}>
                {r.status === "feito" ? "Feito" : "Não conseguiu"}
                {r.registrado_por && nomes[r.registrado_por] ? ` · ${nomes[r.registrado_por]}` : ""}
              </span>
            </div>
          ))}
          <p className="text-xs text-subtle">Dia sem resposta não aparece aqui: é &quot;sem registro&quot;, não quer dizer que não foi feito.</p>
        </Card>
      )}
    </div>
  );
}
