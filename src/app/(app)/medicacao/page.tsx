"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Badge, Button, Card } from "@/components/ui";
import { DosesDeHoje } from "@/components/doses-de-hoje";
import { RemediosEsperando } from "@/components/remedios-esperando";
import { FormRemedio, type DadosRemedio } from "@/components/form-remedio";
import { COLUNAS_REMEDIO, descreverAgenda, emUso, hojeBR, type Remedio } from "@/lib/medicacao";
import { carregarRevisoes, decidirRevisao, efeitoDeNegar, EVENTO_REMEDIOS, type Revisao } from "@/lib/revisoes";

/** Em edição: "editar" grava direto; "confirmar" grava e aprova; "mudar" vale na hora e vai para revisão. */
type Edicao = { id: string; modo: "editar" | "confirmar" | "mudar" } | null;

export default function MedicacaoPage() {
  const supabase = createClient();
  const membership = useRole();
  const idosoId = membership?.idosoId;
  const admin = !!membership?.admin;

  const [remedios, setRemedios] = useState<Remedio[]>([]);
  const [revisoes, setRevisoes] = useState<Revisao[]>([]);
  const [meuId, setMeuId] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [versao, setVersao] = useState(0);
  const [edicao, setEdicao] = useState<Edicao>(null);
  const [adicionando, setAdicionando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [negando, setNegando] = useState<string | null>(null);

  const recarregar = () => setVersao((v) => v + 1);

  useEffect(() => {
    if (!idosoId) return;
    let cancelado = false;
    (async () => {
      const [{ data: ms }, rev, { data: auth }] = await Promise.all([
        supabase.from("medicacao").select(COLUNAS_REMEDIO).eq("idoso_id", idosoId).eq("ativo", true).is("deleted_at", null).order("nome"),
        carregarRevisoes(supabase, idosoId),
        supabase.auth.getUser(),
      ]);
      if (cancelado) return;
      setRemedios((ms ?? []) as unknown as Remedio[]);
      setRevisoes(rev);
      setMeuId(auth.user?.id ?? null);
      setCarregando(false);
    })();
    return () => {
      cancelado = true;
    };
  }, [supabase, idosoId, versao]);

  // Uma decisão tomada no pop-up atualiza esta tela.
  useEffect(() => {
    const atualizarTela = () => setVersao((v) => v + 1);
    window.addEventListener(EVENTO_REMEDIOS, atualizarTela);
    return () => window.removeEventListener(EVENTO_REMEDIOS, atualizarTela);
  }, []);

  function terminar(mensagem: string | null) {
    setErro(null);
    setAviso(mensagem);
    setEdicao(null);
    setAdicionando(false);
    recarregar();
  }

  async function adicionar(dados: DadosRemedio): Promise<string | null> {
    // Quem não administra tem o remédio marcado como pendente pelo próprio banco.
    const { error } = await supabase.from("medicacao").insert({ idoso_id: idosoId, ...dados });
    if (error) return "Não consegui salvar o remédio.";
    terminar(admin ? "Remédio adicionado." : "Remédio adicionado e já valendo. A família foi avisada.");
    return null;
  }

  async function salvarEdicao(r: Remedio, modo: "editar" | "confirmar" | "mudar", dados: DadosRemedio, motivo: string) {
    if (modo === "mudar") {
      const { error } = await supabase.rpc("aplicar_mudanca_medicacao", {
        p_med: r.id,
        p_tipo: "alterar",
        p_dados: dados,
        p_motivo: motivo || null,
      });
      if (error) return "Não consegui salvar a mudança.";
      terminar("Mudança feita e já valendo. A família foi avisada.");
      return null;
    }
    const { error } = await supabase
      .from("medicacao")
      .update(modo === "confirmar" ? { ...dados, confirmado: true } : dados)
      .eq("id", r.id);
    if (error) return error.message;
    terminar(modo === "confirmar" ? "Remédio corrigido e aprovado." : "Remédio atualizado.");
    return null;
  }

  async function atualizar(id: string, campos: Record<string, unknown>, mensagem: string) {
    const { error } = await supabase.from("medicacao").update(campos).eq("id", id);
    if (error) {
      setErro(error.message);
      return;
    }
    terminar(mensagem);
  }

  function suspender(r: Remedio) {
    if (!window.confirm(`Suspender ${r.nome}? Ele deixa de aparecer nas doses; o histórico fica.`)) return;
    atualizar(r.id, { ativo: false }, `${r.nome} suspenso.`);
  }

  function remover(r: Remedio) {
    const texto = r.confirmado ? `Remover ${r.nome} do cadastro? Use só se foi cadastrado por engano.` : `Apagar ${r.nome}? Use só se foi adicionado por engano.`;
    if (!window.confirm(texto)) return;
    atualizar(r.id, { deleted_at: new Date().toISOString() }, `${r.nome} removido.`);
  }

  async function suspenderComRevisao(r: Remedio) {
    const motivo = window.prompt(
      `Suspender ${r.nome}? Ele sai da lista de hoje agora, e a família vai revisar.\nPor quê? (pode deixar em branco)`,
    );
    if (motivo === null) return;
    const { error } = await supabase.rpc("aplicar_mudanca_medicacao", {
      p_med: r.id,
      p_tipo: "suspender",
      p_motivo: motivo.trim() || null,
    });
    if (error) {
      setErro("Não consegui suspender.");
      return;
    }
    terminar(`${r.nome} suspenso. A família foi avisada.`);
  }

  async function decidir(r: Revisao, aprovar: boolean) {
    const falha = await decidirRevisao(supabase, r, aprovar);
    if (falha) {
      setErro(falha);
      return;
    }
    setNegando(null);
    terminar(aprovar ? `${r.remedio.nome}: aprovado.` : `${r.remedio.nome}: negado.`);
    window.dispatchEvent(new Event(EVENTO_REMEDIOS));
  }

  if (!membership || !idosoId) {
    return <p className="text-sm text-subtle">Crie o perfil do idoso primeiro para gerenciar a medicação.</p>;
  }
  if (carregando) return <p className="text-sm text-subtle">Carregando...</p>;

  const hoje = hojeBR();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Medicação</h1>
        <p className="text-sm text-subtle">
          Marque cada dose de hoje. Não precisa ser na hora, pode preencher depois.
        </p>
      </div>

      {aviso && <p className="rounded-lg bg-primary-soft px-3 py-2 text-sm text-primary-ink" role="status">{aviso}</p>}
      {erro && <p className="text-sm text-danger" role="alert">{erro}</p>}

      <RemediosEsperando idosoId={idosoId} />

      {admin && revisoes.length > 0 && (
        <Card className="flex flex-col gap-3 border-warn/50">
          <h2 className="text-base font-semibold text-ink">Para você revisar ({revisoes.length})</h2>
          <p className="text-sm text-subtle">Tudo aqui já está valendo. Se você negar, volta a ser como antes.</p>

          {revisoes.map((rv) => (
            <div key={rv.chave} className="flex flex-col gap-2 border-t border-line pt-3">
              <p className="text-sm text-ink">
                {rv.quem} {rv.tipo === "novo" ? "adicionou" : rv.tipo === "alterar" ? "mudou" : "suspendeu"}{" "}
                <strong>{rv.remedio.nome}</strong>
                {rv.remedio.dosagem ? ` ${rv.remedio.dosagem}` : ""}
              </p>
              {rv.tipo === "alterar" ? (
                <ul className="list-disc pl-5 text-sm text-ink">
                  {rv.mudancas.map((l) => <li key={l}>{l}</li>)}
                </ul>
              ) : (
                <p className="text-sm text-subtle">
                  {[descreverAgenda(rv.remedio), rv.remedio.instrucoes].filter(Boolean).join(" · ")}
                </p>
              )}
              {rv.motivo && <p className="text-sm text-subtle">Motivo: {rv.motivo}</p>}

              {rv.tipo === "novo" && edicao?.id === rv.remedio.id && edicao.modo === "confirmar" ? (
                <FormRemedio
                  inicial={rv.remedio}
                  rotuloBotao="Salvar e aprovar"
                  onSalvar={(d, m) => salvarEdicao(rv.remedio, "confirmar", d, m)}
                  onCancelar={() => setEdicao(null)}
                />
              ) : negando === rv.chave ? (
                <div className="flex flex-col gap-2 rounded-lg border border-danger/50 p-3">
                  <p className="text-sm text-ink">{efeitoDeNegar(rv)}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button className="border-danger text-danger" onClick={() => decidir(rv, false)}>Sim, negar</Button>
                    <Button variant="ghost" onClick={() => setNegando(null)}>Voltar</Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={() => decidir(rv, true)}>Aprovar</Button>
                  {rv.tipo === "novo" && (
                    <Button onClick={() => setEdicao({ id: rv.remedio.id, modo: "confirmar" })}>Corrigir e aprovar</Button>
                  )}
                  <Button variant="ghost" onClick={() => setNegando(rv.chave)}>Negar</Button>
                </div>
              )}
            </div>
          ))}
        </Card>
      )}

      <DosesDeHoje idosoId={idosoId} versao={versao} />

      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">Remédios cadastrados</h2>
          <Button className="whitespace-nowrap" variant={adicionando ? "ghost" : "primary"} onClick={() => { setAdicionando(!adicionando); setEdicao(null); }}>
            {adicionando ? "Fechar" : "+ Adicionar remédio"}
          </Button>
        </div>

        {adicionando && (
          <div className="rounded-lg border border-line p-3">
            {!admin && (
              <p className="mb-3 text-sm text-subtle">
                O remédio vale assim que você adicionar. A família recebe um aviso e pode revisar.
              </p>
            )}
            <FormRemedio rotuloBotao="Adicionar remédio" onSalvar={adicionar} />
          </div>
        )}

        {remedios.length === 0 && !adicionando && <p className="text-sm text-subtle">Nenhum remédio ativo.</p>}

        {remedios.map((r) => {
          const meuPendente = !r.confirmado && r.autor_id === meuId;
          const emRevisao = revisoes.some((rv) => rv.pedidoId && rv.remedio.id === r.id);
          const modo = edicao?.id === r.id && edicao.modo !== "confirmar" ? edicao.modo : null;
          return (
            <div key={r.id} className="flex flex-col gap-2 border-t border-line pt-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">
                  {r.nome}
                  {r.dosagem ? <span className="font-normal text-subtle"> {r.dosagem}</span> : null}
                </p>
                <p className="text-sm text-subtle">{[descreverAgenda(r), r.instrucoes].filter(Boolean).join(" · ")}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {admin && !r.confirmado && <Badge tone="warn">para revisar</Badge>}
                  {emRevisao && admin && <Badge tone="warn">mudança para revisar</Badge>}
                  {!emUso(r, hoje) && <Badge tone="neutral">{r.fim && r.fim < hoje ? "período encerrado" : "ainda não começou"}</Badge>}
                </div>
              </div>

              {modo ? (
                <FormRemedio
                  inicial={r}
                  rotuloBotao={modo === "mudar" ? "Salvar mudança" : "Salvar"}
                  pedirMotivo={modo === "mudar"}
                  onSalvar={(d, m) => salvarEdicao(r, modo, d, m)}
                  onCancelar={() => setEdicao(null)}
                />
              ) : (
                <div className="flex flex-wrap gap-1">
                  {(admin || meuPendente) && (
                    <Button variant="ghost" onClick={() => setEdicao({ id: r.id, modo: "editar" })} className="h-9 px-2 text-xs">Editar</Button>
                  )}
                  {admin && r.confirmado && (
                    <Button variant="ghost" onClick={() => suspender(r)} className="h-9 px-2 text-xs">Suspender</Button>
                  )}
                  {(admin || meuPendente) && (
                    <Button variant="ghost" onClick={() => remover(r)} className="h-9 px-2 text-xs">
                      {meuPendente && !admin ? "Apagar (adicionei errado)" : "Remover"}
                    </Button>
                  )}
                  {!admin && !meuPendente && (
                    <>
                      <Button variant="ghost" onClick={() => setEdicao({ id: r.id, modo: "mudar" })} className="h-9 px-2 text-xs">Mudar</Button>
                      <Button variant="ghost" onClick={() => suspenderComRevisao(r)} className="h-9 px-2 text-xs">Suspender</Button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </Card>
    </div>
  );
}
