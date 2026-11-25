// Regras de agenda e de doses dos remédios. É o ÚNICO lugar que decide "o que é para hoje":
// tela de medicação, painel, chat e extração usam estas funções.
// Sem imports do projeto, para poder ser testado sozinho (npm test).

export type Frequencia = "diaria" | "semana" | "intervalo" | "quando_precisar";

export type Agenda = {
  frequencia: Frequencia;
  /** cada item é "HH:MM" ou um período ("manha", "tarde", "noite"); vazio = sem horário */
  horarios: string[];
  /** 0 = domingo ... 6 = sábado */
  dias_semana: number[];
  intervalo_dias: number | null;
  /** AAAA-MM-DD */
  inicio: string;
  fim: string | null;
};

export type Remedio = Agenda & {
  id: string;
  nome: string;
  dosagem: string | null;
  instrucoes: string | null;
  ativo: boolean;
  /** false = aguardando o administrador */
  confirmado: boolean;
  autor_id: string | null;
};

export type RegistroDose = {
  medicacao_id: string;
  data: string;
  /** "" para remédio sem horário */
  horario: string;
  status: "dada" | "nao_dada";
  motivo: string | null;
  registrado_por?: string | null;
  registrado_em?: string;
};

export type Dose = {
  remedio: Remedio;
  /** horário previsto na agenda de hoje ("" se não houver) */
  horario: string;
  registro: RegistroDose | null;
  /** o registro foi feito num horário que a agenda não tem mais */
  horarioAntigo: boolean;
  atrasada: boolean;
};

export const COLUNAS_REMEDIO =
  "id, nome, dosagem, instrucoes, ativo, confirmado, autor_id, frequencia, horarios, dias_semana, intervalo_dias, inicio, fim";

export const COLUNAS_DOSE = "medicacao_id, data, horario, status, motivo, registrado_por, registrado_em";

/** Folga antes de uma dose aparecer como atrasada. */
export const TOLERANCIA_MIN = 30;

export const MOTIVOS: { valor: string; rotulo: string }[] = [
  { valor: "esqueceu", rotulo: "Esqueci" },
  { valor: "recusou", rotulo: "Não quis tomar" },
  { valor: "efeito_adverso", rotulo: "Passou mal" },
  { valor: "acabou", rotulo: "Acabou o remédio" },
  { valor: "outro", rotulo: "Outro motivo" },
];

export const rotuloDoMotivo = (v: string | null) =>
  MOTIVOS.find((m) => m.valor === v)?.rotulo ?? v ?? "";

export const DIAS_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const FUSO = "America/Sao_Paulo";

export function hojeBR(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(agora);
}

export function horaBR(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(agora);
}

const meioDia = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
export const diaDaSemana = (iso: string) => new Date(meioDia(iso)).getUTCDay();
export const diasEntre = (de: string, ate: string) => Math.round((meioDia(ate) - meioDia(de)) / 86_400_000);

const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

/**
 * Períodos do dia, para quem não tem hora marcada. `meio` serve para ordenar a lista;
 * `inicio` diz quando a dose "chegou"; passado o `fim`, ela aparece como atrasada.
 */
export const PERIODOS = [
  { valor: "manha", rotulo: "Manhã", inicio: "05:00", meio: "09:00", fim: "12:00" },
  { valor: "tarde", rotulo: "Tarde", inicio: "12:00", meio: "15:00", fim: "18:00" },
  { valor: "noite", rotulo: "Noite", inicio: "18:00", meio: "21:00", fim: "23:00" },
] as const;

const periodoDe = (h: string) => PERIODOS.find((p) => p.valor === h);
export const ehPeriodo = (h: string) => !!periodoDe(h);
export const rotuloHorario = (h: string) => periodoDe(h)?.rotulo ?? h;

/** Posição do horário no dia, em minutos (sem horário vai para o fim). */
const posicao = (h: string) => (h ? minutos(periodoDe(h)?.meio ?? h) : 24 * 60);

export const compararHorarios = (a: string, b: string) => posicao(a) - posicao(b) || a.localeCompare(b);

/** A hora desta dose já chegou (com uma folga, em minutos)? Sem horário, vale o dia todo. */
export function jaChegou(horario: string, hora: string, folga = 60): boolean {
  if (!horario) return true;
  return minutos(periodoDe(horario)?.inicio ?? horario) <= minutos(hora) + folga;
}

function passouDaHora(horario: string, hora: string): boolean {
  const p = periodoDe(horario);
  return p ? minutos(hora) > minutos(p.fim) : minutos(hora) > minutos(horario) + TOLERANCIA_MIN;
}

/** "manhã, noite" ou "08:00 e 20:00", na ordem do dia. */
const listarHorarios = (hs: string[]) =>
  juntar([...hs].sort(compararHorarios).map((h) => (ehPeriodo(h) ? rotuloHorario(h).toLowerCase() : h)));

/** O remédio é esperado neste dia? "Só quando precisar" nunca é esperado. */
export function valeNoDia(r: Agenda & { ativo?: boolean }, dia: string): boolean {
  if (r.ativo === false) return false;
  if (dia < r.inicio || (r.fim && dia > r.fim)) return false;
  if (r.frequencia === "diaria") return true;
  if (r.frequencia === "semana") return r.dias_semana.includes(diaDaSemana(dia));
  if (r.frequencia === "intervalo") {
    return !!r.intervalo_dias && diasEntre(r.inicio, dia) % r.intervalo_dias === 0;
  }
  return false;
}

/** Em uso hoje: ativo e dentro do período (inclui os "só quando precisar"). */
export function emUso(r: Agenda & { ativo?: boolean }, dia: string): boolean {
  return r.ativo !== false && dia >= r.inicio && (!r.fim || dia <= r.fim);
}

/**
 * As doses previstas para o dia, com o que já foi registrado.
 *
 * Segurança: um registro nunca é "perdido". Se o horário do remédio mudou depois que a dose
 * foi registrada, o registro ocupa a dose livre de horário mais próximo. Sem isso, uma dose
 * já dada voltaria a aparecer como pendente e poderia ser dada de novo.
 */
export function dosesDoDia(
  remedios: Remedio[],
  registros: RegistroDose[],
  dia: string,
  agora: { dia: string; hora: string } = { dia: hojeBR(), hora: horaBR() },
): Dose[] {
  const doses: Dose[] = [];

  for (const remedio of remedios) {
    if (!valeNoDia(remedio, dia)) continue;
    const slots = remedio.horarios.length ? [...remedio.horarios].sort(compararHorarios) : [""];
    const doDia = registros.filter((r) => r.medicacao_id === remedio.id && r.data === dia);

    const ocupados = new Map<number, { registro: RegistroDose; antigo: boolean }>();
    const sobras: RegistroDose[] = [];
    for (const reg of doDia) {
      const i = slots.findIndex((s, j) => s === reg.horario && !ocupados.has(j));
      if (i >= 0) ocupados.set(i, { registro: reg, antigo: false });
      else sobras.push(reg);
    }
    for (const reg of sobras.sort((a, b) => compararHorarios(a.horario, b.horario))) {
      let melhor = -1;
      let distancia = Number.POSITIVE_INFINITY;
      slots.forEach((s, j) => {
        if (ocupados.has(j)) return;
        const d = s && reg.horario ? Math.abs(posicao(s) - posicao(reg.horario)) : j;
        if (d < distancia) {
          melhor = j;
          distancia = d;
        }
      });
      if (melhor >= 0) {
        ocupados.set(melhor, { registro: reg, antigo: reg.horario !== "" && slots[melhor] !== reg.horario });
      }
    }

    slots.forEach((horario, i) => {
      const o = ocupados.get(i);
      doses.push({
        remedio,
        horario,
        registro: o?.registro ?? null,
        horarioAntigo: o?.antigo ?? false,
        atrasada: !o && horario !== "" && dia === agora.dia && passouDaHora(horario, agora.hora),
      });
    });
  }

  return doses.sort(
    (a, b) => compararHorarios(a.horario, b.horario) || a.remedio.nome.localeCompare(b.remedio.nome),
  );
}

/**
 * Para "ele tomou o remédio" dito numa conversa: qual dose é? A última pendente cujo horário
 * já chegou (com 1 h de folga); se nenhuma chegou, a próxima pendente. null = nada pendente.
 */
export function doseParaRegistrar(doses: Dose[], hora: string): Dose | null {
  const pendentes = doses.filter((d) => !d.registro);
  const chegaram = pendentes.filter((d) => jaChegou(d.horario, hora));
  return chegaram[chegaram.length - 1] ?? pendentes[0] ?? null;
}

export type SituacaoDia = "dada" | "parcial" | "nao_dada" | "sem_registro" | "sem_dose";

/** Resumo de um remédio num dia. Um dia com duas doses e uma registrada é "parcial", nunca "feito". */
export function resumoDoDia(
  r: Remedio,
  registros: RegistroDose[],
  dia: string,
): { situacao: SituacaoDia; previstas: number; registradas: number } {
  const doDia = registros.filter((x) => x.medicacao_id === r.id && x.data === dia);
  const previstas = valeNoDia(r, dia) ? Math.max(r.horarios.length, 1) : 0;
  let situacao: SituacaoDia;
  if (doDia.some((x) => x.status === "nao_dada")) situacao = "nao_dada";
  else if (doDia.length === 0) situacao = previstas ? "sem_registro" : "sem_dose";
  else situacao = doDia.length < previstas ? "parcial" : "dada";
  return { situacao, previstas, registradas: doDia.length };
}

export function juntar(itens: string[]): string {
  return itens.length <= 1 ? (itens[0] ?? "") : `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

const diaMes = (iso: string) => iso.slice(0, 10).split("-").reverse().slice(0, 2).join("/");

/** "Todo dia, 08:00 e 20:00 · até 30/11" */
export function descreverAgenda(r: Agenda): string {
  let base: string;
  if (r.frequencia === "quando_precisar") base = "Só quando precisar";
  else if (r.frequencia === "semana") {
    base = juntar([...r.dias_semana].sort().map((d) => DIAS_CURTOS[d]));
    base = base.charAt(0).toUpperCase() + base.slice(1);
  } else if (r.frequencia === "intervalo") base = `A cada ${r.intervalo_dias} dias`;
  else base = "Todo dia";

  if (r.frequencia !== "quando_precisar") {
    base += r.horarios.length ? `, ${listarHorarios(r.horarios)}` : ", sem horário";
  }
  return r.fim ? `${base} · até ${diaMes(r.fim)}` : base;
}

/** Data somando dias (para "tomar por N dias": fim = início + N - 1). */
export function somarDias(iso: string, dias: number): string {
  return new Date(meioDia(iso) + dias * 86_400_000).toISOString().slice(0, 10);
}

export function agendaVazia(hoje: string = hojeBR()): Agenda {
  return { frequencia: "diaria", horarios: [], dias_semana: [], intervalo_dias: null, inicio: hoje, fim: null };
}

/** Mensagem do problema, ou null se a agenda está boa. */
export function validarAgenda(a: Agenda): string | null {
  if (a.horarios.some((h) => !ehPeriodo(h) && !/^([01]\d|2[0-3]):[0-5]\d$/.test(h))) {
    return "Preencha todos os horários ou apague o que estiver vazio.";
  }
  if (new Set(a.horarios).size !== a.horarios.length) return "Há um horário repetido.";
  if (a.frequencia === "semana" && a.dias_semana.length === 0) return "Escolha os dias da semana.";
  if (a.frequencia === "intervalo" && !(a.intervalo_dias && a.intervalo_dias >= 2 && a.intervalo_dias <= 365)) {
    return "Diga de quantos em quantos dias (2 ou mais).";
  }
  // "" = a pessoa disse que tem fim, mas ainda não disse quando: não pode virar "sem fim".
  if (a.fim === "") return "Diga por quantos dias ou até quando o remédio será tomado.";
  if (a.fim && a.fim < a.inicio) return "A data final não pode ser antes do início.";
  return null;
}

/** Só os campos de agenda, já limpos para gravar (o que não se aplica à frequência é zerado). */
export function agendaParaGravar(a: Agenda): Agenda {
  return {
    frequencia: a.frequencia,
    horarios: a.frequencia === "quando_precisar" ? [] : [...a.horarios].sort(compararHorarios),
    dias_semana: a.frequencia === "semana" ? [...a.dias_semana].sort() : [],
    intervalo_dias: a.frequencia === "intervalo" ? a.intervalo_dias : null,
    inicio: a.inicio,
    fim: a.fim || null,
  };
}

/**
 * Sugestão a partir do texto da receita. É conservadora de propósito: na dúvida não preenche
 * horário (um horário a menos passaria despercebido), e uma pessoa sempre confere.
 */
export function sugerirAgenda(texto: string): Partial<Agenda> {
  // "à" pode vir como uma letra só ou como "a" + acento: sem padronizar, o período não é achado.
  const t = texto.normalize("NFC").toLowerCase();
  if (/quando necess|se necess|se precisar|se houver dor|em caso de|\bsos\b/.test(t)) {
    return { frequencia: "quando_precisar", horarios: [] };
  }
  const sugestao: Partial<Agenda> = {};
  const cada = t.match(/a cada (\d{1,3}) dias/);
  if (/dias alternados|dia sim,? dia n[aã]o/.test(t)) {
    sugestao.frequencia = "intervalo";
    sugestao.intervalo_dias = 2;
  } else if (cada && Number(cada[1]) >= 2) {
    sugestao.frequencia = "intervalo";
    sugestao.intervalo_dias = Number(cada[1]);
  } else if (/semana/.test(t)) {
    // Sem saber o dia, a tela obriga a escolher: melhor que supor "todo dia".
    sugestao.frequencia = "semana";
    sugestao.dias_semana = [];
  }

  const achados = new Set<string>();
  const padrao = /(?:(?:^|\s)(?:às|as|à)\s+(\d{1,2})\s*(?:h|:)\s*(\d{2})?)|(?:\b(\d{2}):(\d{2})\b)/g;
  for (const m of t.matchAll(padrao)) {
    const h = Number(m[1] ?? m[3]);
    const min = Number(m[2] ?? m[4] ?? 0);
    if (h <= 23 && min <= 59) achados.add(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
  }
  const mencoes = t.match(/\d{1,2}\s*(?:h\b|:\d{2}|h\d{2})/g)?.length ?? 0;
  if (achados.size > 0 && achados.size === mencoes) sugestao.horarios = [...achados].sort();

  // Sem hora escrita, vale o período ("pela manhã", "à noite"). "Amanhã" não conta.
  if (mencoes === 0) {
    const periodos: string[] = [];
    if (/(?:pela|de|da|na|à|a)\s+manh[ãa]/.test(t)) periodos.push("manha");
    if (/(?:pela|de|da|na|à|a)\s+tarde/.test(t)) periodos.push("tarde");
    if (/(?:pela|de|da|na|à|a)\s+noite|ao deitar|antes de dormir/.test(t)) periodos.push("noite");
    if (periodos.length) sugestao.horarios = periodos;
  }

  return sugestao;
}

// ---------------------------------------------------------------------------
// Receita lida da foto
// ---------------------------------------------------------------------------
// O que a IA leu e a pessoa confirmar passa a valer na hora. Por isso, em qualquer dúvida,
// o item NÃO entra sozinho: vai para a família olhar a foto.

export type RemedioLido = {
  nome: string;
  dosagem: string | null;
  frequencia: string | null;
  observacoes: string | null;
  /** o papel manda parar este remédio */
  parar: boolean;
  /** só quando o papel diz por quanto tempo, em dias */
  duracao_dias: number | null;
  /** palpite da IA sobre qual remédio da lista é este */
  medicacao_id: string | null;
};

/** `vezes`: quantos dias por semana o papel pede, quando diz. */
export type Recorrencia = { tipo: "semana"; vezes: number | null } | { tipo: "intervalo" };

export type Classificacao =
  | {
      acao: "novo";
      agenda: Agenda;
      instrucoes: string | null;
      /** não é de todo dia: quem confere precisa confirmar de novo, com atenção */
      recorrencia: Recorrencia | null;
    }
  | { acao: "ja_toma"; alvo: Remedio }
  | { acao: "mudar"; alvo: Remedio; dados: { dosagem?: string; horarios?: string[] }; mudancas: string[] }
  | { acao: "duvida"; alvo: Remedio | null; motivo: string }
  | { acao: "parar"; alvo: Remedio | null };

const simples = (t: string) =>
  t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const mesmaDose = (a: string, b: string) => {
  const limpa = (t: string) => simples(t).replace(/\s/g, "").replace(/,/g, ".");
  return limpa(a) === limpa(b);
};

/** Palavras que, sobrando num nome, indicam outra fórmula ("Losartana HCT", "X XR"). */
const OUTRA_FORMULA = /[+/]|(^| )(e|hct|hctz|hidroclorotiazida|anlodipino|plus|composto|d|xr|sr|cr|od|retard)( |$)/;

function parentesco(a: string, b: string): "mesmo" | "talvez" | "outro" {
  const x = simples(a);
  const y = simples(b);
  if (x === y) return "mesmo";
  const [curto, longo] = x.length < y.length ? [x, y] : [y, x];
  if (longo.startsWith(`${curto} `)) return OUTRA_FORMULA.test(longo.slice(curto.length + 1)) ? "talvez" : "mesmo";
  const primeira = x.split(" ")[0];
  return primeira.length >= 4 && primeira === y.split(" ")[0] ? "talvez" : "outro";
}

/** Posologias que a tela não sabe montar sozinha sem arriscar virar "todo dia, para sempre". */
const NAO_E_DIARIO = /mensal|quinzen|(ao|por) m[eê]s|a cada \d+ (m[eê]s|meses)|dose [uú]nica|[uú]nica vez/;

/** "por 2 semanas" é duração, não "toda semana": sai do texto antes de ler a frequência. */
const DURACAO = /(?:por|durante)\s+(\d{1,3}|uma?|duas|dois|tr[eê]s)\s*(dias?|semanas?|m[eê]s(?:es)?)/g;

const NUMEROS: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, "três": 3, tres: 3 };
const numero = (t: string) => NUMEROS[t] ?? Number(t);

/** Dias de tratamento escritos no texto; "meses" devolve -1 (não dá para converter com segurança). */
function duracaoNoTexto(t: string): number | null {
  const m = [...t.matchAll(DURACAO)][0];
  if (!m) return null;
  if (m[2].startsWith("m")) return -1;
  return numero(m[1]) * (m[2].startsWith("s") ? 7 : 1);
}

const TODA_SEMANA =
  /semanal|(?:vez|vezes|x)\s*(?:por|na|a cada|ao longo da)\s+semana\b|(?:por|toda|cada)\s+semana\b|a cada 7 dias/;

/** Dias da semana citados. "segunda dose" não é dia: exige plural, "-feira" ou "toda/às". */
const DIAS_DA_SEMANA: [number, RegExp][] = [
  [0, /\bdomingos?\b/],
  [1, /\bsegundas\b|\bsegunda[- ]feira|\b(?:toda|na|às|as)\s+segunda\b/],
  [2, /\bter[cç]as\b|\bter[cç]a[- ]feira|\b(?:toda|na|às|as)\s+ter[cç]a\b/],
  [3, /\bquartas\b|\bquarta[- ]feira|\b(?:toda|na|às|as)\s+quarta\b/],
  [4, /\bquintas\b|\bquinta[- ]feira|\b(?:toda|na|às|as)\s+quinta\b/],
  [5, /\bsextas\b|\bsexta[- ]feira|\b(?:toda|na|às|as)\s+sexta\b/],
  [6, /\bs[aá]bados?\b/],
];

/** Quantos dias por semana o papel pede ("2 vezes por semana"), ou null se não diz. */
function vezesPorSemana(t: string): number | null {
  const m = t.match(/(\d|uma?|duas|três|tres)\s*(?:vez|vezes|x)\s*(?:por|na|ao longo da)\s+semana/);
  if (m) return numero(m[1]);
  return /semanal|a cada 7 dias/.test(t) ? 1 : null;
}

const mesmosHorarios = (a: string[], b: string[]) =>
  [...a].sort(compararHorarios).join() === [...b].sort(compararHorarios).join();

export function classificarRemedio(lido: RemedioLido, ativos: Remedio[], hoje: string = hojeBR()): Classificacao {
  const mesmos = ativos.filter((r) => parentesco(r.nome, lido.nome) === "mesmo");
  const parecidos = ativos.filter(
    (r) => !mesmos.includes(r) && (parentesco(r.nome, lido.nome) === "talvez" || r.id === lido.medicacao_id),
  );
  const alvoProvavel = mesmos[0] ?? parecidos[0] ?? null;

  if (lido.parar) return { acao: "parar", alvo: alvoProvavel };

  const texto = [lido.frequencia, lido.observacoes].filter(Boolean).join(" · ").normalize("NFC");
  const baixo = texto.toLowerCase();
  const semDuracao = baixo.replace(DURACAO, " ");
  const sugestao = sugerirAgenda(semDuracao);
  const diasCitados = DIAS_DA_SEMANA.filter(([, regra]) => regra.test(semDuracao)).map(([d]) => d);
  const semanal = TODA_SEMANA.test(semDuracao) || diasCitados.length > 0;
  // A leitura geral chama de "semana" qualquer texto com essa palavra; aqui vale a regra estrita.
  if (sugestao.frequencia === "semana") {
    delete sugestao.frequencia;
    delete sugestao.dias_semana;
  }
  const duvida = (motivo: string): Classificacao => ({ acao: "duvida", alvo: alvoProvavel, motivo });

  if (mesmos.length > 1) return duvida("há mais de um remédio com esse nome na lista");

  if (mesmos.length === 1) {
    const alvo = mesmos[0];
    const frequenciaLida = semanal ? "semana" : sugestao.frequencia;
    if ((frequenciaLida && frequenciaLida !== alvo.frequencia) || NAO_E_DIARIO.test(baixo)) {
      return duvida("o papel parece mudar os dias de tomar");
    }
    const dados: { dosagem?: string; horarios?: string[] } = {};
    const mudancas: string[] = [];
    if (lido.dosagem && alvo.dosagem && !mesmaDose(lido.dosagem, alvo.dosagem)) {
      dados.dosagem = lido.dosagem.trim();
      mudancas.push(`Dose: ${alvo.dosagem} → ${lido.dosagem.trim()}`);
    }
    if (sugestao.horarios?.length && !mesmosHorarios(sugestao.horarios, alvo.horarios)) {
      dados.horarios = [...sugestao.horarios].sort(compararHorarios);
      mudancas.push(
        `Quando: ${descreverAgenda(alvo)} → ${descreverAgenda({ ...alvo, horarios: dados.horarios })}`,
      );
    }
    return mudancas.length ? { acao: "mudar", alvo, dados, mudancas } : { acao: "ja_toma", alvo };
  }

  if (parecidos.length > 0) return duvida(`pode ser o mesmo que ${parecidos[0].nome}, que já está na lista`);
  if (!lido.dosagem?.trim()) return duvida("não deu para ler a dose");
  if (NAO_E_DIARIO.test(baixo)) return duvida("não é um remédio de todo dia");

  const escrita = duracaoNoTexto(baixo);
  const dias = lido.duracao_dias ?? escrita;
  if (escrita === -1 && !lido.duracao_dias) return duvida("o tratamento é contado em meses");
  if (dias !== null && !(Number.isInteger(dias) && dias >= 1 && dias <= 365)) {
    return duvida("não entendi por quanto tempo");
  }

  const base: Agenda = { ...agendaVazia(hoje), ...sugestao, fim: dias ? somarDias(hoje, dias - 1) : null };
  let recorrencia: Recorrencia | null = null;
  if (semanal && base.frequencia !== "quando_precisar") {
    base.frequencia = "semana";
    base.intervalo_dias = null;
    const vezes = vezesPorSemana(semDuracao);
    // Só vem marcado quando o papel cita um dia (ou exatamente quantos pede): "segunda a sexta" não.
    const claro = diasCitados.length === (vezes ?? 1) && !/ (?:a|até) (?:segunda|ter|quarta|quinta|sexta|s[aá]bado|domingo)/.test(semDuracao);
    base.dias_semana = claro ? diasCitados : [];
    recorrencia = { tipo: "semana", vezes };
  } else if (base.frequencia === "intervalo") {
    recorrencia = { tipo: "intervalo" };
  }
  return { acao: "novo", agenda: agendaParaGravar(base), instrucoes: texto || null, recorrencia };
}
