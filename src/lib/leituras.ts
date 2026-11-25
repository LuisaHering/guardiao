// Receita ou pedido de exame lido da foto: leitura pela IA, itens para quem enviou
// conferir, gravação e a revisão do administrador.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PapelExtraido } from "@/lib/ai/schemas";
import { extensaoDoArquivo, reduzirParaIA } from "@/lib/imagem";
import { classificarRemedio, COLUNAS_REMEDIO, descreverAgenda, type Classificacao, type Remedio } from "@/lib/medicacao";
import { descreverMudancas, EVENTO_REMEDIOS } from "@/lib/revisoes";

export type Resposta = "igual" | "diferente";

export type ItemRemedio = {
  nome: string;
  dosagem: string | null;
  /** o que está escrito no papel sobre como tomar */
  texto: string;
  classe: Classificacao;
  /** "sem_certeza": não é de todo dia e quem conferiu não quis confirmar */
  resposta: Resposta | "sem_certeza" | null;
};

export type Leitura = {
  papel: PapelExtraido;
  remedios: ItemRemedio[];
};

export const SEM_PREPARO = "Confirme o preparo com o laboratório.";

/** Pede a leitura à IA e compara com a lista atual. Nada é gravado aqui. */
export async function lerPapel(
  supabase: SupabaseClient,
  idosoId: string,
  arquivo: File,
): Promise<Leitura | { erro: string }> {
  try {
    const enviado = await reduzirParaIA(arquivo);
    const form = new FormData();
    form.append("idosoId", idosoId);
    form.append("arquivo", enviado, arquivo.type === "application/pdf" ? "papel.pdf" : "papel.jpg");
    const resp = await fetch("/api/ia/papel", { method: "POST", body: form });
    const json = await resp.json();
    if (!resp.ok) return { erro: json.erro ?? "Não consegui ler a foto." };
    const papel = json.papel as PapelExtraido;

    // Sem a lista atual não há como saber o que já é tomado: melhor não conferir.
    const { data, error } = await supabase
      .from("medicacao")
      .select(COLUNAS_REMEDIO)
      .eq("idoso_id", idosoId)
      .eq("ativo", true)
      .is("deleted_at", null);
    if (error) return { erro: "Não consegui abrir a lista de remédios." };
    const ativos = (data ?? []) as unknown as Remedio[];

    return {
      papel,
      remedios: papel.medicamentos.map((m) => ({
        nome: m.nome,
        dosagem: m.dosagem,
        texto: [m.frequencia, m.observacoes].filter(Boolean).join(" · "),
        classe: classificarRemedio(m, ativos),
        resposta: null,
      })),
    };
  } catch {
    return { erro: "Não consegui ler a foto. Confira a internet." };
  }
}

const nomeComDose = (i: ItemRemedio) => [i.nome, i.dosagem].filter(Boolean).join(" ");

/** Grava tudo de uma vez (ou nada). Devolve a mensagem de erro, ou null. */
export async function gravarConferencia(
  supabase: SupabaseClient,
  idosoId: string,
  documentoId: string,
  arquivo: File,
  leitura: Leitura,
  exames: Resposta | null,
  faltou: boolean,
): Promise<string | null> {
  // A tela de Receitas guarda o próprio documento de origem de cada remédio.
  let caminho: string | null = null;
  if (leitura.remedios.some((r) => r.classe.acao === "novo" && r.resposta === "igual")) {
    const destino = `${idosoId}/${crypto.randomUUID()}.${extensaoDoArquivo(arquivo)}`;
    const { error } = await supabase.storage
      .from("receitas")
      .upload(destino, arquivo, { upsert: false, contentType: arquivo.type || undefined });
    if (!error) caminho = destino;
  }

  const { error } = await supabase.rpc("confirmar_leitura", {
    p_documento: documentoId,
    p_dados: {
      receita: { medico: leitura.papel.medico, data: dataValida(leitura.papel.data), arquivo: caminho },
      remedios: leitura.remedios.map((i) => {
        const c: Classificacao =
          i.resposta === "sem_certeza"
            ? { acao: "duvida", alvo: null, motivo: "quem conferiu não teve certeza de que não é de todo dia" }
            : i.classe;
        const base = {
          resposta: i.resposta,
          acao: c.acao,
          nome: nomeComDose(i),
          texto: i.texto,
          medicacao_id: "alvo" in c ? c.alvo?.id ?? null : null,
        };
        if (c.acao === "novo") {
          return { ...base, novo: { nome: i.nome, dosagem: i.dosagem, instrucoes: c.instrucoes, ...c.agenda } };
        }
        if (c.acao === "mudar") return { ...base, dados: c.dados };
        if (c.acao === "duvida") return { ...base, motivo: c.motivo };
        return base;
      }),
      exames: leitura.papel.exames.length
        ? { resposta: exames, nomes: leitura.papel.exames, preparo: leitura.papel.preparo }
        : null,
      faltou: faltou || !leitura.papel.legivel,
    },
  });
  if (error) return "Não consegui guardar. Confira a internet e tente de novo.";
  window.dispatchEvent(new Event(EVENTO_REMEDIOS));
  return null;
}

/** A IA pode devolver uma data mal formada; o banco recusaria a conferência inteira. */
function dataValida(d: string | null): string | null {
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) ? d : null;
}

// ---------------------------------------------------------------------------
// Revisão do administrador
// ---------------------------------------------------------------------------

type ItemGravado = {
  tipo: "remedio" | "exame";
  resultado: "entrou" | "mudou" | "ja_tomava" | "nao_entrou" | "duvida" | "parar";
  nome: string;
  texto: string | null;
  motivo?: string | null;
  medicacao_id?: string | null;
  pedido_id?: string | null;
};

export type LinhaRevisao = { rotulo: string; texto: string; detalhe?: string; atencao?: boolean; urgente?: boolean };

export type LeituraParaRevisar = {
  chave: string;
  id: string;
  tipo: "receita" | "pedido_exame";
  quem: string;
  /** caminho no bucket "documentos" */
  arquivo: string | null;
  ehPdf: boolean;
  linhas: LinhaRevisao[];
  /** entrou um remédio que não é de todo dia: aparece primeiro e em vermelho */
  urgente: boolean;
  /** há remédio que não entrou e continua esperando em Medicação */
  temEsperando: boolean;
  /** há algo que "negar" desfaz */
  podeNegar: boolean;
  efeitoDeNegar: string;
  /** revisões de remédio que já estão dentro desta (não aparecem separadas no pop-up) */
  cobre: string[];
};

type LinhaLeitura = {
  id: string;
  documento_id: string;
  enviado_por: string;
  itens: ItemGravado[];
  faltou: boolean;
};

export async function carregarLeituras(supabase: SupabaseClient, idosoId: string): Promise<LeituraParaRevisar[]> {
  const { data } = await supabase
    .from("leitura_papel")
    .select("id, documento_id, enviado_por, itens, faltou")
    .eq("idoso_id", idosoId)
    .eq("status", "pendente")
    .order("created_at");
  const leituras = (data ?? []) as unknown as LinhaLeitura[];
  if (leituras.length === 0) return [];

  const itens = leituras.flatMap((l) => l.itens);
  const idsMed = [...new Set(itens.map((i) => i.medicacao_id).filter(Boolean))] as string[];
  const idsPedido = [...new Set(itens.map((i) => i.pedido_id).filter(Boolean))] as string[];
  const [{ data: docs }, { data: us }, { data: ms }, { data: ps }] = await Promise.all([
    supabase.from("documento").select("id, arquivo_url, tipo, envio").in("id", leituras.map((l) => l.documento_id)),
    supabase.from("usuario").select("id, nome").in("id", [...new Set(leituras.map((l) => l.enviado_por))]),
    idsMed.length
      ? supabase.from("medicacao").select(`${COLUNAS_REMEDIO}, recusado_em`).in("id", idsMed)
      : Promise.resolve({ data: [] }),
    idsPedido.length
      ? supabase.from("medicacao_pedido").select("id, status, antes").in("id", idsPedido)
      : Promise.resolve({ data: [] }),
  ]);
  type Med = Remedio & { recusado_em: string | null };
  const med = new Map(((ms ?? []) as unknown as Med[]).map((m) => [m.id, m]));
  const pedido = new Map(
    ((ps ?? []) as unknown as { id: string; status: string; antes: Partial<Remedio> | null }[]).map((p) => [p.id, p]),
  );

  const prontas = leituras.map((l): LeituraParaRevisar => {
    const doc = (docs ?? []).find((d) => d.id === l.documento_id);
    const linhas: LinhaRevisao[] = [];
    const cobre: string[] = [];
    const desfaz = new Set<string>();

    for (const i of l.itens) {
      const m = i.medicacao_id ? med.get(i.medicacao_id) : undefined;
      const noPapel = i.texto ? `No papel: ${i.texto}` : undefined;
      if (i.tipo === "exame") {
        const preparo = i.texto ? `Preparo no papel: ${i.texto}` : "O papel não fala de preparo.";
        if (i.resultado === "entrou") {
          linhas.push({ rotulo: "Pedido de exame", texto: i.nome, detalhe: preparo });
          desfaz.add("o pedido de exame é cancelado");
        } else {
          linhas.push({ rotulo: "Exame não anotado", texto: i.nome, detalhe: "Quem conferiu disse que não está igual ao papel.", atencao: true });
        }
        continue;
      }
      if (i.resultado === "entrou") {
        const revisado = !m || m.confirmado || !!m.recusado_em;
        if (m && !revisado) {
          cobre.push(`novo:${m.id}`);
          desfaz.add("o remédio novo sai da lista");
        }
        const semHorario = m && m.frequencia !== "quando_precisar" && m.horarios.length === 0;
        const naoDiario = !revisado && (m?.frequencia === "semana" || m?.frequencia === "intervalo");
        linhas.push({
          urgente: naoDiario,
          rotulo: naoDiario ? "URGENTE: não é de todo dia. Confira na foto" : revisado ? "Entrou (você já revisou)" : "Entrou na lista",
          texto: m ? `${[m.nome, m.dosagem].filter(Boolean).join(" ")} · ${descreverAgenda(m)}` : i.nome,
          detalhe: [noPapel, semHorario ? "Sem horário: defina na Medicação." : ""].filter(Boolean).join(" "),
          atencao: !!semHorario,
        });
      } else if (i.resultado === "mudou") {
        const p = i.pedido_id ? pedido.get(i.pedido_id) : undefined;
        const aberto = p?.status === "pendente";
        if (aberto) {
          cobre.push(`pedido:${p.id}`);
          desfaz.add("a mudança volta ao que era");
        }
        const mudancas = m && p?.antes ? descreverMudancas(p.antes, m).join(" · ") : "";
        linhas.push({
          rotulo: aberto ? "Mudou" : "Mudou (você já revisou)",
          texto: m ? `${m.nome}${mudancas ? `: ${mudancas}` : ""}` : i.nome,
          detalhe: noPapel,
        });
      } else if (i.resultado === "ja_tomava") {
        linhas.push({
          rotulo: "Já tomava (não duplicou)",
          texto: m ? `${[m.nome, m.dosagem].filter(Boolean).join(" ")} · ${m.instrucoes || descreverAgenda(m)}` : i.nome,
          detalhe: noPapel,
        });
      } else if (i.resultado === "parar") {
        linhas.push({ rotulo: "O papel parece mandar parar", texto: i.nome, detalhe: "Nada foi mudado. Confira a foto.", atencao: true });
      } else {
        linhas.push({
          rotulo: "NÃO entrou",
          texto: i.nome,
          detalhe: [
            i.resultado === "duvida" ? `Motivo: ${i.motivo ?? "em dúvida"}.` : "Quem conferiu disse que não está igual ao papel.",
            noPapel ?? "",
          ].join(" "),
          atencao: true,
        });
      }
    }
    if (l.faltou) {
      linhas.push({ rotulo: "Atenção", texto: "Pode haver algo no papel que não foi lido. Confira a foto.", atencao: true });
    }

    const efeitos = [...desfaz].join(", ");
    return {
      chave: `leitura:${l.id}`,
      id: l.id,
      tipo: doc?.envio === "pedido_exame" ? "pedido_exame" : "receita",
      quem: ((us ?? []).find((u) => u.id === l.enviado_por)?.nome as string) || "Alguém da rede",
      arquivo: (doc?.arquivo_url as string) ?? null,
      ehPdf: doc?.tipo === "application/pdf",
      linhas,
      urgente: linhas.some((x) => x.urgente),
      temEsperando: l.itens.some((i) => i.tipo === "remedio" && ["duvida", "nao_entrou", "parar"].includes(i.resultado)),
      podeNegar: desfaz.size > 0,
      efeitoDeNegar: efeitos ? `${efeitos.charAt(0).toUpperCase()}${efeitos.slice(1)}. Quem cuida é avisado.` : "",
      cobre,
    };
  });
  // O que é urgente vem primeiro.
  return prontas.sort((a, b) => Number(b.urgente) - Number(a.urgente));
}

export async function decidirLeitura(supabase: SupabaseClient, id: string, aceitar: boolean): Promise<string | null> {
  const { error } = await supabase.rpc("decidir_leitura", { p_leitura: id, p_aceitar: aceitar });
  return error ? error.message : null;
}

/** Remédios que entraram ou mudaram por foto e a família ainda não revisou. */
export async function remediosLidosSemRevisao(supabase: SupabaseClient, idosoId: string): Promise<Set<string>> {
  const { data } = await supabase.from("leitura_papel").select("itens").eq("idoso_id", idosoId).eq("status", "pendente");
  const ids = ((data ?? []) as { itens: ItemGravado[] }[])
    .flatMap((l) => l.itens)
    .filter((i) => i.resultado === "entrou" || i.resultado === "mudou")
    .map((i) => i.medicacao_id)
    .filter(Boolean) as string[];
  return new Set(ids);
}
