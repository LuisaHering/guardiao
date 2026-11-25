import type { NextRequest } from "next/server";
import { exigirMembro, respostaErro } from "@/lib/ai/acesso";
import { ErroIA, REGRAS_BASE } from "@/lib/ai/comum";
import { extrair } from "@/lib/ai/ia";
import { ExtracaoConversaSchema } from "@/lib/ai/schemas";
import { rotuloMotivo } from "@/lib/ingestao";
import {
  COLUNAS_DOSE,
  COLUNAS_REMEDIO,
  doseParaRegistrar,
  dosesDoDia,
  horaBR,
  type RegistroDose,
  type Remedio,
} from "@/lib/medicacao";
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
- "humor", "alimentacao", "sono" e "ocorrencias" descrevem o dia da conversa. "sono" é como dormiu (ex: "dormiu bem"). "ocorrencias" é só o que não cabe nos outros campos (quedas, visitas, fatos do dia) e não deve repetir sono, comida ou humor.
- "sintomas_resolvidos": quando a pessoa disser que um sintoma que está na lista de SINTOMAS EM ABERTO passou ou melhorou por completo, cite o rótulo dele (S1, S2...). Só se a fala disser claramente que passou.
- "medicacao_tomada": remédio que a pessoa disse que FOI tomado hoje. Use o nome como foi dito.
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

    // Remedios ativos e as doses ja registradas hoje, para casar o que foi dito com a dose certa.
    const { data: medsData } = await supabase
      .from("medicacao")
      .select(COLUNAS_REMEDIO)
      .eq("idoso_id", idoso.id)
      .eq("ativo", true)
      .is("deleted_at", null);
    const meds = (medsData ?? []) as unknown as Remedio[];
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    const medIds = meds.map((m) => m.id);
    const { data: regsData } = medIds.length
      ? await supabase
          .from("registro_medicacao")
          .select(COLUNAS_DOSE)
          .in("medicacao_id", medIds)
          .eq("data", hoje)
          .is("deleted_at", null)
      : { data: [] };
    const regsHoje = (regsData ?? []) as unknown as RegistroDose[];
    // Remedios cuja proposta nao tem dose pendente: vem desmarcada, para nao registrar em dobro.
    const semDosePendente = new Set<string>();

    // Sintomas ainda em aberto, para a IA poder dizer qual deles passou.
    const { data: abertos } = await supabase
      .from("sintoma")
      .select("id, descricao, data")
      .eq("idoso_id", idoso.id)
      .is("resolvido_em", null)
      .is("deleted_at", null)
      .gte("data", new Date(Date.now() - 30 * 86_400_000).toISOString())
      .order("data", { ascending: false })
      .limit(15);
    const sintomaPorRotulo = new Map<string, { id: string; descricao: string }>();
    let blocoSintomas = "";
    (abertos ?? []).forEach((s, i) => {
      const r = `S${i + 1}`;
      sintomaPorRotulo.set(r, { id: s.id as string, descricao: s.descricao as string });
      blocoSintomas += `[${r}] ${s.descricao} (registrado em ${(s.data as string).slice(0, 10).split("-").reverse().join("/")})\n`;
    });

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

    const chamar = (modelo?: string) =>
      extrair({
        system: SYSTEM,
        instrucao: "Proponha os registros desta conversa.",
        entrada: {
          tipo: "texto",
          texto: `${blocoSintomas ? `SINTOMAS EM ABERTO:\n${blocoSintomas}\n` : "SINTOMAS EM ABERTO: nenhum\n\n"}CONVERSA:\n${transcricao}`,
        },
        schema: ExtracaoConversaSchema,
        maxTokens: 4000,
        modelo,
      });
    // Primeiro o modelo forte (padrao do provedor). Se a cota gratuita dele acabou ou ele
    // esta sobrecarregado, cai para o leve, que tem cota propria. A conferencia do trecho
    // contra a fala (abaixo) segura os erros de um modelo menor.
    let bruto;
    try {
      bruto = await chamar();
    } catch (e) {
      if (e instanceof ErroIA && (e.status === 429 || e.status === 503)) {
        bruto = await chamar(process.env.GEMINI_EXTRACAO_MODEL ?? "gemini-3.5-flash-lite");
      } else {
        throw e;
      }
    }

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
    const oSono = bruto.sono ? origem(bruto.sono.fala, bruto.sono.trecho) : null;
    const oOco = bruto.ocorrencias ? origem(bruto.ocorrencias.fala, bruto.ocorrencias.trecho) : null;
    const partesDiario = [oAli, oSono, oOco].filter(Boolean).length;
    if (partesDiario > 0) {
      // Alimentacao, sono e ocorrencias do dia formam uma entrada de diario so; a origem e a
      // primeira fala citada e o trecho mostra todas.
      const base = (oAli ?? oSono ?? oOco)!;
      propostas.push({
        dados: {
          tipo: "diario",
          alimentacao: oAli ? bruto.alimentacao!.texto : null,
          sono: oSono ? bruto.sono!.texto : null,
          ocorrencias: oOco ? bruto.ocorrencias!.texto : null,
        },
        ...base,
        trecho: [oAli?.trecho, oSono?.trecho, oOco?.trecho].filter(Boolean).join(" … "),
      });
    }

    for (const r of bruto.sintomas_resolvidos) {
      const alvo = sintomaPorRotulo.get(r.sintoma.trim().toUpperCase());
      if (!alvo) continue;
      add({ tipo: "sintoma_resolvido", sintomaId: alvo.id, descricao: alvo.descricao }, origem(r.fala, r.trecho));
    }

    for (const s of bruto.sintomas) {
      const g = s.gravidade !== null && Number.isInteger(s.gravidade) && s.gravidade >= 1 && s.gravidade <= 5 ? s.gravidade : null;
      add({ tipo: "sintoma", descricao: s.descricao, gravidade: g }, origem(s.fala, s.trecho));
    }
    const semAcento = (t: string) => norm(t);
    for (const t of bruto.medicacao_tomada) {
      const dito = semAcento(t.medicacao);
      const achados = meds.filter((m) => {
        const nome = semAcento(m.nome);
        return dito.length >= 3 && (nome.includes(dito) || dito.includes(nome));
      });
      // So propoe quando o nome bate com UM remedio do cadastro; senao, nao arrisco registrar o errado.
      if (achados.length !== 1) continue;
      const med = achados[0];
      const hora = horaBR();
      const doses = dosesDoDia([med], regsHoje, hoje);
      let horario = hora;
      if (doses.length) {
        const alvo = doseParaRegistrar(doses, hora);
        if (!alvo) semDosePendente.add(med.id);
        horario = alvo ? alvo.horario : doses[doses.length - 1].horario;
      } else if (regsHoje.some((r) => r.medicacao_id === med.id)) {
        // "So quando precisar" ja registrado hoje: so entra de novo se a pessoa marcar.
        semDosePendente.add(med.id);
      }
      add({ tipo: "medicacao", medicacaoId: med.id, nome: med.nome, horario }, origem(t.fala, t.trecho));
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
          const cols = tipo === "diario" ? "origem_mensagem_id, ocorrencias, alimentacao, sono" : `origem_mensagem_id, ${coluna}`;
          const { data } = await supabase.from(tabela).select(cols).in("origem_mensagem_id", ids).is("deleted_at", null);
          for (const r of (data ?? []) as unknown as Record<string, string | null>[]) {
            const texto = tipo === "diario" ? `${r.alimentacao ?? ""} ${r.sono ?? ""} ${r.ocorrencias ?? ""}` : r[coluna] ?? "";
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
        : d.tipo === "medicacao" ? d.medicacaoId
        : d.tipo === "sintoma_resolvido" ? d.sintomaId
        : `${d.alimentacao ?? ""} ${d.sono ?? ""} ${d.ocorrencias ?? ""}`;
      return `${d.tipo}|${p.mensagemId}|${norm(texto)}`;
    };

    return Response.json({
      propostas: propostas.map((p, i) => ({
        id: `p${i}`,
        ...p,
        jaRegistrado:
          existentes.has(chave(p)) ||
          (p.dados.tipo === "medicacao" && semDosePendente.has(p.dados.medicacaoId)),
      })),
      descartadas:
        bruto.preferencias.length +
        bruto.memorias.length +
        (bruto.humor ? 1 : 0) +
        (bruto.alimentacao ? 1 : 0) +
        (bruto.sono ? 1 : 0) +
        (bruto.ocorrencias ? 1 : 0) +
        bruto.sintomas_resolvidos.length +
        bruto.sintomas.length +
        bruto.medicacao_tomada.length +
        bruto.nao_adesao.length -
        propostas.length -
        (partesDiario > 1 ? partesDiario - 1 : 0),
    });
  } catch (e) {
    return respostaErro(e);
  }
}
