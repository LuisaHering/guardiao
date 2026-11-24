// Conteúdo do onboarding, por papel. Linguagem simples, frases curtas, sem jargão.
// Os textos evitam marcar gênero ("Boas-vindas") porque o cadastro nem sempre o informa.

import type { Role } from "@/lib/roles";

export type Icone =
  | "escudo"
  | "pessoas"
  | "prancheta"
  | "brilho"
  | "sino"
  | "conversa"
  | "coracao"
  | "pessoa"
  | "cadeado";

export type Slide = {
  icone: Icone;
  titulo: string;
  /** {nome} vira o nome curto da pessoa cuidada */
  texto: string;
};

export type Passo = {
  id: string;
  titulo: string;
  dica: string;
  href: string;
};

type Conteudo = {
  /** fonte maior, para quem tem menos facilidade com tela */
  grande: boolean;
  slides: Slide[];
  passos: Passo[];
};

const familiarAdmin: Conteudo = {
  grande: false,
  slides: [
    {
      icone: "escudo",
      titulo: "Boas-vindas ao Guardião",
      texto:
        "Aqui você acompanha o cuidado de {nome} num só lugar, mesmo de longe. A ideia é simples: quem cuida registra o dia a dia, e você enxerga tudo organizado.",
    },
    {
      icone: "pessoas",
      titulo: "Cada pessoa tem o seu papel",
      texto:
        "Quem cuida registra remédio, diário e sintomas. Você vê o painel, os alertas e a linha do tempo, e convida quem ajuda a cuidar. A própria pessoa cuidada também pode ter o seu espaço.",
    },
    {
      icone: "brilho",
      titulo: "A IA ajuda, você decide",
      texto:
        "Ela resume consultas, lê exames e receitas e conversa para entender como foi o dia. Mas nunca decide nada: tudo o que ela sugere passa pela sua confirmação, e ela não faz diagnóstico.",
    },
    {
      icone: "prancheta",
      titulo: "Vamos começar?",
      texto:
        "No painel, o cartão Primeiros passos mostra o que fazer antes: completar o perfil, convidar quem ajuda e fazer o primeiro check-in. Leva poucos minutos.",
    },
  ],
  passos: [
    { id: "perfil", titulo: "Complete o perfil de {nome}", dica: "Condições, alergias e contatos de emergência.", href: "/perfil" },
    { id: "rede", titulo: "Convide quem ajuda a cuidar", dica: "Cuidadores e outros familiares, por link.", href: "/rede" },
    { id: "medicacao", titulo: "Cadastre os remédios", dica: "Assim dá para acompanhar a adesão dia a dia.", href: "/medicacao" },
    { id: "checkin", titulo: "Faça o primeiro check-in", dica: "Uma conversa curta sobre como foi o dia.", href: "/conversa" },
    { id: "preferencias", titulo: "Conte como {nome} gosta de ser tratado", dica: "Preferências e história de vida.", href: "/identidade" },
  ],
};

const familiar: Conteudo = {
  grande: false,
  slides: [
    {
      icone: "escudo",
      titulo: "Boas-vindas ao Guardião",
      texto:
        "Aqui você acompanha o cuidado de {nome} num só lugar, mesmo de longe. Quem cuida registra o dia a dia, e você enxerga tudo organizado.",
    },
    {
      icone: "pessoas",
      titulo: "Você acompanha de perto",
      texto:
        "O painel mostra o que importa hoje: remédios, alertas e os últimos registros. A linha do tempo guarda tudo em ordem, e você também pode registrar o que viu.",
    },
    {
      icone: "brilho",
      titulo: "A IA ajuda, você decide",
      texto:
        "Ela organiza o que foi registrado e conversa para entender o dia. Nada vira registro sem a sua confirmação, e ela não faz diagnóstico.",
    },
  ],
  passos: [
    { id: "checkin", titulo: "Faça um check-in", dica: "Uma conversa curta sobre como foi o dia.", href: "/conversa" },
    { id: "registro", titulo: "Registre algo do dia", dica: "Uma entrada no diário ou um sintoma.", href: "/diario" },
    { id: "preferencias", titulo: "Conte como {nome} gosta de ser tratado", dica: "Preferências e história de vida.", href: "/identidade" },
  ],
};

const cuidador: Conteudo = {
  grande: false,
  slides: [
    {
      icone: "coracao",
      titulo: "Boas-vindas! O seu papel é o dia a dia",
      texto:
        "Você é quem está perto. No Guardião, você registra o que aconteceu com {nome}, para a família acompanhar com tranquilidade.",
    },
    {
      icone: "prancheta",
      titulo: "Leva poucos minutos por dia",
      texto:
        "Marque o remédio que foi dado (não precisa ser na hora, pode preencher depois), escreva como foi o dia e, se quiser, ponha uma foto. Se algo preocupar, registre o sintoma.",
    },
    {
      icone: "sino",
      titulo: "Avisos que ajudam",
      texto:
        "Se faltar registro, o Guardião avisa com jeitinho. Você vê só o que ajuda no dia a dia: exames e análises ficam com a família, e isso é de propósito.",
    },
    {
      icone: "conversa",
      titulo: "Também dá para conversar",
      texto:
        "Em Conversa e check-in, o Guardião puxa uma conversa curta sobre o dia. Você só conta, e ele organiza. Nada é registrado sem a sua confirmação.",
    },
  ],
  passos: [
    { id: "medicacao", titulo: "Marque a medicação de hoje", dica: "O que foi dado, e o que não foi.", href: "/medicacao" },
    { id: "diario", titulo: "Escreva como foi o dia", dica: "Alimentação, sono e o que valer registrar.", href: "/diario" },
    { id: "checkin", titulo: "Faça um check-in", dica: "Conte o dia numa conversa curta.", href: "/conversa" },
  ],
};

const idoso: Conteudo = {
  grande: true,
  slides: [
    {
      icone: "cadeado",
      titulo: "Este espaço é seu",
      texto:
        "Aqui ficam as informações sobre você. Só você e as pessoas que você autorizou conseguem ver.",
    },
    {
      icone: "coracao",
      titulo: "Conte como você gosta de ser tratado",
      texto:
        "O que você gosta, o que incomoda, a sua rotina e as suas histórias. Quem cuida de você lê isso para cuidar do seu jeito.",
    },
    {
      icone: "escudo",
      titulo: "A sua vontade importa",
      texto:
        "Em Diretivas, você registra o que quer para o seu cuidado, com calma e quando quiser. Você também pode conversar com o Guardião a qualquer hora.",
    },
  ],
  passos: [
    { id: "preferencias", titulo: "Conte como você gosta de ser tratado", dica: "O que agrada e o que incomoda.", href: "/identidade" },
    { id: "checkin", titulo: "Converse com o Guardião", dica: "Uma conversa curta, quando quiser.", href: "/conversa" },
    { id: "diretivas", titulo: "Conheça as suas diretivas", dica: "O que você quer para o seu cuidado.", href: "/diretivas" },
  ],
};

export function conteudoOnboarding(role: Role, admin: boolean): Conteudo {
  if (role === "idoso") return idoso;
  if (role === "cuidador") return cuidador;
  return admin ? familiarAdmin : familiar;
}

export const preencher = (t: string, nome: string) => t.replaceAll("{nome}", nome);

/** Evento que reabre as boas-vindas (botão de ajuda no cabeçalho). */
export const EVENTO_BOAS_VINDAS = "guardiao:boas-vindas";
