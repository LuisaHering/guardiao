// Questionário das diretivas antecipadas de vontade.
//
// É código puro (sem dependências), usado pela tela, que mostra as perguntas, e
// pelo servidor, que REVALIDA as respostas contra esta mesma definição antes de
// gerar o PDF. O cliente nunca decide o que vira texto no documento.
//
// A diretiva guarda uma cópia das perguntas junto com as respostas ("itens"), então
// mudar este arquivo no futuro não altera nenhuma diretiva já gerada. A versão
// abaixo só identifica de qual questionário a pessoa partiu.

export const VERSAO_QUESTIONARIO = "2026-10-v1";

export type Opcao = { valor: string; rotulo: string };

export type Pergunta =
  | { id: string; tipo: "opcao"; rotulo: string; ajuda?: string; opcoes: Opcao[] }
  | { id: string; tipo: "texto"; rotulo: string; ajuda?: string }
  | { id: string; tipo: "pessoa"; rotulo: string; ajuda?: string };

export type Secao = {
  id: string;
  titulo: string;
  intro?: string;
  perguntas: Pergunta[];
};

export type Pessoa = { nome: string; relacao: string; telefone: string };

const DECISAO: Opcao[] = [
  { valor: "quero", rotulo: "Quero receber" },
  { valor: "nao_quero", rotulo: "Não quero receber" },
  { valor: "pessoa_confianca", rotulo: "Deixo para minha pessoa de confiança decidir" },
  { valor: "nao_sei", rotulo: "Ainda não sei" },
];

export const INTRODUCAO =
  "Estas perguntas registram o que a pessoa quer em relação ao seu cuidado, caso um dia não consiga mais se expressar. Respondam juntos, com calma, e sempre a partir do que a própria pessoa diz. Nenhuma resposta é obrigatória: dá para deixar em branco ou marcar que ainda não sabe.";

export const SECOES: Secao[] = [
  {
    id: "pessoa_confianca",
    titulo: "Quem fala por mim",
    intro:
      "Se eu não puder decidir, quero que esta pessoa converse com a equipe de saúde sobre o que eu pediria.",
    perguntas: [
      {
        id: "pessoa_confianca_1",
        tipo: "pessoa",
        rotulo: "Minha pessoa de confiança",
      },
      {
        id: "pessoa_confianca_2",
        tipo: "pessoa",
        rotulo: "Segunda pessoa de confiança (se a primeira não puder)",
      },
    ],
  },
  {
    id: "tratamentos",
    titulo: "Tratamentos em situação grave",
    intro:
      "Pense numa situação grave, sem possibilidade razoável de recuperação, em que eu não consiga me expressar. Nessa situação:",
    perguntas: [
      {
        id: "rcp",
        tipo: "opcao",
        rotulo: "Reanimação cardiopulmonar",
        ajuda: "Massagem no peito e choques elétricos se o coração parar.",
        opcoes: DECISAO,
      },
      {
        id: "respirador",
        tipo: "opcao",
        rotulo: "Respirador artificial por tempo prolongado",
        ajuda: "Aparelho que respira no lugar da pessoa, com um tubo na garganta.",
        opcoes: DECISAO,
      },
      {
        id: "alimentacao_artificial",
        tipo: "opcao",
        rotulo: "Alimentação por sonda ou pela veia",
        ajuda: "Quando a pessoa não conseguir mais se alimentar pela boca.",
        opcoes: DECISAO,
      },
      {
        id: "dialise",
        tipo: "opcao",
        rotulo: "Diálise",
        ajuda: "Quando os rins deixarem de funcionar.",
        opcoes: DECISAO,
      },
      {
        id: "uti",
        tipo: "opcao",
        rotulo: "Internação em UTI",
        opcoes: DECISAO,
      },
      {
        id: "transfusao",
        tipo: "opcao",
        rotulo: "Transfusão de sangue",
        opcoes: DECISAO,
      },
    ],
  },
  {
    id: "conforto",
    titulo: "Conforto e lugar de cuidado",
    perguntas: [
      {
        id: "foco_cuidado",
        tipo: "opcao",
        rotulo: "Se não houver mais possibilidade de cura, prefiro que o foco seja:",
        opcoes: [
          {
            valor: "conforto",
            rotulo: "Aliviar a dor e dar conforto, com menos procedimentos",
          },
          {
            valor: "prolongar",
            rotulo: "Tentar prolongar a vida o máximo possível",
          },
          {
            valor: "pessoa_confianca",
            rotulo: "Deixo para minha pessoa de confiança decidir com a equipe",
          },
          { valor: "nao_sei", rotulo: "Ainda não sei" },
        ],
      },
      {
        id: "local_cuidado",
        tipo: "opcao",
        rotulo: "Se eu estiver muito doente, prefiro ser cuidado(a):",
        opcoes: [
          { valor: "casa", rotulo: "Em casa, se for possível" },
          { valor: "hospital", rotulo: "No hospital" },
          { valor: "sem_preferencia", rotulo: "Não tenho preferência" },
          { valor: "nao_sei", rotulo: "Ainda não sei" },
        ],
      },
    ],
  },
  {
    id: "o_que_importa",
    titulo: "O que importa para mim",
    intro: "Em palavras da própria pessoa. Pode deixar em branco.",
    perguntas: [
      { id: "mais_importante", tipo: "texto", rotulo: "O que é mais importante para mim neste momento da vida?" },
      { id: "nao_gostaria", tipo: "texto", rotulo: "O que eu não gostaria que acontecesse?" },
      { id: "pessoas_perto", tipo: "texto", rotulo: "Pessoas que eu gostaria de ter por perto" },
      { id: "crencas", tipo: "texto", rotulo: "Crenças, religião ou rituais que eu gostaria que fossem respeitados" },
      { id: "mais_alguma_coisa", tipo: "texto", rotulo: "Mais alguma coisa que eu queira registrar" },
    ],
  },
];

export type Valor = string | Pessoa;
export type Respostas = Record<string, Valor | undefined>;

/** Um item pronto para guardar e imprimir: pergunta e resposta juntas, em texto. */
export type Item = {
  secao: string;
  id: string;
  pergunta: string;
  /** explicação da pergunta, para o documento ficar compreensível sozinho */
  ajuda?: string;
  tipo: Pergunta["tipo"];
  valor: Valor | null;
  /** a resposta como a pessoa leria no papel; null = não respondida */
  texto: string | null;
};

const LIMITE_TEXTO = 2000;
const LIMITE_CAMPO = 200;

export function pessoaVazia(p: Pessoa | undefined) {
  return !p || (!p.nome.trim() && !p.relacao.trim() && !p.telefone.trim());
}

function textoDaPessoa(p: Pessoa) {
  const partes = [p.nome.trim()];
  if (p.relacao.trim()) partes.push(`(${p.relacao.trim()})`);
  if (p.telefone.trim()) partes.push(`telefone ${p.telefone.trim()}`);
  return partes.join(" ");
}

/**
 * Valida as respostas contra a definição e monta os itens. Roda no servidor; o
 * cliente também usa para mostrar a revisão, mas só o resultado do servidor vale.
 */
export function montarItens(
  respostas: unknown,
): { itens: Item[]; erro: null } | { itens: null; erro: string } {
  const r = (respostas && typeof respostas === "object" ? respostas : {}) as Record<
    string,
    unknown
  >;
  const itens: Item[] = [];

  for (const secao of SECOES) {
    for (const p of secao.perguntas) {
      const bruto = r[p.id];
      let valor: Valor | null = null;
      let texto: string | null = null;

      if (p.tipo === "opcao") {
        if (typeof bruto === "string" && bruto !== "") {
          const op = p.opcoes.find((o) => o.valor === bruto);
          if (!op) return { itens: null, erro: `Resposta inválida em "${p.rotulo}".` };
          valor = op.valor;
          texto = op.rotulo;
        }
      } else if (p.tipo === "texto") {
        if (typeof bruto === "string" && bruto.trim() !== "") {
          if (bruto.length > LIMITE_TEXTO) {
            return { itens: null, erro: `Texto muito longo em "${p.rotulo}".` };
          }
          valor = bruto.trim();
          texto = valor;
        }
      } else {
        const pessoa = bruto as Partial<Pessoa> | undefined;
        if (pessoa && typeof pessoa === "object") {
          const limpa: Pessoa = {
            nome: String(pessoa.nome ?? "").trim(),
            relacao: String(pessoa.relacao ?? "").trim(),
            telefone: String(pessoa.telefone ?? "").trim(),
          };
          if (
            limpa.nome.length > LIMITE_CAMPO ||
            limpa.relacao.length > LIMITE_CAMPO ||
            limpa.telefone.length > LIMITE_CAMPO
          ) {
            return { itens: null, erro: `Texto muito longo em "${p.rotulo}".` };
          }
          if (!pessoaVazia(limpa)) {
            if (!limpa.nome) {
              return { itens: null, erro: `Informe o nome em "${p.rotulo}".` };
            }
            valor = limpa;
            texto = textoDaPessoa(limpa);
          }
        }
      }

      itens.push({
        secao: secao.titulo,
        id: p.id,
        pergunta: p.rotulo,
        ...(p.ajuda ? { ajuda: p.ajuda } : {}),
        tipo: p.tipo,
        valor,
        texto,
      });
    }
  }

  return { itens, erro: null };
}

/** Títulos e introduções das seções, guardados junto com a diretiva. */
export function secoesMeta() {
  return SECOES.map((s) => ({ titulo: s.titulo, ...(s.intro ? { intro: s.intro } : {}) }));
}

export function quantasRespondidas(itens: Item[]) {
  return itens.filter((i) => i.texto !== null).length;
}
