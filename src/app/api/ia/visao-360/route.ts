import type { NextRequest } from "next/server";
import { exigirMembro, respostaErro } from "@/lib/ai/acesso";
import { REGRAS_BASE } from "@/lib/ai/comum";
import { extrair } from "@/lib/ai/ia";
import { Visao360Schema } from "@/lib/ai/schemas";
import { fmt, posicaoNaFaixa, rotuloPosicao } from "@/lib/tendencia";

// A IA pode levar quase um minuto; sem isso a Vercel corta a funcao em 10 s.
export const maxDuration = 60;

// Com menos registros que isso, nao ha panorama a sintetizar: nem chamo a IA.
const MINIMO_REGISTROS = 3;

const dia = (iso: string) => iso.slice(0, 10);
const desde = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString();
const dataBr = (iso: string) => dia(iso).split("-").reverse().join("/");

const PAPEL: Record<string, string> = {
  idoso: "titular",
  familiar: "familiar",
  cuidador: "cuidador",
};

export async function POST(req: NextRequest) {
  try {
    const corpo = await req.json().catch(() => null);
    const { supabase, idoso } = await exigirMembro(corpo?.idosoId);
    const id = idoso.id;

    const [
      { data: ficha },
      { data: condicoes },
      { data: alergias },
      { data: meds },
      { data: sintomas },
      { data: diario },
      { data: humores },
      { data: consultas },
      { data: resultados },
      { data: vinculos },
      { data: alertas },
      { data: pauta },
    ] = await Promise.all([
      supabase
        .from("idoso")
        .select("nome, como_chamar, data_nascimento, tipo_sanguineo, observacoes")
        .eq("id", id)
        .single(),
      supabase.from("condicao").select("nome, desde").eq("idoso_id", id).eq("ativa", true).is("deleted_at", null),
      supabase.from("alergia").select("substancia, reacao, gravidade").eq("idoso_id", id).is("deleted_at", null),
      supabase.from("medicacao").select("id, nome, dosagem, instrucoes").eq("idoso_id", id).eq("ativo", true).is("deleted_at", null),
      supabase
        .from("sintoma")
        .select("data, descricao, gravidade, duracao_declarada, autor_id, origem")
        .eq("idoso_id", id)
        .is("deleted_at", null)
        .gte("data", desde(30))
        .order("data")
        .limit(100),
      supabase
        .from("entrada_diario")
        .select("data, alimentacao, ocorrencias, autor_id")
        .eq("idoso_id", id)
        .is("deleted_at", null)
        .gte("data", desde(14))
        .order("data")
        .limit(100),
      supabase
        .from("humor")
        .select("data, humor, autor_id")
        .eq("idoso_id", id)
        .is("deleted_at", null)
        .gte("data", desde(30))
        .order("data")
        .limit(100),
      supabase
        .from("consulta")
        .select("data, medico, especialidade, resumo")
        .eq("idoso_id", id)
        .is("deleted_at", null)
        .gte("data", desde(90))
        .order("data")
        .limit(10),
      supabase
        .from("exame_resultado")
        .select(
          "valor, unidade, ref_min, ref_max, analito:analito_id(nome_canonico, fundido_em, idoso_id), exame:exame_id(data, deleted_at)",
        )
        .limit(500),
      supabase.from("vinculo").select("usuario_id, papel").eq("idoso_id", id).is("deleted_at", null),
      supabase
        .from("alerta")
        .select("tipo, severidade, natureza, gerado_em")
        .eq("idoso_id", id)
        .gte("gerado_em", desde(30))
        .order("gerado_em", { ascending: false })
        .limit(20),
      supabase.from("item_pauta").select("id").eq("idoso_id", id).is("resolvido_em", null).is("deleted_at", null),
    ]);

    // Quem registrou o que: sem isso a IA nao consegue mostrar relatos de pessoas diferentes.
    const ids = [...new Set((vinculos ?? []).map((v) => v.usuario_id as string))];
    const { data: usuarios } = ids.length
      ? await supabase.from("usuario").select("id, nome").in("id", ids)
      : { data: [] };
    const nomePorId = new Map((usuarios ?? []).map((u) => [u.id as string, (u.nome as string) || "Sem nome"]));
    const papelPorNome = new Map<string, string>();
    for (const v of vinculos ?? []) {
      const nome = nomePorId.get(v.usuario_id as string);
      if (nome) papelPorNome.set(nome, PAPEL[v.papel as string] ?? (v.papel as string));
    }
    const quem = (autor: string | null) => {
      const nome = autor ? nomePorId.get(autor) : undefined;
      return nome ? `${nome} (${papelPorNome.get(nome)})` : "autor desconhecido";
    };

    // Adesao: contagem por remedio, sem tratar ausencia de registro como dose perdida.
    const medIds = (meds ?? []).map((m) => m.id as string);
    let registros: { data: string; medicacao_id: string; status: string; motivo: string | null }[] = [];
    if (medIds.length) {
      const { data } = await supabase
        .from("registro_medicacao")
        .select("data, medicacao_id, status, motivo")
        .in("medicacao_id", medIds)
        .is("deleted_at", null)
        .gte("data", dia(desde(14)))
        .order("data")
        .limit(300);
      registros = (data ?? []) as typeof registros;
    }

    // Exames: ultimo resultado por exame (e o anterior), com a comparacao feita aqui, por regra.
    type Res = {
      valor: number;
      unidade: string | null;
      ref_min: number | null;
      ref_max: number | null;
      analito: { nome_canonico: string; fundido_em: string | null; idoso_id: string } | null;
      exame: { data: string | null; deleted_at: string | null } | null;
    };
    const porExame = new Map<string, { data: string; r: Res }[]>();
    for (const r of (resultados ?? []) as unknown as Res[]) {
      if (!r.analito || r.analito.fundido_em || r.analito.idoso_id !== id) continue;
      if (!r.exame?.data || r.exame.deleted_at) continue;
      const lista = porExame.get(r.analito.nome_canonico) ?? [];
      lista.push({ data: r.exame.data, r });
      porExame.set(r.analito.nome_canonico, lista);
    }

    const datas = new Set<string>();
    const linhas: string[] = [];

    linhas.push("## Perfil");
    linhas.push(
      `Nome: ${ficha?.nome ?? idoso.nome}${ficha?.como_chamar ? ` (prefere ser chamado de ${ficha.como_chamar})` : ""}`,
    );
    if (ficha?.data_nascimento) linhas.push(`Nascimento: ${dataBr(ficha.data_nascimento)}`);
    if (ficha?.tipo_sanguineo) linhas.push(`Tipo sanguineo: ${ficha.tipo_sanguineo}`);
    if (ficha?.observacoes) linhas.push(`Observacoes do perfil: ${ficha.observacoes}`);
    linhas.push(`Condicoes ativas: ${(condicoes ?? []).map((c) => c.nome).join("; ") || "nenhuma registrada"}`);
    linhas.push(
      `Alergias: ${
        (alergias ?? [])
          .map((a) => `${a.substancia}${a.gravidade ? ` (${a.gravidade})` : ""}${a.reacao ? `, ${a.reacao}` : ""}`)
          .join("; ") || "nenhuma registrada"
      }`,
    );

    linhas.push("", "## Medicacao ativa");
    for (const m of meds ?? []) {
      const regs = registros.filter((r) => r.medicacao_id === m.id);
      const dadas = regs.filter((r) => r.status === "dada").length;
      const nao = regs.filter((r) => r.status === "nao_dada");
      const ultimo = regs.length ? regs[regs.length - 1].data : null;
      for (const r of regs) datas.add(r.data);
      linhas.push(
        `- ${m.nome}${m.dosagem ? ` ${m.dosagem}` : ""}${m.instrucoes ? ` | ${m.instrucoes}` : ""} | ultimos 14 dias: ${regs.length} registro(s), ${dadas} dada(s), ${nao.length} nao dada(s)${
          nao.length ? ` (motivos: ${nao.map((r) => `${r.data} ${r.motivo ?? "sem motivo"}`).join("; ")})` : ""
        }${ultimo ? ` | ultimo registro em ${ultimo}` : " | nenhum registro nos ultimos 14 dias"}`,
      );
    }
    if (!(meds ?? []).length) linhas.push("(nenhum remedio ativo)");

    linhas.push("", "## Sintomas (ultimos 30 dias, com quem registrou)");
    for (const s of sintomas ?? []) {
      datas.add(dia(s.data));
      linhas.push(
        `${dia(s.data)} | registrado por ${quem(s.autor_id)} | gravidade ${s.gravidade ?? "?"}/5 | ${s.duracao_declarada ?? "duracao nao informada"} | ${s.descricao}`,
      );
    }
    if (!(sintomas ?? []).length) linhas.push("(nenhum)");

    linhas.push("", "## Diario do cuidador (ultimos 14 dias, com quem registrou)");
    for (const d of diario ?? []) {
      datas.add(dia(d.data));
      linhas.push(
        `${dia(d.data)} | registrado por ${quem(d.autor_id)} | alimentacao: ${d.alimentacao ?? "-"} | ocorrencias: ${d.ocorrencias ?? "-"}`,
      );
    }
    if (!(diario ?? []).length) linhas.push("(nenhuma entrada)");

    linhas.push("", "## Humor (ultimos 30 dias)");
    for (const h of humores ?? []) {
      datas.add(dia(h.data));
      linhas.push(`${dia(h.data)} | registrado por ${quem(h.autor_id)} | ${h.humor}`);
    }
    if (!(humores ?? []).length) linhas.push("(nenhum registro de humor)");

    linhas.push("", "## Consultas (ultimos 90 dias)");
    for (const c of consultas ?? []) {
      if (c.data) datas.add(dia(c.data));
      linhas.push(
        `${c.data ? dia(c.data) : "sem data"} | ${[c.medico, c.especialidade].filter(Boolean).join(", ") || "consulta"} | ${c.resumo ?? "sem resumo"}`,
      );
    }
    if (!(consultas ?? []).length) linhas.push("(nenhuma)");

    linhas.push("", "## Exames (resultado mais recente de cada um; a comparacao com a faixa do laudo ja esta feita)");
    for (const [nome, lista] of porExame) {
      lista.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());
      const [ult, ant] = lista;
      datas.add(dia(ult.data));
      const situacao = rotuloPosicao({ valor: ult.r.valor, refMin: ult.r.ref_min, refMax: ult.r.ref_max });
      linhas.push(
        `${nome} | ${dia(ult.data)} | ${fmt(ult.r.valor)} ${ult.r.unidade ?? ""} | ${situacao}${
          ant ? ` | anterior: ${fmt(ant.r.valor)} em ${dia(ant.data)}` : ""
        }`,
      );
    }
    if (!porExame.size) linhas.push("(nenhum exame confirmado)");

    linhas.push("", "## Alertas dos ultimos 30 dias");
    for (const a of alertas ?? []) {
      datas.add(dia(a.gerado_em));
      linhas.push(`${dia(a.gerado_em)} | ${a.severidade ?? "-"} | ${a.natureza ?? "-"} | ${a.tipo ?? "alerta"}`);
    }
    if (!(alertas ?? []).length) linhas.push("(nenhum)");

    const base = {
      sintomas: sintomas?.length ?? 0,
      diario: diario?.length ?? 0,
      humor: humores?.length ?? 0,
      registros_medicacao: registros.length,
      consultas: consultas?.length ?? 0,
      exames: porExame.size,
    };
    const total = Object.values(base).reduce((s, n) => s + n, 0);
    const abertasPauta = pauta?.length ?? 0;

    const gerado_em = new Date().toISOString();
    if (total < MINIMO_REGISTROS) {
      return Response.json({ suficiente: false, base, pautaAbertas: abertasPauta, geradoEm: gerado_em });
    }

    const nomesPermitidos = [...papelPorNome.keys()];
    const visao = await extrair({
      system: `${REGRAS_BASE}
Voce monta a "visao 360" de uma pessoa idosa: um panorama atual, em linguagem simples, para a familia, a partir dos registros fornecidos.

Regras de honestidade:
- Descreva o que os registros mostram. Nao diagnostique, nao sugira mudar tratamento e nao diga se algo e "grave".
- RELATOS DE PESSOAS DIFERENTES COEXISTEM. Quando dois registros sobre o mesmo assunto nao coincidem (por exemplo, o titular relata um sintoma e outra pessoa nao registra nada parecido no mesmo periodo, ou duas pessoas descrevem o mesmo dia de formas diferentes), coloque isso em "divergencias", com um relato de cada lado, atribuido pelo nome de quem registrou. NAO decida quem tem razao, NAO escolha uma versao e NAO use palavras como "porem" ou "na verdade" para desmentir um dos lados.
- "Nao registrou" nao e "nao aconteceu": so afirme que algo nao ocorreu se um registro disser isso expressamente. Caso contrario, diga apenas que nao ha registro.
- Falta de registro de medicacao nao significa dose nao dada.
- Nos relatos use exatamente um destes nomes em "quem": ${nomesPermitidos.join("; ") || "(nenhum)"}.
- Use datas AAAA-MM-DD que existam nos registros.
- Se faltar informacao para algum tema, diga em "lacunas" em vez de preencher.
- O valor de exame ja vem comparado com a faixa do proprio laudo: repita essa comparacao, sem reinterpretar.`,
      instrucao: `Registros atuais:\n\n${linhas.join("\n")}\n\nMonte a visao 360.`,
      schema: Visao360Schema,
    });

    // Defesa contra relato inventado: so fica a divergencia com 2+ relatos de nomes
    // reais e datas que existem nos registros. O papel vem do servidor, nao da IA.
    const divergencias = visao.divergencias
      .map((d) => ({
        ...d,
        relatos: d.relatos
          .filter((r) => papelPorNome.has(r.quem) && (r.data === null || datas.has(r.data)))
          .map((r) => ({ ...r, papel: papelPorNome.get(r.quem) as string })),
      }))
      .filter((d) => d.relatos.length >= 2);

    const conteudo = { ...visao, divergencias, base };
    await supabase.from("visao_360").insert({
      idoso_id: id,
      conteudo: JSON.stringify(conteudo),
      gerado_em,
    });

    return Response.json({ suficiente: true, visao: conteudo, pautaAbertas: abertasPauta, geradoEm: gerado_em });
  } catch (e) {
    return respostaErro(e);
  }
}
