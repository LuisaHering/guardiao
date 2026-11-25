"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Badge, Button, Card } from "@/components/ui";
import { DosesDeHoje } from "@/components/doses-de-hoje";
import { FormRemedio, type DadosRemedio } from "@/components/form-remedio";
import { COLUNAS_REMEDIO, descreverAgenda, emUso, hojeBR, type Remedio } from "@/lib/medicacao";

type Pedido = {
  id: string;
  medicacao_id: string;
  tipo: "alterar" | "suspender";
  dados: Partial<DadosRemedio>;
  motivo: string | null;
  pedido_por: string;
  pedido_em: string;
};

/** Em edição: "editar" grava direto; "confirmar" grava e confirma; "pedir" vira pedido. */
type Edicao = { id: string; modo: "editar" | "confirmar" | "pedir" } | null;

/** O que o pedido mudaria, em frases, para o administrador decidir sabendo o que aprova. */
function mudancas(r: Remedio, d: Partial<DadosRemedio>): string[] {
  const linhas: string[] = [];
  const texto = (rotulo: string, antes: string | null, depois: string | null | undefined) => {
    if (depois !== undefined && (antes ?? "") !== (depois ?? "")) {
      linhas.push(`${rotulo}: ${antes || "vazio"} → ${depois || "vazio"}`);
    }
  };
  texto("Nome", r.nome, d.nome);
  texto("Dosagem", r.dosagem, d.dosagem);
  texto("Instruções", r.instrucoes, d.instrucoes);
  const antes = descreverAgenda(r);
  const depois = descreverAgenda({ ...r, ...d });
  if (antes !== depois) linhas.push(`Agenda: ${antes} → ${depois}`);
  if (d.inicio !== undefined && d.inicio !== r.inicio) linhas.push("Data de início alterada");
  return linhas;
}

export default function MedicacaoPage() {
  const supabase = createClient();
  const membership = useRole();
  const idosoId = membership?.idosoId;
  const admin = !!membership?.admin;

  const [remedios, setRemedios] = useState<Remedio[]>([]);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [meuId, setMeuId] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [versao, setVersao] = useState(0);
  const [edicao, setEdicao] = useState<Edicao>(null);
  const [adicionando, setAdicionando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const recarregar = () => setVersao((v) => v + 1);

  useEffect(() => {
    if (!idosoId) return;
    let cancelado = false;
    (async () => {
      const [{ data: ms }, { data: ps }, { data: auth }] = await Promise.all([
        supabase.from("medicacao").select(COLUNAS_REMEDIO).eq("idoso_id", idosoId).eq("ativo", true).is("deleted_at", null).order("nome"),
        supabase
          .from("medicacao_pedido")
          .select("id, medicacao_id, tipo, dados, motivo, pedido_por, pedido_em")
          .eq("idoso_id", idosoId)
          .eq("status", "pendente")
          .order("pedido_em"),
        supabase.auth.getUser(),
      ]);
      const lista = (ms ?? []) as unknown as Remedio[];
      const pend = (ps ?? []) as unknown as Pedido[];
      const ids = [...new Set([...lista.map((m) => m.autor_id), ...pend.map((p) => p.pedido_por)].filter(Boolean))] as string[];
      const { data: us } = ids.length ? await supabase.from("usuario").select("id, nome").in("id", ids) : { data: [] };
      if (cancelado) return;
      setRemedios(lista);
      setPedidos(pend);
      setNomes(Object.fromEntries((us ?? []).map((u) => [u.id as string, (u.nome as string) || "Alguém da rede"])));
      setMeuId(auth.user?.id ?? null);
      setCarregando(false);
    })();
    return () => {
      cancelado = true;
    };
  }, [supabase, idosoId, versao]);

  const quem = (id: string | null) => (id ? (id === meuId ? "você" : nomes[id] ?? "alguém da rede") : "alguém da rede");

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

  async function salvarEdicao(r: Remedio, modo: "editar" | "confirmar" | "pedir", dados: DadosRemedio, motivo: string) {
    if (modo === "pedir") {
      const { error } = await supabase.from("medicacao_pedido").insert({
        idoso_id: idosoId,
        medicacao_id: r.id,
        tipo: "alterar",
        dados,
        motivo: motivo || null,
        pedido_por: meuId,
      });
      if (error) return "Não consegui enviar o pedido.";
      terminar("Pedido enviado. O remédio continua como está até o administrador aprovar.");
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

  const confirmar = (r: Remedio) => atualizar(r.id, { confirmado: true }, `${r.nome} aprovado.`);

  function recusar(r: Remedio) {
    if (!window.confirm(`Negar ${r.nome}? Ele sai da lista. Doses já registradas continuam no histórico.`)) return;
    atualizar(r.id, { ativo: false, recusado_em: new Date().toISOString() }, `${r.nome} negado e retirado da lista.`);
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

  async function pedirSuspensao(r: Remedio) {
    const motivo = window.prompt(`Pedir para suspender ${r.nome}. Por quê? (pode deixar em branco)`);
    if (motivo === null) return;
    const { error } = await supabase.from("medicacao_pedido").insert({
      idoso_id: idosoId,
      medicacao_id: r.id,
      tipo: "suspender",
      motivo: motivo.trim() || null,
      pedido_por: meuId,
    });
    if (error) {
      setErro("Não consegui enviar o pedido.");
      return;
    }
    terminar("Pedido enviado. Continue como está até o administrador aprovar.");
  }

  async function decidir(p: Pedido, aprovar: boolean) {
    const { error } = await supabase.rpc("decidir_pedido_medicacao", { p_pedido: p.id, p_aprovar: aprovar });
    if (error) {
      setErro(error.message);
      return;
    }
    terminar(aprovar ? "Pedido aprovado." : "Pedido recusado.");
  }

  if (!membership || !idosoId) {
    return <p className="text-sm text-subtle">Crie o perfil do idoso primeiro para gerenciar a medicação.</p>;
  }
  if (carregando) return <p className="text-sm text-subtle">Carregando...</p>;

  const pendentes = remedios.filter((r) => !r.confirmado);
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

      {admin && (pendentes.length > 0 || pedidos.length > 0) && (
        <Card className="flex flex-col gap-3 border-warn/50">
          <h2 className="text-base font-semibold text-ink">Para você revisar ({pendentes.length + pedidos.length})</h2>
          {pendentes.length > 0 && (
            <p className="text-sm text-subtle">Os remédios novos já estão valendo. Se você negar, eles saem da lista.</p>
          )}

          {pendentes.map((r) => (
            <div key={r.id} className="flex flex-col gap-2 border-t border-line pt-3">
              <p className="text-sm text-ink">
                <strong>{r.nome}</strong>
                {r.dosagem ? ` ${r.dosagem}` : ""}, adicionado por {quem(r.autor_id)}
              </p>
              <p className="text-sm text-subtle">{[descreverAgenda(r), r.instrucoes].filter(Boolean).join(" · ")}</p>
              {edicao?.id === r.id && edicao.modo === "confirmar" ? (
                <FormRemedio inicial={r} rotuloBotao="Salvar e aprovar" onSalvar={(d, m) => salvarEdicao(r, "confirmar", d, m)} onCancelar={() => setEdicao(null)} />
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={() => confirmar(r)}>Aprovar</Button>
                  <Button onClick={() => setEdicao({ id: r.id, modo: "confirmar" })}>Corrigir e aprovar</Button>
                  <Button variant="ghost" onClick={() => recusar(r)}>Negar</Button>
                </div>
              )}
            </div>
          ))}

          {pedidos.map((p) => {
            const r = remedios.find((m) => m.id === p.medicacao_id);
            if (!r) return null;
            return (
              <div key={p.id} className="flex flex-col gap-2 border-t border-line pt-3">
                <p className="text-sm text-ink">
                  {quem(p.pedido_por)} pede {p.tipo === "suspender" ? "para suspender" : "uma mudança em"} <strong>{r.nome}</strong>
                </p>
                {p.motivo && <p className="text-sm text-subtle">Motivo: {p.motivo}</p>}
                {p.tipo === "alterar" && (
                  <ul className="list-disc pl-5 text-sm text-ink">
                    {mudancas(r, p.dados).map((l) => <li key={l}>{l}</li>)}
                  </ul>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={() => decidir(p, true)}>Aprovar</Button>
                  <Button variant="ghost" onClick={() => decidir(p, false)}>Recusar</Button>
                </div>
              </div>
            );
          })}
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
          const comPedido = pedidos.some((p) => p.medicacao_id === r.id);
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
                  {comPedido && <Badge tone="warn">pedido de mudança em análise</Badge>}
                  {!emUso(r, hoje) && <Badge tone="neutral">{r.fim && r.fim < hoje ? "período encerrado" : "ainda não começou"}</Badge>}
                </div>
              </div>

              {modo ? (
                <FormRemedio
                  inicial={r}
                  rotuloBotao={modo === "pedir" ? "Enviar pedido" : "Salvar"}
                  pedirMotivo={modo === "pedir"}
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
                  {!admin && !meuPendente && !comPedido && (
                    <>
                      <Button variant="ghost" onClick={() => setEdicao({ id: r.id, modo: "pedir" })} className="h-9 px-2 text-xs">Pedir mudança</Button>
                      <Button variant="ghost" onClick={() => pedirSuspensao(r)} className="h-9 px-2 text-xs">Pedir para suspender</Button>
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
