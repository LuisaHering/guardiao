"use client";

// Correção do que veio da foto de uma receita ou de um pedido de exame, com o papel ao
// lado. Cada correção é salva na hora; "Terminei" encerra a revisão.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, Field, Input } from "@/components/ui";
import { PapelDaRevisao } from "@/components/papel-da-revisao";
import { FormRemedio, type DadosRemedio } from "@/components/form-remedio";
import { RemediosEsperando } from "@/components/remedios-esperando";
import { Anotar } from "@/components/pedidos-exame";
import { COLUNAS_REMEDIO, descreverAgenda, type Remedio } from "@/lib/medicacao";
import { decidirLeitura } from "@/lib/leituras";
import { EVENTO_REMEDIOS } from "@/lib/revisoes";
import { COLUNAS_PEDIDO, EVENTO_PEDIDOS, situacao, type PedidoExame } from "@/lib/pedidos-exame";
import { EVENTO_ALERTAS } from "@/components/sino-alertas";

type Item = {
  tipo: string;
  resultado: string;
  nome: string;
  texto: string | null;
  medicacao_id?: string | null;
  pedido_id?: string | null;
};

type Leitura = { id: string; itens: Item[]; receita_id: string | null; documento_id: string; status: string };

type Med = Remedio & { recusado_em: string | null };

type Carregado = {
  caminho: string | null;
  receita: { medico: string | null; data: string | null } | null;
  meds: Med[];
  pedidosAbertos: Set<string>;
  exames: PedidoExame[];
};

const O_QUE_HOUVE: Record<string, string> = {
  entrou: "Entrou na lista",
  mudou: "Já estava na lista e mudou",
  ja_tomava: "Já tomava (não duplicou)",
};

export function CorrigirReceita({ idosoId, leitura }: { idosoId: string; leitura: Leitura }) {
  const router = useRouter();
  const [dados, setDados] = useState<Carregado | null>(null);
  const [versao, setVersao] = useState(0);
  const [editando, setEditando] = useState<string | null>(null);
  const [adicionando, setAdicionando] = useState(false);
  const [anotando, setAnotando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const itensDeRemedio = leitura.itens.filter((i) => i.tipo === "remedio" && O_QUE_HOUVE[i.resultado] && i.medicacao_id);
  const temExame = leitura.itens.some((i) => i.tipo === "exame");

  useEffect(() => {
    const atualizar = () => setVersao((v) => v + 1);
    window.addEventListener(EVENTO_PEDIDOS, atualizar);
    return () => window.removeEventListener(EVENTO_PEDIDOS, atualizar);
  }, []);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const supabase = createClient();
      const ids = leitura.itens.map((i) => i.medicacao_id).filter(Boolean) as string[];
      const pedidos = leitura.itens.map((i) => i.pedido_id).filter(Boolean) as string[];
      const [{ data: doc }, { data: receita }, { data: ms }, { data: ps }, { data: es }] = await Promise.all([
        supabase.from("documento").select("arquivo_url").eq("id", leitura.documento_id).maybeSingle(),
        leitura.receita_id
          ? supabase.from("receita").select("medico, data").eq("id", leitura.receita_id).is("deleted_at", null).maybeSingle()
          : Promise.resolve({ data: null }),
        ids.length ? supabase.from("medicacao").select(`${COLUNAS_REMEDIO}, recusado_em`).in("id", ids) : Promise.resolve({ data: [] }),
        pedidos.length
          ? supabase.from("medicacao_pedido").select("id").in("id", pedidos).eq("status", "pendente")
          : Promise.resolve({ data: [] }),
        supabase.from("pedido_exame").select(COLUNAS_PEDIDO).eq("leitura_id", leitura.id).neq("status", "cancelado"),
      ]);
      if (cancelado) return;
      setDados({
        caminho: (doc?.arquivo_url as string) ?? null,
        receita: receita as Carregado["receita"],
        meds: (ms ?? []) as unknown as Med[],
        pedidosAbertos: new Set((ps ?? []).map((p) => p.id as string)),
        exames: (es ?? []) as PedidoExame[],
      });
    })();
    return () => {
      cancelado = true;
    };
  }, [leitura, versao]);

  function salvou(mensagem: string) {
    setErro(null);
    setAviso(mensagem);
    setEditando(null);
    setAdicionando(false);
    setVersao((v) => v + 1);
    window.dispatchEvent(new Event(EVENTO_REMEDIOS));
    window.dispatchEvent(new Event(EVENTO_ALERTAS));
  }

  async function corrigirRemedio(m: Med, dadosNovos: DadosRemedio): Promise<string | null> {
    const { error } = await createClient()
      .from("medicacao")
      .update(m.confirmado ? dadosNovos : { ...dadosNovos, confirmado: true })
      .eq("id", m.id);
    if (error) return "Não consegui salvar.";
    salvou(`${dadosNovos.nome}: corrigido. Se algo mudou, quem cuida foi avisado.`);
    return null;
  }

  async function tirar(m: Med) {
    if (!window.confirm(`Tirar ${m.nome} da lista? Quem cuida é avisado.`)) return;
    const { error } = await createClient()
      .from("medicacao")
      .update(m.confirmado ? { ativo: false } : { ativo: false, recusado_em: new Date().toISOString() })
      .eq("id", m.id);
    if (error) setErro("Não consegui tirar da lista.");
    else salvou(`${m.nome} saiu da lista. Quem cuida foi avisado.`);
  }

  async function desfazer(m: Med, pedidoId: string) {
    const { error } = await createClient().rpc("decidir_pedido_medicacao", { p_pedido: pedidoId, p_aprovar: false });
    if (error) setErro("Não consegui desfazer a mudança.");
    else salvou(`A mudança em ${m.nome} foi desfeita. Quem cuida foi avisado.`);
  }

  async function adicionar(dadosNovos: DadosRemedio): Promise<string | null> {
    const { error } = await createClient()
      .from("medicacao")
      .insert({ idoso_id: idosoId, receita_id: leitura.receita_id, ...dadosNovos });
    if (error) return "Não consegui salvar o remédio.";
    salvou(`${dadosNovos.nome} entrou na lista. Quem cuida foi avisado.`);
    return null;
  }

  async function terminar() {
    setOcupado(true);
    const falha = leitura.status === "pendente" ? await decidirLeitura(createClient(), leitura.id, true) : null;
    setOcupado(false);
    if (falha) {
      setErro(falha);
      return;
    }
    window.dispatchEvent(new Event(EVENTO_REMEDIOS));
    window.dispatchEvent(new Event(EVENTO_ALERTAS));
    router.push("/painel");
  }

  if (!dados) return <p className="text-sm text-subtle">Carregando...</p>;

  return (
    <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
      <div className="lg:sticky lg:top-4">
        {dados.caminho ? <PapelDaRevisao bucket="documentos" caminho={dados.caminho} /> : <p className="text-sm text-subtle">Sem arquivo.</p>}
      </div>

      <div className="flex flex-col gap-4">
        {aviso && <p className="rounded-lg bg-primary-soft px-3 py-2 text-sm text-primary-ink" role="status">{aviso}</p>}
        {erro && <p className="text-sm text-danger" role="alert">{erro}</p>}

        {dados.receita && leitura.receita_id && (
          <MedicoEData receitaId={leitura.receita_id} inicial={dados.receita} onSalvo={() => salvou("Médico e data guardados.")} />
        )}

        {itensDeRemedio.map((item) => {
          const m = dados.meds.find((x) => x.id === item.medicacao_id);
          if (!m) return null;
          const fora = !m.ativo || !!m.recusado_em;
          return (
            <Card key={`${item.medicacao_id}-${item.resultado}`} className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-subtle">{O_QUE_HOUVE[item.resultado]}</p>
              <p className="text-base font-semibold text-ink">
                {[m.nome, m.dosagem].filter(Boolean).join(" ")}
                {fora ? " (fora da lista)" : ""}
              </p>
              <p className="text-sm text-ink">{descreverAgenda(m)}</p>
              {m.instrucoes && <p className="text-sm text-subtle">{m.instrucoes}</p>}
              {item.texto && <p className="text-sm text-subtle">A IA leu no papel: {item.texto}</p>}
              {!fora && editando === m.id ? (
                <FormRemedio inicial={m} rotuloBotao="Salvar a correção" onSalvar={(d) => corrigirRemedio(m, d)} onCancelar={() => setEditando(null)} />
              ) : (
                !fora && (
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => setEditando(m.id)}>Corrigir este remédio</Button>
                    {item.resultado === "entrou" && (
                      <Button variant="ghost" onClick={() => tirar(m)}>Tirar da lista</Button>
                    )}
                    {item.resultado === "mudou" && item.pedido_id && dados.pedidosAbertos.has(item.pedido_id) && (
                      <Button variant="ghost" onClick={() => desfazer(m, item.pedido_id as string)}>Desfazer a mudança</Button>
                    )}
                  </div>
                )
              )}
            </Card>
          );
        })}

        {/* O que não entrou: colocar na lista ou deixar de fora. */}
        <RemediosEsperando idosoId={idosoId} leituraId={leitura.id} />

        {(dados.receita || itensDeRemedio.length > 0 || leitura.itens.some((i) => i.tipo === "remedio")) &&
          (adicionando ? (
            <Card className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-ink">Remédio que faltou</h2>
              <FormRemedio rotuloBotao="Colocar na lista" onSalvar={adicionar} onCancelar={() => setAdicionando(false)} />
            </Card>
          ) : (
            <Button onClick={() => setAdicionando(true)}>+ Adicionar um remédio que faltou</Button>
          ))}

        {dados.exames.map((p) => (
          <CorrigirPedido key={`${p.id}-${p.exames.join()}-${p.preparo}`} pedido={p} onSalvo={() => salvou("Pedido de exame corrigido.")} />
        ))}
        {temExame && dados.exames.length === 0 && (
          anotando ? (
            <Anotar idosoId={idosoId} onFim={() => setAnotando(false)} />
          ) : (
            <Button onClick={() => setAnotando(true)}>+ Anotar o pedido de exame</Button>
          )
        )}

        <Button variant="primary" disabled={ocupado} onClick={terminar} className="h-12 text-base">
          {ocupado ? "Salvando..." : leitura.status === "pendente" ? "Terminei de corrigir" : "Voltar ao painel"}
        </Button>
        {leitura.status === "pendente" && (
          <p className="text-xs text-subtle">O que você não alterar fica como está, marcado como conferido.</p>
        )}
      </div>
    </div>
  );
}

function MedicoEData({
  receitaId,
  inicial,
  onSalvo,
}: {
  receitaId: string;
  inicial: { medico: string | null; data: string | null };
  onSalvo: () => void;
}) {
  const [medico, setMedico] = useState(inicial.medico ?? "");
  const [data, setData] = useState(inicial.data?.slice(0, 10) ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const mudou = medico !== (inicial.medico ?? "") || data !== (inicial.data?.slice(0, 10) ?? "");

  async function salvar() {
    const { error } = await createClient()
      .from("receita")
      .update({ medico: medico.trim() || null, data: data || null })
      .eq("id", receitaId);
    setErro(error ? "Não consegui salvar." : null);
    if (!error) onSalvo();
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Médico">
          <Input value={medico} onChange={(e) => setMedico(e.target.value)} />
        </Field>
        <Field label="Data da receita">
          <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </Field>
      </div>
      {erro && <p className="text-sm text-danger" role="alert">{erro}</p>}
      {mudou && <Button onClick={salvar} className="self-start">Salvar médico e data</Button>}
    </Card>
  );
}

function CorrigirPedido({ pedido, onSalvo }: { pedido: PedidoExame; onSalvo: () => void }) {
  const [exames, setExames] = useState(pedido.exames.join("\n"));
  const [preparo, setPreparo] = useState(pedido.preparo ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const mudou = exames !== pedido.exames.join("\n") || preparo !== (pedido.preparo ?? "");

  async function salvar() {
    const { error } = await createClient().rpc("corrigir_pedido_exame", {
      p_pedido: pedido.id,
      p_exames: exames.split("\n"),
      p_preparo: preparo,
    });
    setErro(error ? "Não consegui salvar. Escreva ao menos um exame." : null);
    if (!error) onSalvo();
  }

  return (
    <Card className="flex flex-col gap-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-subtle">Pedido de exame · {situacao(pedido).texto}</p>
      <label className="flex flex-col gap-1 text-sm text-subtle">
        Exames (um por linha)
        <textarea value={exames} onChange={(e) => setExames(e.target.value)} rows={3} className="rounded-lg border border-line bg-card p-3 text-base text-ink" />
      </label>
      <Field label="Preparo escrito no papel (vazio = confirmar com o laboratório)">
        <Input value={preparo} maxLength={1000} onChange={(e) => setPreparo(e.target.value)} />
      </Field>
      {erro && <p className="text-sm text-danger" role="alert">{erro}</p>}
      {mudou && <Button onClick={salvar} className="self-start">Salvar o pedido</Button>}
    </Card>
  );
}
