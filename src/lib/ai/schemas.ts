// Formatos de saida da IA. O SDK converte estes schemas em JSON Schema e
// garante que a resposta bate com eles.

import { z } from "zod";

export const ResumoConsultaSchema = z.object({
  resumo: z.string().describe("Resumo fiel da consulta em 3 a 6 frases."),
  acoes: z
    .array(z.string())
    .describe("O que a familia ou o cuidador precisa fazer depois da consulta."),
  remedios: z.array(
    z.object({
      nome: z.string(),
      dosagem: z.string().nullable(),
      mudanca: z.enum(["iniciar", "suspender", "ajustar", "manter", "mencionado"]),
      detalhe: z.string().nullable(),
    }),
  ),
  exames: z.array(
    z.object({
      nome: z.string(),
      motivo: z.string().nullable(),
    }),
  ),
  duvidas: z
    .array(z.string())
    .describe("Pontos que ficaram em aberto ou nao ficaram claros no que foi dito."),
  retorno: z.string().nullable().describe("Quando o medico pediu retorno, se disse."),
});
export type ResumoConsulta = z.infer<typeof ResumoConsultaSchema>;

export const ReceitaSchema = z.object({
  legivel: z
    .boolean()
    .describe("false se a imagem esta ilegivel demais para extrair com seguranca."),
  medico: z.string().nullable(),
  data: z.string().nullable().describe("Data da receita no formato AAAA-MM-DD."),
  medicamentos: z.array(
    z.object({
      nome: z.string(),
      dosagem: z.string().nullable(),
      frequencia: z.string().nullable(),
      observacoes: z.string().nullable(),
    }),
  ),
});
export type ReceitaExtraida = z.infer<typeof ReceitaSchema>;

export const ExameSchema = z.object({
  legivel: z.boolean(),
  tipo: z.string().nullable().describe("Tipo do exame, ex: hemograma, perfil lipidico."),
  laboratorio: z.string().nullable(),
  data: z.string().nullable().describe("Data da coleta no formato AAAA-MM-DD."),
  resultados: z.array(
    z.object({
      nome: z.string().describe("Nome do analito como esta impresso no documento."),
      analito_id: z
        .string()
        .nullable()
        .describe("ID do analito da lista conhecida quando for o mesmo; null se for novo."),
      valor: z.number(),
      unidade: z.string().nullable(),
      ref_min: z.number().nullable(),
      ref_max: z.number().nullable(),
    }),
  ),
});
export type ExameExtraido = z.infer<typeof ExameSchema>;

export const InsightsSchema = z.object({
  suficiente: z
    .boolean()
    .describe("false quando ha poucos registros para observar qualquer padrao."),
  itens: z.array(
    z.object({
      titulo: z.string(),
      observacao: z.string(),
      evidencias: z
        .array(z.string())
        .describe("Datas e registros concretos que sustentam a observacao."),
      confianca: z.enum(["baixa", "media", "alta"]),
    }),
  ),
});
export type InsightsGerados = z.infer<typeof InsightsSchema>;

export const Visao360Schema = z.object({
  resumo: z
    .string()
    .describe("Panorama atual da pessoa em 3 a 5 frases, só com o que os registros mostram."),
  saude: z.array(
    z.object({
      titulo: z.string(),
      detalhe: z.string(),
      fonte: z.enum([
        "condicao",
        "alergia",
        "sintoma",
        "exame",
        "consulta",
        "diario",
        "medicacao",
        "humor",
      ]),
      data: z.string().nullable().describe("Data AAAA-MM-DD do registro, se houver."),
    }),
  ),
  medicacao: z.object({
    situacao: z
      .string()
      .describe("Como estão os registros de medicação, sem tratar falta de registro como dose perdida."),
    pontos: z.array(z.string()),
  }),
  humor: z
    .string()
    .nullable()
    .describe("O que os registros de humor mostram; null se não há registros de humor."),
  divergencias: z.array(
    z.object({
      tema: z.string(),
      relatos: z.array(
        z.object({
          quem: z.string().describe("Nome exato de quem registrou, como na lista fornecida."),
          relato: z.string(),
          data: z.string().nullable().describe("Data AAAA-MM-DD do registro."),
        }),
      ),
      observacao: z
        .string()
        .describe("Descrição neutra da diferença, sem dizer quem tem razão."),
    }),
  ),
  lacunas: z
    .array(z.string())
    .describe("O que não dá para saber por falta de registros."),
});
export type Visao360Gerada = z.infer<typeof Visao360Schema>;

export const FolhaSchema = z.object({
  apresentacao: z
    .string()
    .describe("Uma ou duas frases práticas sobre como a pessoa quer ser tratada, só com o que está nos registros."),
  secoes: z.array(
    z.object({
      titulo: z.string(),
      itens: z
        .array(z.string())
        .describe("Orientações curtas e práticas, no imperativo ou em frases diretas."),
    }),
  ),
});
export type FolhaGerada = z.infer<typeof FolhaSchema>;

// Extracao de uma conversa. Cada item cita a fala de onde saiu (rotulo M1, M2...) e o
// trecho exato; o servidor confere o trecho contra a fala e descarta o que nao bater.
const Citacao = {
  fala: z.string().describe("Rótulo da fala do usuário de onde saiu (ex: M3)."),
  trecho: z.string().describe("Trecho copiado literalmente dessa fala que sustenta o item."),
};

export const ExtracaoConversaSchema = z.object({
  preferencias: z.array(
    z.object({
      categoria: z.enum(["comunicacao", "agrada", "incomoda", "rotina", "alimentacao"]),
      chave: z.string().describe("Rótulo curto, ex: Café da manhã."),
      valor: z.string(),
      ...Citacao,
    }),
  ),
  memorias: z.array(
    z.object({
      titulo: z.string(),
      conteudo: z.string(),
      ...Citacao,
    }),
  ),
  humor: z.object({ valor: z.string(), ...Citacao }).nullable(),
  alimentacao: z.object({ texto: z.string(), ...Citacao }).nullable(),
  sono: z.object({ texto: z.string(), ...Citacao }).nullable(),
  ocorrencias: z.object({ texto: z.string(), ...Citacao }).nullable(),
  sintomas: z.array(
    z.object({
      descricao: z.string(),
      gravidade: z.number().nullable().describe("1 a 5, só se a pessoa der a medida; senão null."),
      ...Citacao,
    }),
  ),
  sintomas_resolvidos: z.array(
    z.object({
      sintoma: z.string().describe("Rótulo do sintoma em aberto que passou (ex: S2)."),
      ...Citacao,
    }),
  ),
  medicacao_tomada: z.array(
    z.object({
      medicacao: z.string().describe("Nome do remédio como dito pela pessoa."),
      ...Citacao,
    }),
  ),
  nao_adesao: z.array(
    z.object({
      medicacao: z.string(),
      motivo: z.enum(["esqueceu", "recusou", "efeito_adverso", "acabou", "outro"]),
      detalhe: z.string().nullable(),
      ...Citacao,
    }),
  ),
});
export type ExtracaoConversa = z.infer<typeof ExtracaoConversaSchema>;
