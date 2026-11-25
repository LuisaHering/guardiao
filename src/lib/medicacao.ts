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

/** A hora desta dose já chegou (com 1 h de folga)? Sem horário, vale o dia todo. */
export function jaChegou(horario: string, hora: string): boolean {
  if (!horario) return true;
  return minutos(periodoDe(horario)?.inicio ?? horario) <= minutos(hora) + 60;
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
  const t = texto.toLowerCase();
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
