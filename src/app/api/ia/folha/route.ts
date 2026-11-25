import type { NextRequest } from "next/server";
import { exigirMembro, respostaErro } from "@/lib/ai/acesso";
import { REGRAS_BASE } from "@/lib/ai/comum";
import { extrair } from "@/lib/ai/ia";
import { FolhaSchema } from "@/lib/ai/schemas";
import { COLUNAS_REMEDIO, descreverAgenda, emUso, hojeBR, type Remedio } from "@/lib/medicacao";
import type { ConteudoFolha } from "@/lib/folha-cuidado/pdf";

// A IA pode levar quase um minuto; sem isso a Vercel corta a funcao em 10 s.
export const maxDuration = 60;

// Com menos que isso nao ha o que organizar numa folha.
const MINIMO_ITENS = 2;

const ROTULO_CATEGORIA: Record<string, string> = {
  comunicacao: "como gosta de ser tratado",
  agrada: "o que agrada",
  incomoda: "o que incomoda",
  rotina: "rotina",
  alimentacao: "alimentacao",
};

export async function POST(req: NextRequest) {
  try {
    const corpo = await req.json().catch(() => null);
    const { supabase, idoso } = await exigirMembro(corpo?.idosoId);
    const id = idoso.id;

    const [
      { data: ficha },
      { data: prefs },
      { data: mems },
      { data: alergias },
      { data: condicoes },
      { data: meds },
      { data: contatos },
    ] = await Promise.all([
      supabase.from("idoso").select("nome, como_chamar").eq("id", id).single(),
      supabase
        .from("preferencia")
        .select("categoria, chave, valor, autor_id")
        .eq("idoso_id", id)
        .eq("confirmado", true)
        .is("deleted_at", null),
      supabase
        .from("memoria")
        .select("titulo, conteudo, autor_id")
        .eq("idoso_id", id)
        .eq("confirmado", true)
        .is("deleted_at", null),
      supabase.from("alergia").select("substancia, reacao, gravidade").eq("idoso_id", id).is("deleted_at", null),
      supabase.from("condicao").select("nome").eq("idoso_id", id).eq("ativa", true).is("deleted_at", null),
      supabase.from("medicacao").select(COLUNAS_REMEDIO).eq("idoso_id", id).eq("ativo", true).is("deleted_at", null),
      supabase.from("contato_emergencia").select("nome, telefone, relacao").eq("idoso_id", id).is("deleted_at", null),
    ]);

    const geradoEm = new Date().toISOString();
    const totalItens = (prefs?.length ?? 0) + (mems?.length ?? 0);
    if (totalItens < MINIMO_ITENS) {
      return Response.json({ suficiente: false, geradoEm });
    }

    const autorIds = [
      ...new Set([...(prefs ?? []), ...(mems ?? [])].map((x) => x.autor_id).filter(Boolean)),
    ] as string[];
    const { data: usuarios } = autorIds.length
      ? await supabase.from("usuario").select("id, nome").in("id", autorIds)
      : { data: [] };
    const nomePorId = new Map((usuarios ?? []).map((u) => [u.id as string, u.nome as string]));
    const quem = (autor: string | null) => (autor ? nomePorId.get(autor) : undefined) ?? "alguem";

    const linhas: string[] = ["## Preferencias confirmadas"];
    for (const p of prefs ?? []) {
      linhas.push(
        `- [${ROTULO_CATEGORIA[p.categoria ?? ""] ?? p.categoria ?? "outro"}] ${p.chave}${p.valor ? `: ${p.valor}` : ""} (registrado por ${quem(p.autor_id)})`,
      );
    }
    linhas.push("", "## Historia de vida e memorias");
    for (const m of mems ?? []) {
      linhas.push(`- ${m.titulo}${m.conteudo ? `: ${m.conteudo}` : ""} (registrado por ${quem(m.autor_id)})`);
    }
    if (!(mems ?? []).length) linhas.push("(nenhuma)");

    const ia = await extrair({
      system: `${REGRAS_BASE}
Voce monta uma folha PRATICA de cuidado para quem cuida de uma pessoa idosa (cuidadora, familiar, quem cobre um turno), a partir das preferencias e memorias que a familia registrou e confirmou.
- Use SOMENTE os itens fornecidos. Nao acrescente gostos, rotinas, horarios ou cuidados que nao estejam neles. Se um tema nao tem nenhum item, nao crie a secao.
- Escreva orientacoes curtas e diretas, no imperativo ou em frases simples ("Chame de seu Luiz", "Evite barulho alto na hora de comer"). Nao escreva em primeira pessoa, porque quem registrou nem sempre foi a propria pessoa.
- Agrupe por tema. Titulos preferidos, quando houver itens: "Como chamar e conversar", "Rotina", "Alimentacao", "O que agrada", "O que incomoda", "Assuntos e historias".
- Nao inclua informacoes de saude (alergias, doencas, remedios): elas sao impressas a parte, a partir do cadastro.
- Nao de conselho medico. A "apresentacao" resume em 1 ou 2 frases como a pessoa quer ser tratada, sem inventar.`,
      instrucao: `Material:\n\n${linhas.join("\n")}\n\nMonte a folha.`,
      schema: FolhaSchema,
    });

    const conteudo: ConteudoFolha = {
      nome: ficha?.nome ?? idoso.nome,
      comoChamar: ficha?.como_chamar ?? null,
      ia,
      // Fatos de seguranca: do banco, sem passar pela IA.
      fatos: {
        alergias: (alergias ?? []) as ConteudoFolha["fatos"]["alergias"],
        condicoes: (condicoes ?? []).map((c) => c.nome as string),
        medicacoes: ((meds ?? []) as unknown as Remedio[])
          .filter((m) => emUso(m, hojeBR()))
          .map((m) => ({
            nome: m.confirmado ? m.nome : `${m.nome} (aguardando confirmação)`,
            dosagem: m.dosagem,
            instrucoes: [descreverAgenda(m), m.instrucoes].filter(Boolean).join(" · "),
          })),
        contatos: (contatos ?? []) as ConteudoFolha["fatos"]["contatos"],
      },
      fontes: [...new Set(autorIds.map((a) => nomePorId.get(a)).filter(Boolean))] as string[],
    };

    await supabase.from("folha_cuidado").insert({
      idoso_id: id,
      conteudo: JSON.stringify(conteudo),
      gerado_em: geradoEm,
    });

    return Response.json({ suficiente: true, folha: conteudo, geradoEm });
  } catch (e) {
    return respostaErro(e);
  }
}
