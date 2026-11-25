// Que tarefas aparecem em cada dia, e com que situação. Único lugar com essa regra.
// Sem imports do projeto, para poder ser testado sozinho (npm test).

export type FrequenciaTarefa = "diaria" | "semana" | "uma_vez";

export type Tarefa = {
  id: string;
  titulo: string;
  instrucao: string | null;
  frequencia: FrequenciaTarefa;
  /** 0 = domingo ... 6 = sábado */
  dias_semana: number[];
  /** AAAA-MM-DD: o dia (uma vez) ou a partir de quando vale */
  data: string;
};

export type RegistroTarefa = {
  tarefa_id: string;
  data: string;
  status: "feito" | "nao_consegui";
  nota: string | null;
  registrado_por?: string | null;
  registrado_em?: string;
};

export type ItemTarefa = {
  tarefa: Tarefa;
  registro: RegistroTarefa | null;
  /** tarefa de uma vez cujo dia já passou sem resposta */
  atrasada: boolean;
};

export const COLUNAS_TAREFA = "id, titulo, instrucao, frequencia, dias_semana, data";
export const COLUNAS_REGISTRO_TAREFA = "tarefa_id, data, status, nota, registrado_por, registrado_em";

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const diaDaSemana = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const diaMes = (iso: string) => iso.split("-").reverse().slice(0, 2).join("/");

/**
 * O que entra na lista de um dia.
 * - Todo dia / dias da semana: aparece nos dias que valem, com a resposta daquele dia.
 * - Uma vez: aparece a partir do dia marcado e continua (atrasada) até ser respondida.
 *   Depois de respondida, aparece só no dia em que foi respondida.
 */
export function tarefasDoDia(tarefas: Tarefa[], registros: RegistroTarefa[], dia: string): ItemTarefa[] {
  const itens: ItemTarefa[] = [];
  for (const tarefa of tarefas) {
    const dela = registros.filter((r) => r.tarefa_id === tarefa.id);
    if (tarefa.frequencia === "uma_vez") {
      const resposta = [...dela].sort((a, b) => b.data.localeCompare(a.data))[0] ?? null;
      if (resposta) {
        if (resposta.data === dia) itens.push({ tarefa, registro: resposta, atrasada: false });
      } else if (tarefa.data <= dia) {
        itens.push({ tarefa, registro: null, atrasada: tarefa.data < dia });
      }
      continue;
    }
    if (dia < tarefa.data) continue;
    if (tarefa.frequencia === "semana" && !tarefa.dias_semana.includes(diaDaSemana(dia))) continue;
    itens.push({ tarefa, registro: dela.find((r) => r.data === dia) ?? null, atrasada: false });
  }
  return itens.sort(
    (a, b) => Number(b.atrasada) - Number(a.atrasada) || a.tarefa.titulo.localeCompare(b.tarefa.titulo),
  );
}

export function descreverQuando(t: Pick<Tarefa, "frequencia" | "dias_semana" | "data">): string {
  if (t.frequencia === "uma_vez") return `Só uma vez, em ${diaMes(t.data)}`;
  if (t.frequencia === "semana") {
    const nomes = [...t.dias_semana].sort().map((d) => DIAS[d]);
    const texto = nomes.length <= 1 ? (nomes[0] ?? "") : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }
  return "Todo dia";
}

export function validarTarefa(t: Pick<Tarefa, "titulo" | "frequencia" | "dias_semana" | "data">): string | null {
  if (!t.titulo.trim()) return "Escreva o que deve ser feito.";
  if (t.frequencia === "semana" && t.dias_semana.length === 0) return "Escolha pelo menos um dia da semana.";
  if (t.frequencia === "uma_vez" && !/^\d{4}-\d{2}-\d{2}$/.test(t.data)) return "Escolha o dia.";
  return null;
}
