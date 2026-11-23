// Tipos das propostas de registro extraidas de uma conversa (cards GRD-38 e GRD-39).
// Uma proposta so vira registro depois que uma pessoa confirma que ela e FIEL a fala;
// confirmar nao quer dizer que o conteudo e verdadeiro.

export type DadosProposta =
  | { tipo: "preferencia"; categoria: string; chave: string; valor: string }
  | { tipo: "memoria"; titulo: string; conteudo: string }
  | { tipo: "humor"; valor: string }
  | { tipo: "diario"; alimentacao: string | null; ocorrencias: string | null }
  | { tipo: "sintoma"; descricao: string; gravidade: number | null }
  | { tipo: "pauta"; titulo: string; detalhe: string | null }
  | { tipo: "medicacao"; medicacaoId: string; nome: string };

export type Proposta = {
  id: string;
  dados: DadosProposta;
  /** fala de onde saiu (FK para mensagem) */
  mensagemId: string;
  /** quem disse */
  autorId: string | null;
  autorNome: string;
  trecho: string;
  /** ja existe um registro igual vindo desta fala */
  jaRegistrado: boolean;
};

export const ROTULO_TIPO: Record<DadosProposta["tipo"], string> = {
  preferencia: "Preferência",
  memoria: "Memória",
  humor: "Humor do dia",
  diario: "Diário do dia",
  sintoma: "Sintoma",
  pauta: "Pauta médica",
  medicacao: "Remédio tomado",
};
