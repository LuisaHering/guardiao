// Completude do perfil: o quanto do que ajuda a cuidar já foi registrado.
// Mede PREENCHIMENTO, não a qualidade do cuidado nem a veracidade do conteúdo.
// Função pura: a tela busca as contagens e esta função só calcula.

export type DadosCompletude = {
  comoChamar: boolean;
  nascimento: boolean;
  tipoSanguineo: boolean;
  contatos: number;
  condicoes: number;
  alergias: number;
  medicacoes: number;
  consentimento: boolean;
  qrEmergencia: boolean;
  preferencias: number; // preferências confirmadas
  preferenciasComunicacao: number; // confirmadas, sobre como gosta de ser tratado
  memorias: number; // confirmadas
  diretiva: boolean;
  exames: number;
  consultas: number;
};

export type ItemCompletude = {
  id: string;
  rotulo: string;
  dica: string;
  href: string;
  peso: number;
  /** quanto desse peso já foi conquistado (0 a peso) */
  ganho: number;
};

export type ResultadoCompletude = {
  percentual: number;
  itens: ItemCompletude[];
  /** o que falta, do que mais pesa para o que menos pesa */
  proximos: ItemCompletude[];
};

function item(
  id: string,
  rotulo: string,
  dica: string,
  href: string,
  peso: number,
  fracao: number,
): ItemCompletude {
  return { id, rotulo, dica, href, peso, ganho: peso * Math.min(1, Math.max(0, fracao)) };
}

// Os pesos somam 100.
export function calcularCompletude(d: DadosCompletude): ResultadoCompletude {
  const itens: ItemCompletude[] = [
    item("como_chamar", "Como gosta de ser chamado", "Preencha no perfil do idoso.", "/perfil", 5, d.comoChamar ? 1 : 0),
    item("nascimento", "Data de nascimento", "Preencha no perfil do idoso.", "/perfil", 5, d.nascimento ? 1 : 0),
    item("tipo_sanguineo", "Tipo sanguíneo", "Preencha no perfil do idoso.", "/perfil", 5, d.tipoSanguineo ? 1 : 0),
    item("contato", "Um contato de emergência", "Quem chamar numa urgência.", "/perfil", 10, d.contatos >= 1 ? 1 : 0),
    item("condicoes", "Condições de saúde", "Registre as condições ativas.", "/perfil", 5, d.condicoes >= 1 ? 1 : 0),
    item("alergias", "Alergias", "Registre as alergias conhecidas.", "/perfil", 5, d.alergias >= 1 ? 1 : 0),
    item("medicacao", "Medicação", "Cadastre os remédios em uso.", "/medicacao", 10, d.medicacoes >= 1 ? 1 : 0),
    item("consentimento", "Consentimento do titular (LGPD)", "Registre no perfil do idoso.", "/perfil", 10, d.consentimento ? 1 : 0),
    item("qr", "QR de emergência", "Gere o QR com os dados críticos.", "/emergencia", 5, d.qrEmergencia ? 1 : 0),
    item("preferencias", "Preferências (pelo menos 3)", "O que agrada, o que incomoda, a rotina.", "/identidade", 10, d.preferencias / 3),
    item("comunicacao", "Como gosta de ser tratado", "Uma preferência sobre o jeito de tratar.", "/identidade", 5, d.preferenciasComunicacao >= 1 ? 1 : 0),
    item("memorias", "Uma memória ou parte da história", "Um pedaço da história de vida.", "/identidade", 5, d.memorias >= 1 ? 1 : 0),
    item("diretiva", "Diretiva de cuidado", "Preferências de cuidado e de fim de vida.", "/diretivas", 10, d.diretiva ? 1 : 0),
    item("exames", "Um exame confirmado", "Leia e confirme um laudo.", "/exames", 5, d.exames >= 1 ? 1 : 0),
    item("consultas", "Uma consulta registrada", "Registre uma consulta.", "/consultas", 5, d.consultas >= 1 ? 1 : 0),
  ];

  const total = itens.reduce((s, i) => s + i.ganho, 0);
  const proximos = itens
    .filter((i) => i.ganho < i.peso)
    .sort((a, b) => b.peso - b.ganho - (a.peso - a.ganho));

  return { percentual: Math.round(total), itens, proximos };
}
