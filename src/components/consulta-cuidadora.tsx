"use client";

// "Vamos ao médico", para quem cuida: gravar ou contar, direto. O resto é apoio.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Button, Input } from "@/components/ui";
import { useGravacao } from "@/components/gravacao";
import { DocumentosParaLevar, EnviarFoto } from "@/components/papeis";
import {
  COLUNAS_CONSULTA_DIA,
  consultaDeHoje,
  criarConsulta,
  EVENTO_CONSULTA,
  type ConsultaDoDia,
} from "@/lib/consulta";
import { COLUNAS_REMEDIO, descreverAgenda, emUso, hojeBR, somarDias, type Remedio } from "@/lib/medicacao";
import type { ResumoConsulta } from "@/lib/ai/schemas";
import { cn } from "@/lib/cn";

type Tela = "inicio" | "contar" | "volta" | "quem" | "mostrar" | "documentos" | "perguntas" | "foto" | "anterior";

type Anterior = ConsultaDoDia & { resumo_json: ResumoConsulta | null };

const TITULOS: Record<Exclude<Tela, "inicio">, string> = {
  contar: "O que o médico disse?",
  volta: "O médico marcou a volta?",
  quem: "Com quem foi a consulta?",
  mostrar: "Mostre ao médico",
  documentos: "Documentos",
  perguntas: "O que perguntar",
  foto: "Foto de um papel",
  anterior: "Consulta anterior",
};

const grande = "flex min-h-[64px] w-full items-center justify-center rounded-2xl border-2 border-line bg-card px-4 text-lg font-semibold text-ink hover:bg-panel disabled:opacity-50";

const dataLonga = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" }) : "Sem data";
const dataCurta = (iso: string) => iso.split("-").reverse().join("/");
const nomeDoMedico = (c: { medico: string | null; especialidade: string | null }) =>
  [c.medico, c.especialidade].filter(Boolean).join(", ");

function Icone({ caminhos, tamanho = 32 }: { caminhos: string[]; tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      {caminhos.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

const I = {
  microfone: ["M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z", "M19 10v2a7 7 0 0 1-14 0v-2", "M12 19v3"],
  fala: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
  ficha: ["M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1z", "M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2", "M12 11v6", "M9 14h6"],
  documento: ["M3 5h18v14H3z", "M7 10h5", "M7 14h3", "M16 10v4"],
  pergunta: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3", "M12 17h.01"],
  camera: ["M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z", "M12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"],
};

export function ConsultaCuidadora() {
  const supabase = createClient();
  const membership = useRole();
  const idosoId = membership?.idosoId;
  const gravacao = useGravacao();

  const [tela, setTela] = useState<Tela>("inicio");
  const [fila, setFila] = useState<Tela[]>([]);
  const [hojeC, setHojeC] = useState<ConsultaDoDia | null>(null);
  const [anteriores, setAnteriores] = useState<Anterior[]>([]);
  const [perguntasAbertas, setPerguntasAbertas] = useState(0);
  const [escolhida, setEscolhida] = useState<Anterior | null>(null);
  const [outra, setOutra] = useState(false);
  const [versao, setVersao] = useState(0);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = () => setVersao((v) => v + 1);

  useEffect(() => {
    if (!idosoId) return;
    let cancelado = false;
    (async () => {
      try {
        const [atual, { data: lista }, { count }] = await Promise.all([
          consultaDeHoje(supabase, idosoId),
          supabase
            .from("consulta")
            .select(`${COLUNAS_CONSULTA_DIA}, resumo_json`)
            .eq("idoso_id", idosoId)
            .is("deleted_at", null)
            .order("data", { ascending: false })
            .limit(15),
          supabase.from("item_pauta").select("id", { count: "exact", head: true }).eq("idoso_id", idosoId).is("resolvido_em", null).is("deleted_at", null),
        ]);
        if (cancelado) return;
        setHojeC(atual);
        setAnteriores(((lista ?? []) as unknown as Anterior[]).filter((c) => c.id !== atual?.id));
        setPerguntasAbertas(count ?? 0);
      } catch {
        if (!cancelado) setErro("Não consegui carregar. Confira a internet.");
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [supabase, idosoId, versao]);

  // Áudio guardado: se ainda não se sabe com quem foi, pergunta (dá para pular).
  useEffect(() => {
    if (!idosoId) return;
    async function guardou() {
      setOutra(false);
      setVersao((v) => v + 1);
      const c = await consultaDeHoje(supabase, idosoId as string).catch(() => null);
      if (c && !c.medico) setTela((t) => (t === "inicio" ? "quem" : t));
    }
    window.addEventListener(EVENTO_CONSULTA, guardou);
    return () => window.removeEventListener(EVENTO_CONSULTA, guardou);
  }, [supabase, idosoId]);

  if (!membership || !idosoId) return null;

  function seguir(restante: Tela[] = fila) {
    const [proxima, ...resto] = restante;
    setFila(resto);
    setTela(proxima ?? "inicio");
    recarregar();
  }

  async function gravar() {
    setErro(null);
    const falha = await gravacao.iniciar(outra);
    if (falha) setErro(falha);
  }

  const ir = (t: Tela) => {
    setErro(null);
    setFila([]);
    setTela(t);
  };

  if (tela !== "inicio") {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4">
        <button type="button" onClick={() => { setFila([]); setTela("inicio"); recarregar(); }} className="inline-flex h-11 w-fit items-center gap-2 rounded-lg border border-line bg-card px-4 text-base font-medium text-ink hover:bg-panel">
          <span aria-hidden>←</span> Voltar
        </button>
        <h1 className="text-2xl font-semibold text-ink">{TITULOS[tela]}</h1>

        {tela === "contar" && (
          <Contar
            idosoId={idosoId}
            forcarNova={outra}
            onGuardado={(c, primeiraVez) => {
              setOutra(false);
              setHojeC(c);
              const proximas: Tela[] = [];
              if (primeiraVez) proximas.push("volta");
              if (!c.medico) proximas.push("quem");
              seguir(proximas);
            }}
          />
        )}
        {tela === "volta" && <Volta idosoId={idosoId} onPronto={() => seguir()} />}
        {tela === "quem" && <Quem idosoId={idosoId} anteriores={anteriores} onPronto={() => seguir()} />}
        {tela === "mostrar" && <Mostrar idosoId={idosoId} nome={membership.idosoNomeCompleto ?? membership.idosoNome ?? ""} />}
        {tela === "documentos" && <DocumentosParaLevar idosoId={idosoId} />}
        {tela === "perguntas" && <Perguntas idosoId={idosoId} consultaId={hojeC?.id ?? null} />}
        {tela === "foto" && <EnviarFoto idosoId={idosoId} />}
        {tela === "anterior" && escolhida && <Detalhe consulta={escolhida} />}
      </div>
    );
  }

  const gravando = gravacao.estado !== "parado";
  const gravada = !!hojeC?.audio_url && !outra;
  const contada = !!hojeC?.transcricao?.trim() && !outra;
  const principal = "flex min-h-[104px] w-full items-center gap-4 rounded-2xl border-2 px-4 text-left";

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-2xl font-semibold text-ink">Vamos ao médico</h1>
      {erro && <p className="rounded-2xl bg-danger/10 p-3 text-base font-medium text-danger" role="alert">{erro}</p>}

      {!gravando && (
        <button type="button" onClick={gravar} className={cn(principal, "border-danger bg-danger/10 text-danger")}>
          <Icone caminhos={I.microfone} />
          <span>
            <span className="block text-xl font-bold">Gravar a consulta</span>
            <span className="block text-base">{gravada ? "Gravada hoje. Toque para gravar mais." : "Começa na hora."}</span>
          </span>
        </button>
      )}
      <button type="button" onClick={() => ir("contar")} className={cn(principal, "border-line bg-card text-ink hover:bg-panel")}>
        <Icone caminhos={I.fala} />
        <span>
          <span className="block text-xl font-bold">Contar sobre a consulta</span>
          <span className="block text-base text-subtle">{contada ? "Contado hoje. Toque para completar." : "Fale ou escreva o que o médico disse."}</span>
        </span>
      </button>

      {hojeC && (gravada || contada) && (
        <div className="rounded-2xl bg-panel p-4">
          <p className="text-base font-medium text-ink">
            ✓ Consulta de hoje{nomeDoMedico(hojeC) ? `: ${nomeDoMedico(hojeC)}` : ""}
          </p>
          <p className="text-base text-subtle">
            {[gravada ? "gravada" : "", contada ? "contada" : "", hojeC.retorno_em ? `volta em ${dataCurta(hojeC.retorno_em)}` : ""].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {!hojeC.medico && <Button className="h-11" onClick={() => ir("quem")}>Dizer com quem foi</Button>}
            <Button className="h-11" onClick={() => ir("volta")}>{hojeC.retorno_em ? "Mudar a volta" : "Marcar a volta"}</Button>
            <Button variant="ghost" className="h-11" onClick={() => setOutra(true)}>Foi outra consulta</Button>
          </div>
        </div>
      )}
      {outra && <p className="text-base text-subtle">Certo. O que você gravar ou contar agora vira outra consulta.</p>}

      <h2 className="pt-1 text-lg font-semibold text-ink">Na hora você pode precisar</h2>
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ["mostrar", "Mostrar ao médico", I.ficha],
            ["documentos", "Documentos", I.documento],
            ["perguntas", `O que perguntar${perguntasAbertas ? ` (${perguntasAbertas})` : ""}`, I.pergunta],
            ["foto", "Foto de um papel", I.camera],
          ] as [Tela, string, string[]][]
        ).map(([t, rotulo, icone]) => (
          <button key={t} type="button" onClick={() => ir(t)} className="flex min-h-[96px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-line bg-card px-2 text-center text-base font-semibold text-ink hover:bg-panel">
            <Icone caminhos={icone} tamanho={28} />
            {rotulo}
          </button>
        ))}
      </div>

      {anteriores.length > 0 && (
        <>
          <h2 className="pt-1 text-lg font-semibold text-ink">Consultas anteriores</h2>
          {anteriores.slice(0, 8).map((c) => (
            <button key={c.id} type="button" onClick={() => { setEscolhida(c); ir("anterior"); }} className="flex min-h-[64px] w-full items-center justify-between gap-2 rounded-2xl border border-line bg-card px-4 py-2 text-left">
              <span>
                <span className="block text-base font-medium text-ink">{nomeDoMedico(c) || "Consulta"}</span>
                <span className="block text-sm text-subtle">{dataLonga(c.data)}</span>
              </span>
              <span className="text-2xl text-subtle" aria-hidden>›</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

function Contar({
  idosoId,
  forcarNova,
  onGuardado,
}: {
  idosoId: string;
  forcarNova: boolean;
  onGuardado: (c: ConsultaDoDia, primeiraVez: boolean) => void;
}) {
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function guardar() {
    if (!texto.trim()) {
      setErro("Escreva ou fale alguma coisa antes de guardar.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const supabase = createClient();
      const atual = forcarNova ? null : await consultaDeHoje(supabase, idosoId);
      const primeiraVez = !atual?.transcricao?.trim();
      let c: ConsultaDoDia;
      if (atual) {
        // Soma ao que já havia: nada do relato anterior se perde.
        const junto = [atual.transcricao?.trim(), texto.trim()].filter(Boolean).join("\n\n");
        const { error } = await supabase.from("consulta").update({ transcricao: junto }).eq("id", atual.id);
        if (error) throw new Error(error.message);
        c = { ...atual, transcricao: junto };
      } else {
        c = await criarConsulta(supabase, idosoId, { transcricao: texto.trim() });
      }
      onGuardado(c, primeiraVez);
    } catch {
      setErro("Não consegui guardar. O texto continua aqui: confira a internet e tente de novo.");
      setSalvando(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-base text-subtle">Toque no quadro e use o microfone do teclado para falar, se preferir.</p>
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={8}
        aria-label="O que o médico disse"
        placeholder="Ex: pediu exame de sangue e aumentou o remédio da pressão."
        className="w-full rounded-2xl border-2 border-line bg-card p-4 text-lg text-ink placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      />
      {erro && <p className="text-base text-danger" role="alert">{erro}</p>}
      <Button variant="primary" onClick={guardar} disabled={salvando} className="h-16 text-xl">
        {salvando ? "Guardando..." : "Guardar"}
      </Button>
    </div>
  );
}

function Volta({ idosoId, onPronto }: { idosoId: string; onPronto: () => void }) {
  const [dia, setDia] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const hoje = hojeBR();

  async function marcar(data: string | null) {
    setOcupado(true);
    setErro(null);
    try {
      const supabase = createClient();
      const c = await consultaDeHoje(supabase, idosoId);
      // "Não marcou" só precisa gravar algo se antes havia uma volta marcada.
      if (c && (data || c.retorno_em)) {
        const { error } = await supabase.rpc("registrar_volta", { p_consulta: c.id, p_data: data });
        if (error) throw new Error(error.message);
      } else if (!c && data) {
        throw new Error("sem consulta");
      }
      onPronto();
    } catch {
      setErro("Não consegui marcar. Confira a internet e tente de novo.");
      setOcupado(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {erro && <p className="text-base text-danger" role="alert">{erro}</p>}
      <button type="button" className={grande} disabled={ocupado} onClick={() => marcar(null)}>Não marcou</button>
      {(
        [
          ["Em 1 mês", 30],
          ["Em 3 meses", 91],
          ["Em 6 meses", 182],
        ] as [string, number][]
      ).map(([rotulo, dias]) => (
        <button key={rotulo} type="button" className={cn(grande, "justify-between")} disabled={ocupado} onClick={() => marcar(somarDias(hoje, dias))}>
          {rotulo}
          <span className="text-base font-normal text-subtle">{dataCurta(somarDias(hoje, dias))}</span>
        </button>
      ))}
      <label className="flex flex-col gap-1 pt-2 text-base text-subtle">
        Ou o dia certo
        <Input type="date" min={hoje} value={dia} onChange={(e) => setDia(e.target.value)} className="h-14 text-lg" />
      </label>
      <button type="button" className={grande} disabled={ocupado || !dia || dia < hoje} onClick={() => marcar(dia)}>Marcar este dia</button>
      <p className="text-sm text-subtle">Marcando um dia, ele entra na sua lista como &quot;Consulta de volta&quot;, e a família é avisada.</p>
    </div>
  );
}

function Quem({ idosoId, anteriores, onPronto }: { idosoId: string; anteriores: Anterior[]; onPronto: () => void }) {
  const [outro, setOutro] = useState(false);
  const [medico, setMedico] = useState("");
  const [especialidade, setEspecialidade] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Médicos de consultas anteriores viram botões.
  const conhecidos = [...new Map(anteriores.filter((c) => c.medico).map((c) => [nomeDoMedico(c), c])).values()].slice(0, 5);

  async function salvar(m: string, e: string | null) {
    if (!m.trim()) {
      setErro("Escreva o nome do médico.");
      return;
    }
    setOcupado(true);
    setErro(null);
    try {
      const supabase = createClient();
      const c = await consultaDeHoje(supabase, idosoId);
      if (c) {
        const { error } = await supabase.from("consulta").update({ medico: m.trim(), especialidade: e?.trim() || null }).eq("id", c.id);
        if (error) throw new Error(error.message);
      }
      onPronto();
    } catch {
      setErro("Não consegui guardar. Tente de novo.");
      setOcupado(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {erro && <p className="text-base text-danger" role="alert">{erro}</p>}
      {conhecidos.map((c) => (
        <button key={c.id} type="button" className={grande} disabled={ocupado} onClick={() => salvar(c.medico as string, c.especialidade)}>
          {nomeDoMedico(c)}
        </button>
      ))}
      {outro || conhecidos.length === 0 ? (
        <div className="flex flex-col gap-2">
          <Input value={medico} onChange={(e) => setMedico(e.target.value)} placeholder="Nome do médico" aria-label="Nome do médico" className="h-14 text-lg" />
          <Input value={especialidade} onChange={(e) => setEspecialidade(e.target.value)} placeholder="Especialidade (se souber)" aria-label="Especialidade" className="h-14 text-lg" />
          <Button variant="primary" disabled={ocupado} onClick={() => salvar(medico, especialidade)} className="h-14 text-lg">Guardar</Button>
        </div>
      ) : (
        <button type="button" className={grande} onClick={() => setOutro(true)}>Outro médico</button>
      )}
      <Button variant="ghost" onClick={onPronto} className="h-12 text-base">Pular</Button>
    </div>
  );
}

function Mostrar({ idosoId, nome }: { idosoId: string; nome: string }) {
  const [blocos, setBlocos] = useState<[string, string[]][] | null>(null);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const supabase = createClient();
      const [a, c, m, s] = await Promise.all([
        supabase.from("alergia").select("substancia, reacao").eq("idoso_id", idosoId).is("deleted_at", null),
        supabase.from("condicao").select("nome").eq("idoso_id", idosoId).eq("ativa", true).is("deleted_at", null),
        supabase.from("medicacao").select(COLUNAS_REMEDIO).eq("idoso_id", idosoId).eq("ativo", true).is("deleted_at", null).order("nome"),
        supabase
          .from("sintoma")
          .select("data, descricao")
          .eq("idoso_id", idosoId)
          .is("deleted_at", null)
          .gte("data", new Date(Date.now() - 14 * 86_400_000).toISOString())
          .order("data", { ascending: false })
          .limit(10),
      ]);
      if (cancelado) return;
      if (a.error || c.error || m.error || s.error) {
        setFalhou(true);
        return;
      }
      setBlocos([
        ["Alergias", (a.data ?? []).map((x) => `${x.substancia}${x.reacao ? ` (${x.reacao})` : ""}`)],
        ["Doenças", (c.data ?? []).map((x) => x.nome as string)],
        [
          "Remédios em uso",
          ((m.data ?? []) as unknown as Remedio[])
            .filter((r) => emUso(r, hojeBR()))
            .map((r) => `${[r.nome, r.dosagem].filter(Boolean).join(" ")} · ${descreverAgenda(r)}`),
        ],
        ["Queixas dos últimos 14 dias", (s.data ?? []).map((x) => `${dataCurta((x.data as string).slice(0, 10))}: ${x.descricao}`)],
      ]);
    })();
    return () => {
      cancelado = true;
    };
  }, [idosoId]);

  if (falhou) {
    return (
      <p className="rounded-2xl bg-danger/10 p-4 text-lg text-danger" role="alert">
        Não consegui carregar os dados. Isso não quer dizer que não há alergias. Tente de novo antes de mostrar ao médico.
      </p>
    );
  }
  if (!blocos) return <p className="text-base text-subtle">Carregando...</p>;

  return (
    <div className="flex flex-col gap-4 rounded-2xl border-2 border-line bg-card p-4">
      <p className="text-xl font-bold text-ink">{nome}</p>
      {blocos.map(([titulo, itens]) => (
        <div key={titulo}>
          <h2 className="text-base font-semibold text-subtle">{titulo}</h2>
          {itens.length === 0 ? (
            <p className="text-lg text-ink">Nada registrado</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {itens.map((i) => (
                <li key={i} className="text-lg text-ink">{i}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

type Pergunta = { id: string; titulo: string; resolvido_em: string | null };

function Perguntas({ idosoId, consultaId }: { idosoId: string; consultaId: string | null }) {
  const supabase = createClient();
  const [itens, setItens] = useState<Pergunta[] | null>(null);
  const [nova, setNova] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const { data } = await supabase
        .from("item_pauta")
        .select("id, titulo, resolvido_em")
        .eq("idoso_id", idosoId)
        .is("resolvido_em", null)
        .is("deleted_at", null)
        .order("created_at");
      if (!cancelado) setItens((data ?? []) as Pergunta[]);
    })();
    return () => {
      cancelado = true;
    };
  }, [supabase, idosoId]);

  // Quem marcou sem querer pode desmarcar: o item só sai da lista na próxima vez.
  async function alternar(p: Pergunta) {
    const perguntada = !p.resolvido_em;
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("item_pauta")
      .update({
        resolvido_em: perguntada ? new Date().toISOString() : null,
        resolvido_por: perguntada ? auth.user?.id ?? null : null,
        consulta_id: perguntada ? consultaId : null,
      })
      .eq("id", p.id);
    if (error) {
      setErro("Não consegui marcar. Tente de novo.");
      return;
    }
    setItens((l) => (l ?? []).map((x) => (x.id === p.id ? { ...x, resolvido_em: perguntada ? new Date().toISOString() : null } : x)));
  }

  async function adicionar() {
    if (!nova.trim()) return;
    const { data, error } = await supabase
      .from("item_pauta")
      .insert({ idoso_id: idosoId, titulo: nova.trim() })
      .select("id, titulo, resolvido_em")
      .single();
    if (error || !data) {
      setErro("Não consegui guardar a pergunta.");
      return;
    }
    setErro(null);
    setItens((l) => [...(l ?? []), data as Pergunta]);
    setNova("");
  }

  if (!itens) return <p className="text-base text-subtle">Carregando...</p>;

  return (
    <div className="flex flex-col gap-2">
      {erro && <p className="text-base text-danger" role="alert">{erro}</p>}
      {itens.length === 0 && <p className="text-base text-subtle">Nenhuma pergunta anotada.</p>}
      {itens.map((p) => (
        <button
          key={p.id}
          type="button"
          aria-pressed={!!p.resolvido_em}
          onClick={() => alternar(p)}
          className={cn("flex min-h-[64px] w-full items-center gap-3 rounded-2xl px-4 py-2 text-left", p.resolvido_em ? "bg-panel text-subtle" : "border-2 border-line bg-card text-ink")}
        >
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-bold", p.resolvido_em ? "bg-subtle/25" : "border-2 border-subtle/50")} aria-hidden>
            {p.resolvido_em ? "✓" : ""}
          </span>
          <span className="text-lg">{p.titulo}</span>
        </button>
      ))}
      {itens.length > 0 && <p className="text-sm text-subtle">Toque depois de perguntar.</p>}
      <div className="mt-2 flex gap-2">
        <Input value={nova} onChange={(e) => setNova(e.target.value)} placeholder="Anotar outra pergunta" aria-label="Nova pergunta" className="h-14 text-base" />
        <Button onClick={adicionar} className="h-14 shrink-0">Anotar</Button>
      </div>
    </div>
  );
}

function Detalhe({ consulta }: { consulta: Anterior }) {
  const supabase = createClient();
  const [audio, setAudio] = useState<string | null>(null);

  useEffect(() => {
    if (!consulta.audio_url) return;
    let cancelado = false;
    createClient()
      .storage.from("consultas")
      .createSignedUrl(consulta.audio_url, 3600)
      .then(({ data }) => {
        if (!cancelado) setAudio(data?.signedUrl ?? null);
      });
    return () => {
      cancelado = true;
    };
  }, [supabase, consulta.audio_url]);

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-2xl border border-line bg-card p-4">
        <p className="text-lg font-semibold text-ink">{nomeDoMedico(consulta) || "Consulta"}</p>
        <p className="text-base text-subtle">{dataLonga(consulta.data)}</p>
        {consulta.retorno_em && <p className="text-base text-ink">Volta em {dataCurta(consulta.retorno_em)}</p>}
      </div>
      {audio && <audio controls src={audio} className="w-full" />}
      {consulta.resumo_json?.resumo && <p className="rounded-2xl bg-panel p-4 text-lg text-ink">{consulta.resumo_json.resumo}</p>}
      {consulta.transcricao && <p className="whitespace-pre-wrap rounded-2xl bg-panel p-4 text-base text-ink">{consulta.transcricao}</p>}
      {!consulta.audio_url && !consulta.transcricao && !consulta.resumo_json && <p className="text-base text-subtle">Nada foi anotado nesta consulta.</p>}
    </div>
  );
}
