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
