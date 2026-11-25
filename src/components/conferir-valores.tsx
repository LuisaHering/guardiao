"use client";

// Depois do resultado enviado, quem cuida escolhe: conferir os valores (um por tela,
// olhando o papel) ou pedir a um familiar. Só é guardado se TODOS conferirem.

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, Input } from "@/components/ui";
import { ParaQuem } from "@/components/pedidos-familia";
import { IACarregando } from "@/components/ia-carregando";
import { PapelAMao, VerPapel } from "@/components/ver-papel";
import { criarPedido, type Familiar } from "@/lib/pedidos-familia";
import { EVENTO_PEDIDOS } from "@/lib/pedidos-exame";
import { numeroDoTexto, resolver, type AnalitoConhecido, type LinhaDeResultado } from "@/lib/analitos";
import { extensaoDoArquivo, reduzirParaIA } from "@/lib/imagem";
import { NOME_PROVEDOR } from "@/lib/ai/nome-provedor";
import type { ExameExtraido } from "@/lib/ai/schemas";
import { hojeBR } from "@/lib/medicacao";

const cartao = "flex flex-col gap-3 rounded-2xl border-2 border-line bg-card p-4";

type Props = { idosoId: string; pedidoId: string; onFim: () => void };

export function QuemConfere({ idosoId, pedidoId, onFim }: Props) {
  const [escolha, setEscolha] = useState<"perguntando" | "eu" | "familiar">("perguntando");

  if (escolha === "eu") return <ConferirValores idosoId={idosoId} pedidoId={pedidoId} onFim={onFim} />;
  if (escolha === "familiar") return <PedirConferencia idosoId={idosoId} pedidoId={pedidoId} onFim={onFim} />;

  return (
    <div className={cartao}>
      <p className="text-2xl font-bold text-ink">Quem confere os valores?</p>
      <Button variant="primary" onClick={() => setEscolha("eu")} className="h-auto min-h-16 flex-col py-2 text-xl">
        Eu confiro
        <span className="text-sm font-normal">um valor por vez, olhando o papel</span>
      </Button>
      <Button onClick={() => setEscolha("familiar")} className="h-auto min-h-16 py-2 text-lg">
        Pedir para um familiar conferir
      </Button>
      <Button variant="ghost" onClick={onFim} className="h-12 text-base">Decidir depois</Button>
      <p className="text-sm text-subtle">Para você conferir, o arquivo é lido pela {NOME_PROVEDOR}.</p>
    </div>
  );
}

function PedirConferencia({ idosoId, pedidoId, detalhe, aviso, onFim }: Props & { detalhe?: string; aviso?: string }) {
  const [ocupado, setOcupado] = useState(false);
  const [para, setPara] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function pedir(f: Familiar | null) {
    setOcupado(true);
    setErro(null);
    const falha = await criarPedido(createClient(), idosoId, {
      tipo: "conferir_exame",
      detalhe,
      destinatario: f?.id ?? null,
      pedidoExame: pedidoId,
    });
    setOcupado(false);
    if (falha) setErro(falha);
    else setPara(f ? f.nome : "a família toda");
  }

  if (para) {
    return (
      <div className={cartao} role="status">
        <p className="text-2xl font-semibold text-success">✓ Pedi para {para} conferir</p>
        <p className="text-lg text-ink">Os valores aparecem depois que alguém conferir. O arquivo já dá para abrir.</p>
        <Button variant="primary" onClick={onFim} className="h-14 text-lg">Fechar</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {aviso && <p className="rounded-xl bg-warn/10 p-3 text-lg text-ink">{aviso}</p>}
      {erro && <p className="text-base text-danger" role="alert">{erro}</p>}
      <ParaQuem idosoId={idosoId} ocupado={ocupado} onEscolher={pedir} />
      <Button variant="ghost" disabled={ocupado} onClick={onFim} className="h-12 text-base">Agora não</Button>
    </div>
  );
}

type Lido = { exame: ExameExtraido; analitos: AnalitoConhecido[]; arquivo: File; linhas: LinhaDeResultado[] };

type Etapa = "lendo" | "inicio" | "cabecalho" | "valores" | "faltou" | "gravando" | "falhou" | "pronto" | "familiar";

/** Baixa o resultado enviado e pede a leitura dos valores. Nada é gravado aqui. */
async function lerResultado(idosoId: string, pedidoId: string): Promise<Lido | { erro: string }> {
  try {
    const supabase = createClient();
    const { data: p } = await supabase.from("pedido_exame").select("resultado_documento_id").eq("id", pedidoId).single();
    const { data: d } = await supabase
      .from("documento")
      .select("arquivo_url, tipo")
      .eq("id", (p?.resultado_documento_id as string) ?? "")
      .single();
    if (!d) return { erro: "Não consegui abrir o arquivo." };
    const { data: conteudo } = await supabase.storage.from("documentos").download(d.arquivo_url as string);
    if (!conteudo) return { erro: "Não consegui abrir o arquivo." };
    const extensao = (d.arquivo_url as string).split(".").pop() ?? "jpg";
    const arquivo = new File([conteudo], `resultado.${extensao}`, { type: (d.tipo as string) || conteudo.type });

    const form = new FormData();
    form.append("idosoId", idosoId);
    form.append("arquivo", await reduzirParaIA(arquivo), arquivo.type === "application/pdf" ? "exame.pdf" : "exame.jpg");
    const resp = await fetch("/api/ia/exame", { method: "POST", body: form });
    const json = await resp.json();
    if (!resp.ok) return { erro: json.erro ?? "Não consegui ler o exame." };
    const exame = json.exame as ExameExtraido;
    return {
      exame,
      analitos: json.analitos as AnalitoConhecido[],
      arquivo,
      linhas: exame.resultados.map((r) => ({
        nome: r.nome,
        valor: String(r.valor),
        unidade: r.unidade ?? "",
        refMin: r.ref_min === null ? "" : String(r.ref_min),
        refMax: r.ref_max === null ? "" : String(r.ref_max),
        analitoId: r.analito_id,
      })),
    };
  } catch {
    return { erro: "Não consegui ler o exame. Confira a internet." };
  }
}

/** Como o número está no papel (vírgula e ponto de milhar), sem conversão de unidade. */
const comoNoPapel = (texto: string) => {
  const n = numeroDoTexto(texto);
  return n === null ? "" : n.toLocaleString("pt-BR", { maximumFractionDigits: 6 });
};

function referencia(l: LinhaDeResultado): string {
  const min = comoNoPapel(l.refMin);
  const max = comoNoPapel(l.refMax);
  if (min && max) return `Referência: ${min} a ${max}`;
  if (max) return `Referência: até ${max}`;
  if (min) return `Referência: a partir de ${min}`;
  return "Sem referência";
}

const dataValida = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) ? d : "");

function ConferirValores({ idosoId, pedidoId, onFim }: Props) {
  const [etapa, setEtapa] = useState<Etapa>("lendo");
  const [lido, setLido] = useState<Lido | null>(null);
  const [indice, setIndice] = useState(0);
  const [data, setData] = useState("");
  const [motivo, setMotivo] = useState<{ aviso: string; detalhe?: string }>({ aviso: "" });
  const [erro, setErro] = useState("");
  const topo = useRef<HTMLDivElement>(null);
  // Uma leitura por arquivo: o efeito pode rodar duas vezes, e a cota gratuita é pequena.
  const pedido = useRef<ReturnType<typeof lerResultado> | null>(null);

  useEffect(() => {
    topo.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [etapa, indice]);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      pedido.current ??= lerResultado(idosoId, pedidoId);
      const r = await pedido.current;
      if (cancelado) return;
      // Se não dá para conferir direito, vai para a família: nada é guardado pela metade.
      const problema =
        "erro" in r
          ? r.erro
          : !r.exame.legivel
            ? "A leitura não teve certeza de tudo."
            : r.linhas.length === 0
              ? "Não encontrei valores neste arquivo."
              : r.linhas.some((l) => resolver(l, r.analitos).erro)
                ? "Há uma unidade que o aplicativo não sabe comparar."
                : null;
      if (problema || "erro" in r) {
        setMotivo({ aviso: `${problema} É melhor um familiar conferir.` });
        setEtapa("familiar");
        return;
      }
      setLido(r);
      setData(dataValida(r.exame.data));
      setEtapa("inicio");
    })();
    return () => {
      cancelado = true;
    };
  }, [idosoId, pedidoId]);

  function naoConferiu(oQue: string) {
    setMotivo({
      aviso: `Não guardei nenhum valor, porque ${oQue} não conferiu. Um familiar precisa conferir o exame inteiro.`,
      detalhe: `Não conferiu: ${oQue}`,
    });
    setEtapa("familiar");
  }

  async function guardar() {
    if (!lido) return;
    setEtapa("gravando");
    setErro("");
    const supabase = createClient();
    const caminho = `${idosoId}/${crypto.randomUUID()}.${extensaoDoArquivo(lido.arquivo)}`;
    const subida = await supabase.storage
      .from("exames")
      .upload(caminho, lido.arquivo, { upsert: false, contentType: lido.arquivo.type || undefined });
    const falha = subida.error
      ? subida.error
      : (
          await supabase.rpc("confirmar_valores", {
            p_pedido: pedidoId,
            p_exame: {
              tipo: lido.exame.tipo,
              laboratorio: lido.exame.laboratorio,
              data: `${data}T12:00:00-03:00`,
              arquivo: caminho,
            },
            p_resultados: lido.linhas.map((l) => {
              const r = resolver(l, lido.analitos);
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
                corrigido_manualmente: false,
              };
            }),
          })
        ).error;
    if (falha) {
      setErro("Não consegui guardar. Confira a internet e tente de novo.");
      setEtapa("falhou");
      return;
    }
    window.dispatchEvent(new Event(EVENTO_PEDIDOS));
    setEtapa("pronto");
  }

  const pedirAUmFamiliar = (
    <Button
      variant="ghost"
      onClick={() => {
        setMotivo({ aviso: "Tudo bem. Não guardei nenhum valor." });
        setEtapa("familiar");
      }}
      className="h-12 text-base"
    >
      Parar e pedir a um familiar
    </Button>
  );

  if (etapa === "familiar") {
    return <PedirConferencia idosoId={idosoId} pedidoId={pedidoId} aviso={motivo.aviso} detalhe={motivo.detalhe} onFim={onFim} />;
  }
  if (etapa === "lendo") {
    return (
      <div className={cartao} role="status">
        <IACarregando rotulo="Lendo o exame..." grande />
      </div>
    );
  }
  if (etapa === "gravando") return <p className="text-lg font-semibold text-ink" role="status">Guardando...</p>;
  if (etapa === "falhou") {
    return (
      <div className={cartao} role="alert">
        <p className="text-xl font-semibold text-danger">Ainda não foi guardado</p>
        <p className="text-base text-ink">{erro}</p>
        <Button variant="primary" onClick={guardar} className="h-14 text-lg">Tentar de novo</Button>
        {pedirAUmFamiliar}
      </div>
    );
  }
  if (!lido) return null;

  return <PapelAMao arquivo={lido.arquivo}>{telaComPapel()}</PapelAMao>;

  function telaComPapel() {
    if (!lido) return null;
    const total = lido.linhas.length;
    const quantos = `${total} ${total === 1 ? "valor" : "valores"}`;

    if (etapa === "pronto") {
      return (
        <div className={cartao} role="status">
          <p className="text-2xl font-semibold text-success">✓ Pronto</p>
          <p className="text-lg text-ink">{total === 1 ? "O valor já aparece" : `Os ${quantos} já aparecem`} em Resultados.</p>
          <p className="text-base text-subtle">A família vai conferir com o arquivo.</p>
          <Button variant="primary" onClick={onFim} className="h-14 text-lg">Fechar</Button>
        </div>
      );
    }

    if (etapa === "inicio") {
      return (
        <div ref={topo} className={`${cartao} scroll-mt-16`}>
          <p className="text-2xl font-bold text-ink">Li {quantos}.</p>
          <p className="text-lg text-ink">Tenha o papel na mão. Vou perguntar um por vez.</p>
          <VerPapel />
          <Button variant="primary" onClick={() => setEtapa("cabecalho")} className="h-16 text-xl">Começar</Button>
          {pedirAUmFamiliar}
        </div>
      );
    }

    if (etapa === "cabecalho") {
      const semData = !dataValida(lido.exame.data);
      return (
        <div ref={topo} className={`${cartao} scroll-mt-16`}>
          <div className="rounded-xl bg-panel px-3 py-4 text-center">
            <p className="text-2xl font-bold text-ink">{lido.exame.tipo || "Exame"}</p>
            <p className="text-lg text-ink">{lido.exame.laboratorio || "Não li o laboratório"}</p>
            {!semData && <p className="text-lg text-ink">Dia: {data.split("-").reverse().join("/")}</p>}
          </div>
          {semData && (
            <label className="flex flex-col gap-1 text-lg font-semibold text-ink">
              Olhe o papel. Que dia foi a coleta?
              <Input type="date" max={hojeBR()} value={data} onChange={(e) => setData(e.target.value)} className="h-14 text-lg font-normal" />
            </label>
          )}
          <p className="text-xl font-semibold text-ink">Olhe o papel. É este exame{semData ? "" : ", neste dia"}?</p>
          <VerPapel />
          <Button variant="primary" disabled={!data} onClick={() => { setIndice(0); setEtapa("valores"); }} className="h-16 text-xl">
            Sim, está igual
          </Button>
          <Button onClick={() => naoConferiu("o nome, o laboratório ou o dia do exame")} className="h-14 text-lg">Não, ou não sei</Button>
          {pedirAUmFamiliar}
        </div>
      );
    }

    if (etapa === "valores") {
      const l = lido.linhas[indice];
      return (
        <div className="flex flex-col gap-3">
          <div ref={topo} className={`${cartao} scroll-mt-16`}>
            <p className="text-base text-subtle">Valor {indice + 1} de {total}</p>
            <p className="text-2xl font-bold leading-tight text-ink">{l.nome}</p>
            <div className="rounded-xl bg-panel px-3 py-4 text-center">
              <p className="text-3xl font-bold text-ink">{comoNoPapel(l.valor)} {l.unidade}</p>
              <p className="mt-1 text-base text-subtle">{referencia(l)}</p>
            </div>
            <p className="text-xl font-semibold text-ink">Olhe o papel. Está igual?</p>
            <VerPapel />
            <Button
              variant="primary"
              onClick={() => (indice + 1 < total ? setIndice(indice + 1) : setEtapa("faltou"))}
              className="h-16 text-xl"
            >
              Sim, está igual
            </Button>
            <Button onClick={() => naoConferiu(l.nome)} className="h-14 text-lg">Não, ou não sei</Button>
          </div>
          <Button variant="ghost" onClick={() => (indice > 0 ? setIndice(indice - 1) : setEtapa("cabecalho"))} className="h-12 text-base">
            ← Voltar
          </Button>
          {pedirAUmFamiliar}
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-3">
        <div ref={topo} className={`${cartao} scroll-mt-16`}>
          <p className="text-xl font-semibold text-ink">Olhe o papel. Ficou faltando algum valor?</p>
          <p className="text-base text-subtle">Conferimos {quantos}.</p>
          <VerPapel />
          <Button variant="primary" onClick={guardar} className="h-16 text-xl">Não, apareceram todos</Button>
          <Button onClick={() => naoConferiu("a quantidade de valores (ficou faltando algum)")} className="h-14 text-lg">
            Sim, ou não sei
          </Button>
        </div>
        <Button variant="ghost" onClick={() => { setIndice(total - 1); setEtapa("valores"); }} className="h-12 text-base">← Voltar</Button>
      </div>
    );
  }
}
