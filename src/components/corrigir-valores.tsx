"use client";

// Correção dos valores de um exame já salvo, com o arquivo ao lado. Não há nova leitura
// pela IA. Salvar grava uma versão nova; a anterior fica no histórico.

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, Field, Input } from "@/components/ui";
import { PapelDaRevisao } from "@/components/papel-da-revisao";
import { converter, numeroDoTexto, resolver, type AnalitoConhecido, type LinhaDeResultado } from "@/lib/analitos";
import { decidirLeitura } from "@/lib/leituras";
import { EVENTO_REMEDIOS } from "@/lib/revisoes";
import { descreverCorrecoes, type CabecalhoDeExame, type LinhaEditada } from "@/lib/correcoes";
import { hojeBR } from "@/lib/medicacao";
import { EVENTO_ALERTAS } from "@/components/sino-alertas";

type Carregado = {
  arquivo: string | null;
  analitos: AnalitoConhecido[];
  cabecalho: CabecalhoDeExame;
  linhas: LinhaEditada[];
};

type Salvo = {
  valor: number | null;
  unidade: string | null;
  ref_min: number | null;
  ref_max: number | null;
  convertido: boolean;
  valor_original: number | null;
  unidade_original: string | null;
  analito: AnalitoConhecido | null;
};

const texto = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n).replace(".", ","));

/** A linha como estava no papel: se foi convertida, volta para a unidade do laudo. */
function comoNoPapel(s: Salvo, i: number): LinhaEditada {
  const nome = s.analito?.nome_canonico ?? "";
  const voltou = s.convertido && s.unidade_original;
  const volta = (v: number | null) =>
    v === null || !voltou ? v : converter(nome, v, s.unidade ?? "", s.unidade_original as string).valor;
  return {
    chave: `salva-${i}`,
    nome,
    valor: texto(voltou ? s.valor_original : s.valor),
    unidade: (voltou ? s.unidade_original : s.unidade) ?? "",
    refMin: texto(volta(s.ref_min)),
    refMax: texto(volta(s.ref_max)),
    analitoId: s.analito?.id ?? null,
  };
}

export function CorrigirValores({ idosoId, exameId, leituraId }: { idosoId: string; exameId: string; leituraId?: string }) {
  const [dados, setDados] = useState<Carregado | null>(null);
  const [cabecalho, setCabecalho] = useState<CabecalhoDeExame>({ tipo: "", laboratorio: "", data: "" });
  const [linhas, setLinhas] = useState<LinhaEditada[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [fim, setFim] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const supabase = createClient();
      const [{ data: e }, { data: rs }, { data: as }] = await Promise.all([
        supabase.from("exame").select("tipo, laboratorio, data, arquivo_url").eq("id", exameId).is("deleted_at", null).maybeSingle(),
        supabase
          .from("exame_resultado")
          .select("valor, unidade, ref_min, ref_max, convertido, valor_original, unidade_original, analito:analito_id(id, nome_canonico, unidade_canonica)")
          .eq("exame_id", exameId),
        supabase.from("analito").select("id, nome_canonico, unidade_canonica").eq("idoso_id", idosoId).is("fundido_em", null),
      ]);
      if (cancelado) return;
      if (!e) {
        setErro("Este exame não está mais na lista.");
        return;
      }
      const cab = {
        tipo: (e.tipo as string) ?? "",
        laboratorio: (e.laboratorio as string) ?? "",
        data: ((e.data as string) ?? "").slice(0, 10),
      };
      const lidas = ((rs ?? []) as unknown as Salvo[]).map(comoNoPapel);
      setDados({ arquivo: (e.arquivo_url as string) ?? null, analitos: (as ?? []) as AnalitoConhecido[], cabecalho: cab, linhas: lidas });
      setCabecalho(cab);
      setLinhas(lidas);
    })();
    return () => {
      cancelado = true;
    };
  }, [idosoId, exameId]);

  const mudar = (chave: string, parcial: Partial<LinhaDeResultado>) =>
    setLinhas((l) =>
      l.map((x) =>
        // Trocar o nome desfaz o vínculo com o item antigo (a regra procura pelo nome novo).
        x.chave === chave ? { ...x, ...parcial, ...(parcial.nome !== undefined ? { analitoId: null } : {}) } : x,
      ),
    );

  function avisarTelas() {
    window.dispatchEvent(new Event(EVENTO_REMEDIOS));
    window.dispatchEvent(new Event(EVENTO_ALERTAS));
  }

  async function salvar() {
    if (!dados) return;
    setErro(null);
    const mudancas = descreverCorrecoes(dados.cabecalho, cabecalho, dados.linhas, linhas);
    const supabase = createClient();

    if (mudancas.length === 0) {
      setOcupado(true);
      const falha = leituraId ? await decidirLeitura(supabase, leituraId, true) : null;
      setOcupado(false);
      if (falha) setErro(falha);
      else {
        avisarTelas();
        setFim("Nada foi alterado. Ficou marcado como conferido.");
      }
      return;
    }

    if (!cabecalho.data) {
      setErro("Informe o dia da coleta.");
      return;
    }
    if (linhas.length === 0) {
      setErro("O exame precisa de ao menos um valor. Para tirar tudo, use “Remover” na tela de Exames.");
      return;
    }
    const resolvidas = linhas.map((l) => ({ l, r: resolver(l, dados.analitos) }));
    const ruim = resolvidas.find((x) => x.r.erro);
    if (ruim) {
      setErro(`${ruim.l.nome || "Linha sem nome"}: ${ruim.r.erro}`);
      return;
    }
    const originais = new Map(dados.linhas.map((l) => [l.chave, l]));

    setOcupado(true);
    const { error } = await supabase.rpc("corrigir_exame", {
      p_exame: exameId,
      p_dados: {
        tipo: cabecalho.tipo.trim(),
        laboratorio: cabecalho.laboratorio.trim(),
        data: `${cabecalho.data}T12:00:00-03:00`,
      },
      p_resultados: resolvidas.map(({ l, r }) => {
        const antes = originais.get(l.chave);
        return {
          analito_id: r.alvo?.id ?? null,
          nome: l.nome.trim(),
          valor: r.valorFinal,
          unidade: r.unidadeFinal || null,
          valor_original: r.convertido ? numeroDoTexto(l.valor) : null,
          unidade_original: r.convertido ? l.unidade.trim() : null,
          convertido: r.convertido,
          ref_min: r.refMinFinal,
          ref_max: r.refMaxFinal,
          corrigido_manualmente: !antes || descreverCorrecoes(dados.cabecalho, dados.cabecalho, [antes], [l]).length > 0,
        };
      }),
      p_mudancas: mudancas.join("; "),
    });
    setOcupado(false);
    if (error) {
      setErro("Não consegui salvar a correção. Confira a internet e tente de novo.");
      return;
    }
    avisarTelas();
    setFim("Valores corrigidos. Quem cuida foi avisado do que mudou.");
  }

  if (fim) {
    return (
      <Card className="flex flex-col gap-3" role="status">
        <p className="text-lg font-semibold text-success">✓ {fim}</p>
        <div className="flex flex-wrap gap-3">
          <Link href="/painel" className="text-sm text-primary hover:underline">Voltar ao painel</Link>
          <Link href="/exames" className="text-sm text-primary hover:underline">Ver os exames</Link>
        </div>
      </Card>
    );
  }
  if (!dados) {
    return <p className={erro ? "text-sm text-danger" : "text-sm text-subtle"}>{erro ?? "Carregando..."}</p>;
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
      <div className="lg:sticky lg:top-4">
        {dados.arquivo ? (
          <PapelDaRevisao bucket="exames" caminho={dados.arquivo} />
        ) : (
          <p className="text-sm text-subtle">Este exame não tem arquivo.</p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <Card className="grid gap-3 sm:grid-cols-3">
          <Field label="Exame">
            <Input value={cabecalho.tipo} onChange={(e) => setCabecalho({ ...cabecalho, tipo: e.target.value })} />
          </Field>
          <Field label="Laboratório">
            <Input value={cabecalho.laboratorio} onChange={(e) => setCabecalho({ ...cabecalho, laboratorio: e.target.value })} />
          </Field>
          <Field label="Dia da coleta">
            <Input type="date" max={hojeBR()} value={cabecalho.data} onChange={(e) => setCabecalho({ ...cabecalho, data: e.target.value })} />
          </Field>
        </Card>

        {linhas.map((l) => (
          <Card key={l.chave} className="flex flex-col gap-2">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Field label="Item">
                  <Input value={l.nome} onChange={(e) => mudar(l.chave, { nome: e.target.value })} />
                </Field>
              </div>
              <Button variant="ghost" onClick={() => setLinhas((x) => x.filter((y) => y.chave !== l.chave))} aria-label={`Tirar ${l.nome || "linha"}`}>
                Tirar
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Field label="Valor">
                <Input inputMode="decimal" value={l.valor} onChange={(e) => mudar(l.chave, { valor: e.target.value })} />
              </Field>
              <Field label="Unidade">
                <Input value={l.unidade} onChange={(e) => mudar(l.chave, { unidade: e.target.value })} />
              </Field>
              <Field label="Ref. de">
                <Input inputMode="decimal" value={l.refMin} onChange={(e) => mudar(l.chave, { refMin: e.target.value })} />
              </Field>
              <Field label="Ref. até">
                <Input inputMode="decimal" value={l.refMax} onChange={(e) => mudar(l.chave, { refMax: e.target.value })} />
              </Field>
            </div>
          </Card>
        ))}

        <Button
          onClick={() =>
            setLinhas((x) => [...x, { chave: crypto.randomUUID(), nome: "", valor: "", unidade: "", refMin: "", refMax: "", analitoId: null }])
          }
        >
          + Adicionar um valor que faltou
        </Button>
        <p className="text-xs text-subtle">Use o número como está no papel. Escreva sem o ponto de milhar (5400, e não 5.400).</p>
        {erro && <p className="text-sm text-danger" role="alert">{erro}</p>}
        <Button variant="primary" disabled={ocupado} onClick={salvar} className="h-12 text-base">
          {ocupado ? "Salvando..." : "Salvar a correção"}
        </Button>
        <Link href="/painel" className="text-center text-sm text-subtle hover:underline">Voltar sem salvar</Link>
      </div>
    </div>
  );
}
