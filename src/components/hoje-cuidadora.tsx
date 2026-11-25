"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Button, Input } from "@/components/ui";
import {
  COLUNAS_DOSE,
  COLUNAS_REMEDIO,
  dosesDoDia,
  hojeBR,
  horaBR,
  type RegistroDose,
  type Remedio,
} from "@/lib/medicacao";
import {
  COLUNAS_REGISTRO_TAREFA,
  COLUNAS_TAREFA,
  tarefasDoDia,
  type ItemTarefa,
  type RegistroTarefa,
  type Tarefa,
} from "@/lib/tarefas";
import { cn } from "@/lib/cn";
import { FILTRO_RELATO } from "@/lib/diario";
import { FotoDoDia } from "@/components/foto-do-dia";

type DiaContado = { quando: string; quemId: string | null } | null;

type Dados = {
  remedios: Remedio[];
  doses: RegistroDose[];
  tarefas: Tarefa[];
  respostas: RegistroTarefa[];
  diaContado: DiaContado;
  nomes: Record<string, string>;
  eu: string | null;
};

const ATUALIZA_MS = 60_000;

/** Ícones simples, sem biblioteca. */
function Icone({ caminhos }: { caminhos: string[] }) {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      {caminhos.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

function Marca({ estado }: { estado: "falta" | "feito" | "atencao" }) {
  return (
    <span
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg font-bold",
        estado === "falta" && "border-2 border-subtle/50",
        estado === "feito" && "bg-subtle/25 text-subtle",
        estado === "atencao" && "bg-warn/20 text-warn",
      )}
      aria-hidden
    >
      {estado === "feito" ? "✓" : estado === "atencao" ? "!" : ""}
    </span>
  );
}

const linha = (feito: boolean, atrasada = false) =>
  cn(
    "flex min-h-[76px] w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors",
    feito ? "bg-panel" : cn("border-2 bg-card hover:bg-panel", atrasada ? "border-warn/70" : "border-line"),
  );

const titulo = (feito: boolean) => cn("block text-lg font-semibold leading-tight", feito ? "text-subtle" : "text-ink");

export function HojeCuidadora({ primeiroNome }: { primeiroNome: string }) {
  const supabase = createClient();
  const membership = useRole();
  const idosoId = membership?.idosoId;
  const [dados, setDados] = useState<Dados | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [aberta, setAberta] = useState<string | null>(null);
  const [nota, setNota] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const hoje = hojeBR();

  // Tarefas novas e a virada do dia aparecem sozinhas.
  useEffect(() => {
    const atualizar = () => setRecarga((r) => r + 1);
    const relogio = window.setInterval(atualizar, ATUALIZA_MS);
    window.addEventListener("focus", atualizar);
    return () => {
      window.clearInterval(relogio);
      window.removeEventListener("focus", atualizar);
    };
  }, []);

  useEffect(() => {
    if (!idosoId) return;
    let cancelado = false;
    (async () => {
      const inicioDoDia = `${hoje}T00:00:00-03:00`;
      const [{ data: ms }, { data: ts }, { data: diario }, { data: humor }, { data: checkins }, { data: auth }] =
        await Promise.all([
          supabase.from("medicacao").select(COLUNAS_REMEDIO).eq("idoso_id", idosoId).eq("ativo", true).is("deleted_at", null),
          supabase.from("tarefa").select(COLUNAS_TAREFA).eq("idoso_id", idosoId).is("deleted_at", null),
          supabase.from("entrada_diario").select("autor_id, data").eq("idoso_id", idosoId).is("deleted_at", null).or(FILTRO_RELATO).gte("data", inicioDoDia).order("data").limit(1),
          supabase.from("humor").select("autor_id, data").eq("idoso_id", idosoId).is("deleted_at", null).gte("data", inicioDoDia).order("data").limit(1),
          supabase.from("conversa").select("iniciada_por, updated_at").eq("idoso_id", idosoId).eq("tipo", "checkin_diario").eq("data_referencia", hoje).eq("status", "concluida").limit(1),
          supabase.auth.getUser(),
        ]);
      const remedios = (ms ?? []) as unknown as Remedio[];
      const tarefas = (ts ?? []) as unknown as Tarefa[];
      const [{ data: ds }, { data: rs }] = await Promise.all([
        remedios.length
          ? supabase.from("registro_medicacao").select(COLUNAS_DOSE).in("medicacao_id", remedios.map((m) => m.id)).eq("data", hoje).is("deleted_at", null)
          : Promise.resolve({ data: [] }),
        tarefas.length
          ? supabase.from("tarefa_registro").select(COLUNAS_REGISTRO_TAREFA).in("tarefa_id", tarefas.map((t) => t.id)).is("deleted_at", null).order("data", { ascending: false }).limit(500)
          : Promise.resolve({ data: [] }),
      ]);
      const respostas = (rs ?? []) as unknown as RegistroTarefa[];

      const entrada = diario?.[0] ?? humor?.[0];
      const diaContado: DiaContado = entrada
        ? { quando: entrada.data as string, quemId: entrada.autor_id as string | null }
        : checkins?.[0]
          ? { quando: checkins[0].updated_at as string, quemId: checkins[0].iniciada_por as string | null }
          : null;

      const ids = [...new Set([...respostas.map((r) => r.registrado_por), diaContado?.quemId].filter(Boolean))] as string[];
      const { data: us } = ids.length ? await supabase.from("usuario").select("id, nome").in("id", ids) : { data: [] };
      if (cancelado) return;
      setDados({
        remedios,
        doses: (ds ?? []) as unknown as RegistroDose[],
        tarefas,
        respostas,
        diaContado,
        nomes: Object.fromEntries((us ?? []).map((u) => [u.id as string, ((u.nome as string) ?? "").split(" ")[0]])),
        eu: auth.user?.id ?? null,
      });
    })();
    return () => {
      cancelado = true;
    };
  }, [supabase, idosoId, hoje, recarga]);

  async function responder(item: ItemTarefa, status: "feito" | "nao_consegui") {
    if (ocupado || !dados) return;
    setOcupado(true);
    setErro(null);
    const { error } = await supabase.from("tarefa_registro").upsert(
      {
        tarefa_id: item.tarefa.id,
        data: item.registro?.data ?? hoje,
        status,
        nota: nota.trim() || null,
        registrado_por: dados.eu,
        registrado_em: new Date().toISOString(),
        deleted_at: null,
      },
      { onConflict: "tarefa_id,data" },
    );
    if (error) setErro("Não consegui salvar. Confira a internet e tente de novo.");
    else {
      setAberta(null);
      setNota("");
    }
    setOcupado(false);
    setRecarga((r) => r + 1);
  }

  async function desmarcar(item: ItemTarefa) {
    if (ocupado || !item.registro) return;
    setOcupado(true);
    setErro(null);
    const { error } = await supabase
      .from("tarefa_registro")
      .update({ deleted_at: new Date().toISOString(), registrado_por: dados?.eu })
      .eq("tarefa_id", item.tarefa.id)
      .eq("data", item.registro.data);
    if (error) setErro("Não consegui desmarcar. Tente de novo.");
    else setAberta(null);
    setOcupado(false);
    setRecarga((r) => r + 1);
  }

  if (!membership) return null;

  const dataLonga = new Date(`${hoje}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });

  const cabecalho = (
    <div>
      <p className="text-sm text-subtle first-letter:uppercase">{dataLonga}</p>
      <h1 className="text-3xl font-semibold text-ink">{primeiroNome ? `Olá, ${primeiroNome}!` : "Olá!"}</h1>
      <p className="text-base text-subtle">Cuidando de {membership.idosoNome}</p>
    </div>
  );

  if (!dados) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4">
        {cabecalho}
        <p className="text-base text-subtle">Carregando o seu dia...</p>
      </div>
    );
  }

  const doses = dosesDoDia(dados.remedios, dados.doses, hoje);
  const marcadas = doses.filter((d) => d.registro).length;
  const naoDadas = doses.filter((d) => d.registro?.status === "nao_dada").length;
  const atrasadas = doses.filter((d) => d.atrasada).length;
  const tarefas = tarefasDoDia(dados.tarefas, dados.respostas, hoje);

  const quemQuando = (id: string | null | undefined, iso: string | undefined) =>
    [id ? (id === dados.eu ? "você" : dados.nomes[id]) : "", iso ? `às ${horaBR(new Date(iso))}` : ""].filter(Boolean).join(" ");

  // Cada linha do checklist: a própria linha é o botão.
  const itens: { chave: string; feito: boolean; no: React.ReactNode }[] = [];

  if (doses.length > 0) {
    const feito = marcadas === doses.length;
    itens.push({
      chave: "remedios",
      feito,
      no: (
        <Link href="/hoje/remedios" className={linha(feito, atrasadas > 0)}>
          <Marca estado={feito ? (naoDadas ? "atencao" : "feito") : "falta"} />
          <span className="min-w-0 flex-1">
            <span className={titulo(feito)}>Remédios de hoje</span>
            <span className="block text-base text-subtle">
              {marcadas} de {doses.length} {doses.length === 1 ? "marcado" : "marcados"}
              {atrasadas > 0 && <span className="font-medium text-warn"> · {atrasadas} {atrasadas === 1 ? "atrasado" : "atrasados"}</span>}
              {naoDadas > 0 && <span className="font-medium text-warn"> · {naoDadas} não {naoDadas === 1 ? "dado" : "dados"}</span>}
            </span>
          </span>
          <span className="text-2xl text-subtle" aria-hidden>›</span>
        </Link>
      ),
    });
  }

  itens.push({
    chave: "dia",
    feito: !!dados.diaContado,
    no: (
      <Link href="/conversa" className={linha(!!dados.diaContado)}>
        <Marca estado={dados.diaContado ? "feito" : "falta"} />
        <span className="min-w-0 flex-1">
          <span className={titulo(!!dados.diaContado)}>Contar como foi o dia</span>
          <span className="block text-base text-subtle">
            {dados.diaContado ? `Feito ${quemQuando(dados.diaContado.quemId, dados.diaContado.quando)}` : "Falta fazer"}
          </span>
        </span>
        <span className="text-2xl text-subtle" aria-hidden>›</span>
      </Link>
    ),
  });

  for (const item of tarefas) {
    const r = item.registro;
    const k = item.tarefa.id;
    const naoConseguiu = r?.status === "nao_consegui";
    const expandida = aberta === k;
    itens.push({
      chave: k,
      feito: !!r,
      no: (
        <div className={cn("rounded-2xl", expandida && "ring-2 ring-primary")}>
          <button
            type="button"
            aria-expanded={expandida}
            onClick={() => {
              setAberta(expandida ? null : k);
              setNota(r?.nota ?? "");
              setErro(null);
            }}
            className={linha(!!r, item.atrasada)}
          >
            <Marca estado={r ? (naoConseguiu ? "atencao" : "feito") : "falta"} />
            <span className="min-w-0 flex-1">
              <span className={titulo(!!r)}>{item.tarefa.titulo}</span>
              <span className={cn("block text-base", naoConseguiu || item.atrasada ? "font-medium text-warn" : "text-subtle")}>
                {r
                  ? `${naoConseguiu ? "Não consegui" : "Feito"} ${quemQuando(r.registrado_por, r.registrado_em)}${r.nota ? ` · ${r.nota}` : ""}`
                  : item.atrasada
                    ? "Atrasada"
                    : item.tarefa.instrucao || "Falta fazer"}
              </span>
            </span>
          </button>

          {expandida && (
            <div className="flex flex-col gap-3 p-3">
              {/* Pendente e em dia, a própria linha já mostra a instrução. */}
              {item.tarefa.instrucao && (r || item.atrasada) && <p className="text-base text-ink">{item.tarefa.instrucao}</p>}
              <label className="flex flex-col gap-1 text-sm text-subtle">
                Quer anotar algo? (opcional)
                <Input value={nota} maxLength={300} onChange={(e) => setNota(e.target.value)} className="h-12 text-base" />
              </label>
              {erro && <p className="text-sm text-danger" role="alert">{erro}</p>}
              <div className="grid grid-cols-2 gap-2">
                <Button variant="primary" disabled={ocupado} onClick={() => responder(item, "feito")} className="h-14 text-lg">
                  ✓ Fiz
                </Button>
                <Button disabled={ocupado} onClick={() => responder(item, "nao_consegui")} className="h-14 text-base">
                  Não consegui
                </Button>
              </div>
              {r && (
                <Button variant="ghost" disabled={ocupado} onClick={() => desmarcar(item)} className="h-11">
                  Desmarcar
                </Button>
              )}
            </div>
          )}
        </div>
      ),
    });
  }

  const pendentes = itens.filter((i) => !i.feito);
  const prontos = itens.filter((i) => i.feito);

  const atalho = (href: string, rotulo: string, caminhos: string[], vermelho = false) => (
    <Link
      href={href}
      className={cn(
        "flex min-h-[72px] items-center gap-4 rounded-2xl border-2 px-4 text-lg font-semibold",
        vermelho ? "border-danger bg-danger/10 text-danger" : "border-line bg-card text-ink hover:bg-panel",
      )}
    >
      <Icone caminhos={caminhos} />
      {rotulo}
    </Link>
  );

  return (
    <div className="mx-auto flex max-w-md flex-col gap-5">
      {cabecalho}

      <section className="flex flex-col gap-3" aria-label="O que fazer hoje">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-ink">Hoje</h2>
          <span className="text-base text-subtle">
            {prontos.length} de {itens.length} feitos
          </span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-panel" role="progressbar" aria-label="Coisas de hoje" aria-valuemin={0} aria-valuemax={itens.length} aria-valuenow={prontos.length}>
          <div className="h-full rounded-full bg-success transition-all duration-300" style={{ width: `${(prontos.length / itens.length) * 100}%` }} />
        </div>

        {pendentes.length === 0 && (
          <p className="rounded-2xl bg-success/10 px-4 py-4 text-center text-lg font-medium text-success">✓ Tudo de hoje está feito</p>
        )}
        {pendentes.map((i) => (
          <div key={i.chave}>{i.no}</div>
        ))}
        {prontos.length > 0 && (
          <>
            <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-subtle">Já feitos</p>
            {prontos.map((i) => (
              <div key={i.chave}>{i.no}</div>
            ))}
          </>
        )}
      </section>

      {idosoId && <FotoDoDia idosoId={idosoId} nome={membership.idosoNome ?? "quem você cuida"} recarga={recarga} />}

      <section className="flex flex-col gap-3" aria-label="Quando precisar">
        <h2 className="text-lg font-semibold text-ink">Quando precisar</h2>
        {doses.length === 0 && atalho("/hoje/remedios", "Remédios", ["m10.5 20.5 10-10a4.95 4.95 0 0 0-7-7l-10 10a4.95 4.95 0 0 0 7 7Z", "m8.5 8.5 7 7"])}
        {atalho("/sintomas", "Sintoma novo", ["M12 9v4", "M12 17h.01", "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"])}
        {atalho("/consultas", "Vamos ao médico", ["M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 12 0V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3", "M8 15v1a6 6 0 0 0 12 0v-4", "M20 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"])}
        {atalho("/hoje/papel", "Exame ou receita nova", ["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", "M14 2v6h6", "M12 18v-6", "M9 15h6"])}
        {atalho("/hoje/emergencia", "Emergência", ["M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2.1Z"], true)}
      </section>
    </div>
  );
}
