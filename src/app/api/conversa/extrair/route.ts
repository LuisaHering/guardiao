import type { NextRequest } from "next/server";
import { exigirMembro, respostaErro } from "@/lib/ai/acesso";
import { ErroIA, REGRAS_BASE } from "@/lib/ai/comum";
import { extrair } from "@/lib/ai/ia";
import { ExtracaoConversaSchema } from "@/lib/ai/schemas";
import { rotuloMotivo } from "@/lib/ingestao";
import type { DadosProposta, Proposta } from "@/lib/propostas";

export const maxDuration = 60;

const MAX_FALAS = 60;

/** Minusculas, sem acento e sem pontuacao: para comparar trecho com fala. */
function norm(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const SYSTEM = `${REGRAS_BASE}
Sua tarefa agora: ler uma conversa de cuidado e propor registros para o perfil, sempre com a fala de origem.
- Cada fala do usuário tem um rótulo (M1, M2...). Só falas de "usuário" sustentam um registro; falas do assistente nunca sustentam.
- Cada item deve citar o rótulo da fala e um trecho copiado LITERALMENTE dessa fala.
- Proponha só o que a pessoa disse de fato. Não deduza, não generalize, não complete.
- Um item por fato. Se nada foi dito sobre um assunto, deixe vazio ou null.
- "humor", "alimentacao" e "ocorrencias" descrevem o dia da conversa. Em "ocorrencias" vão fatos do dia que não são sintomas nem preferências.
- Dor ou desconforto relatados vão em "sintomas". Não dê gravidade se a pessoa não deu a medida.
- "nao_adesao": quando um remédio não foi tomado, com o motivo dito pela pessoa.`;

export async function POST(req: NextRequest) {
  try {
    const corpo = await req.json().catch(() => null);
    const { supabase, idoso } = await exigirMembro(corpo?.idosoId);
    const conversaId = corpo?.conversaId;
    if (typeof conversaId !== "string") throw new ErroIA("Conversa não informada.", 400);

    const { data: conversa } = await supabase
      .from("conversa")
      .select("id")
      .eq("id", conversaId)
      .eq("idoso_id", idoso.id)
      .maybeSingle();
    if (!conversa) throw new ErroIA("Conversa não encontrada.", 404);

    const { data: msgs } = await supabase
      .from("mensagem")
      .select("id, papel_emissor, conteudo, autor_id")
      .eq("conversa_id", conversaId)
      .order("created_at")
      .limit(MAX_FALAS);
    const falas = (msgs ?? []).filter((m) => (m.conteudo as string)?.trim());
    const doUsuario = falas.filter((m) => m.papel_emissor === "user");
    if (doUsuario.length === 0) {
      return Response.json({ propostas: [], semFalas: true });
    }

    // Rotulos curtos evitam que a IA invente ou erre um UUID.
    const rotulo = new Map<string, (typeof falas)[number]>();
    let transcricao = "";
    falas.forEach((m, i) => {
      const r = `M${i + 1}`;
      rotulo.set(r, m);
      transcricao += `[${r}] ${m.papel_emissor === "user" ? "usuário" : "assistente"}: ${m.conteudo}\n`;
    });

    if (!ExtracaoConversaSchema) {
      throw new ErroIA("O formato de extração não carregou. Reinicie o servidor (npm run dev) e tente de novo.", 500);
    }

    const bruto = await extrair({
      system: SYSTEM,
      instrucao: "Proponha os registros desta conversa.",
      entrada: { tipo: "texto", texto: transcricao },
      schema: ExtracaoConversaSchema,
      maxTokens: 4000,
      // Modelo leve: separa a cota diaria do plano gratuito da dos recursos de documentos.
      // A conferencia do trecho contra a fala (abaixo) segura erros de um modelo menor.
      modelo: process.env.GEMINI_EXTRACAO_MODEL ?? "gemini-3.5-flash-lite",
    });

    // Autores (nome de quem falou).
    const autores = [...new Set(doUsuario.map((m) => m.autor_id as string | null).filter(Boolean))] as string[];
    const { data: usuarios } = autores.length
      ? await supabase.from("usuario").select("id, nome").in("id", autores)
      : { data: [] as { id: string; nome: string | null }[] };
    const nomeDe = new Map((usuarios ?? []).map((u) => [u.id as string, (u.nome as string) ?? "Alguém da rede"]));

    // O trecho citado precisa existir na fala citada, e a fala precisa ser do usuario.
    function origem(fala: string, trecho: string) {
      const m = rotulo.get(fala.trim().toUpperCase());
      if (!m || m.papel_emissor !== "user") return null;
      const t = norm(trecho);
      if (t.length < 3 || !norm(m.conteudo as string).includes(t)) return null;
      return {
        mensagemId: m.id as string,
        autorId: (m.autor_id as string | null) ?? null,
        autorNome: m.autor_id ? nomeDe.get(m.autor_id as string) ?? "Alguém da rede" : "Alguém da rede",
        trecho: trecho.trim(),
      };
    }

    const propostas: Omit<Proposta, "id" | "jaRegistrado">[] = [];
    const add = (dados: DadosProposta, o: ReturnType<typeof origem>) => {
      if (o) propostas.push({ dados, ...o });
    };

    for (const p of bruto.preferencias) {
      add({ tipo: "preferencia", categoria: p.categoria, chave: p.chave, valor: p.valor }, origem(p.fala, p.trecho));
    }
    for (const m of bruto.memorias) {
      add({ tipo: "memoria", titulo: m.titulo, conteudo: m.conteudo }, origem(m.fala, m.trecho));
    }
    if (bruto.humor) add({ tipo: "humor", valor: bruto.humor.valor }, origem(bruto.humor.fala, bruto.humor.trecho));

    const oAli = bruto.alimentacao ? origem(bruto.alimentacao.fala, bruto.alimentacao.trecho) : null;
    const oOco = bruto.ocorrencias ? origem(bruto.ocorrencias.fala, bruto.ocorrencias.trecho) : null;
    if (oAli || oOco) {
      // Alimentacao e ocorrencias do dia formam uma entrada de diario so; a origem e a
      // primeira fala citada e o trecho mostra as duas.
      const base = (oAli ?? oOco)!;
      propostas.push({
        dados: {
          tipo: "diario",
          alimentacao: oAli ? bruto.alimentacao!.texto : null,
          ocorrencias: oOco ? bruto.ocorrencias!.texto : null,
        },
        ...base,
        trecho: [oAli?.trecho, oOco?.trecho].filter(Boolean).join(" … "),
      });
    }

    for (const s of bruto.sintomas) {
      const g = s.gravidade !== null && Number.isInteger(s.gravidade) && s.gravidade >= 1 && s.gravidade <= 5 ? s.gravidade : null;
      add({ tipo: "sintoma", descricao: s.descricao, gravidade: g }, origem(s.fala, s.trecho));
    }
    for (const n of bruto.nao_adesao) {
      add(
        {
          tipo: "pauta",
          titulo: `Não tomou ${n.medicacao}: ${rotuloMotivo(n.motivo)}`,
          detalhe: n.detalhe,
        },
        origem(n.fala, n.trecho),
      );
    }

    // Marca o que ja foi registrado a partir da mesma fala (evita registrar duas vezes).
    const ids = [...new Set(propostas.map((p) => p.mensagemId))];
    const tabelas: [DadosProposta["tipo"], string, string][] = [
      ["preferencia", "preferencia", "valor"],
      ["memoria", "memoria", "conteudo"],
      ["humor", "humor", "humor"],
      ["sintoma", "sintoma", "descricao"],
      ["pauta", "item_pauta", "titulo"],
      ["diario", "entrada_diario", "ocorrencias"],
    ];
    const existentes = new Set<string>();
    if (ids.length) {
      await Promise.all(
        tabelas.map(async ([tipo, tabela, coluna]) => {
          const cols = tipo === "diario" ? "origem_mensagem_id, ocorrencias, alimentacao" : `origem_mensagem_id, ${coluna}`;
          const { data } = await supabase.from(tabela).select(cols).in("origem_mensagem_id", ids).is("deleted_at", null);
          for (const r of (data ?? []) as unknown as Record<string, string | null>[]) {
            const texto = tipo === "diario" ? `${r.alimentacao ?? ""} ${r.ocorrencias ?? ""}` : r[coluna] ?? "";
            existentes.add(`${tipo}|${r.origem_mensagem_id}|${norm(texto)}`);
          }
        }),
      );
    }
    const chave = (p: Omit<Proposta, "id" | "jaRegistrado">) => {
      const d = p.dados;
      const texto =
        d.tipo === "preferencia" ? d.valor
        : d.tipo === "memoria" ? d.conteudo
        : d.tipo === "humor" ? d.valor
        : d.tipo === "sintoma" ? d.descricao
        : d.tipo === "pauta" ? d.titulo
        : `${d.alimentacao ?? ""} ${d.ocorrencias ?? ""}`;
      return `${d.tipo}|${p.mensagemId}|${norm(texto)}`;
    };

    return Response.json({
      propostas: propostas.map((p, i) => ({
        id: `p${i}`,
        ...p,
        jaRegistrado: existentes.has(chave(p)),
      })),
      descartadas:
        bruto.preferencias.length +
        bruto.memorias.length +
        (bruto.humor ? 1 : 0) +
        (bruto.alimentacao ? 1 : 0) +
        (bruto.ocorrencias ? 1 : 0) +
        bruto.sintomas.length +
        bruto.nao_adesao.length -
        propostas.length -
        (oAli && oOco ? 1 : 0),
    });
  } catch (e) {
    return respostaErro(e);
  }
}
