export type Role = "idoso" | "cuidador" | "familiar";

export type Membership = {
  role: Role;
  admin: boolean;
  idosoId?: string;
  /** como a pessoa prefere ser chamada (ou o nome, se nao informado): para frases */
  idosoNome?: string;
  /** nome completo: para documentos e identificacao formal */
  idosoNomeCompleto?: string;
};

export type NavItem = {
  href: string;
  label: string;
  /** false enquanto a rota ainda nao foi construida (cards seguintes) */
  enabled: boolean;
  /** titulo do grupo no menu; itens seguidos do mesmo grupo ficam juntos */
  grupo?: string;
};

export const roleLabels: Record<Role, string> = {
  idoso: "Idoso",
  cuidador: "Cuidador",
  familiar: "Familiar",
};

// Quem enxerga o que decorre do papel. O cuidador vê os exames, os valores, os laudos e
// as tendências, mas não a leitura feita pela IA: observações e visão 360 ficam com o
// familiar. As notificações seguem docs/modelagem.md, seção 3.12.
const byRole: Record<Role, NavItem[]> = {
  familiar: [
    { href: "/painel", label: "Painel", enabled: true },
    { href: "/visao-360", label: "Visão 360", enabled: true },
    { href: "/alertas", label: "Alertas", enabled: true },
    { href: "/familia", label: "Pedidos da família", enabled: true },

    { href: "/medicacao", label: "Medicação", enabled: true, grupo: "Dia a dia" },
    { href: "/diario", label: "Diário", enabled: true, grupo: "Dia a dia" },
    { href: "/sintomas", label: "Sintomas", enabled: true, grupo: "Dia a dia" },
    { href: "/tarefas", label: "Tarefas de quem cuida", enabled: true, grupo: "Dia a dia" },
    { href: "/conversa", label: "Conversa e check-in", enabled: true, grupo: "Dia a dia" },
    { href: "/timeline", label: "Timeline", enabled: true, grupo: "Dia a dia" },

    { href: "/consultas", label: "Consultas", enabled: true, grupo: "Saúde" },
    { href: "/pauta", label: "Pauta médica", enabled: true, grupo: "Saúde" },
    { href: "/receitas", label: "Receitas", enabled: true, grupo: "Saúde" },
    { href: "/pedidos", label: "Pedidos e resultados", enabled: true, grupo: "Saúde" },
    { href: "/exames", label: "Exames", enabled: true, grupo: "Saúde" },
    { href: "/tendencias", label: "Tendências", enabled: true, grupo: "Saúde" },
    { href: "/insights", label: "Observações", enabled: true, grupo: "Saúde" },

    { href: "/perfil", label: "Perfil do idoso", enabled: true, grupo: "Sobre a pessoa" },
    { href: "/identidade", label: "Preferências e história", enabled: true, grupo: "Sobre a pessoa" },
    { href: "/folha", label: "Folha de cuidado", enabled: true, grupo: "Sobre a pessoa" },
    { href: "/documentos", label: "Documentos", enabled: true, grupo: "Sobre a pessoa" },
    { href: "/diretivas", label: "Diretivas", enabled: true, grupo: "Sobre a pessoa" },
    { href: "/emergencia", label: "Emergência", enabled: true, grupo: "Sobre a pessoa" },
  ],
  cuidador: [
    { href: "/painel", label: "Hoje", enabled: true },
    { href: "/alertas", label: "Avisos", enabled: true },
    { href: "/familia", label: "Pedidos para os familiares", enabled: true },

    { href: "/medicacao", label: "Medicação", enabled: true, grupo: "Dia a dia" },
    { href: "/diario", label: "Diário", enabled: true, grupo: "Dia a dia" },
    { href: "/sintomas", label: "Sintomas", enabled: true, grupo: "Dia a dia" },
    { href: "/conversa", label: "Conversa e check-in", enabled: true, grupo: "Dia a dia" },
    { href: "/timeline", label: "Timeline", enabled: true, grupo: "Dia a dia" },

    { href: "/consultas", label: "Consultas", enabled: true, grupo: "Cuidado" },
    { href: "/pauta", label: "Pauta médica", enabled: true, grupo: "Cuidado" },
    { href: "/receitas", label: "Receitas", enabled: true, grupo: "Cuidado" },
    { href: "/pedidos", label: "Exames", enabled: true, grupo: "Cuidado" },
    { href: "/tendencias", label: "Tendências", enabled: true, grupo: "Cuidado" },

    { href: "/perfil", label: "Perfil do idoso", enabled: true, grupo: "Sobre a pessoa" },
    { href: "/identidade", label: "Preferências e história", enabled: true, grupo: "Sobre a pessoa" },
    { href: "/folha", label: "Folha de cuidado", enabled: true, grupo: "Sobre a pessoa" },
    { href: "/documentos", label: "Documentos", enabled: true, grupo: "Sobre a pessoa" },
    { href: "/emergencia", label: "Emergência", enabled: true, grupo: "Sobre a pessoa" },
  ],
  idoso: [
    { href: "/painel", label: "Painel", enabled: true },
    { href: "/alertas", label: "Alertas", enabled: true },
    { href: "/familia", label: "Pedidos para os familiares", enabled: true },

    { href: "/perfil", label: "Meu perfil", enabled: true, grupo: "Sobre mim" },
    { href: "/identidade", label: "Minhas preferências", enabled: true, grupo: "Sobre mim" },
    { href: "/documentos", label: "Meus documentos", enabled: true, grupo: "Sobre mim" },
    { href: "/diretivas", label: "Diretivas", enabled: true, grupo: "Sobre mim" },
    { href: "/conversa", label: "Conversa", enabled: true, grupo: "Sobre mim" },
  ],
};

/** A navegacao depende do papel; admin ganha "Rede e acessos" por cima. */
export function navFor(membership: Membership): NavItem[] {
  const items = [...byRole[membership.role]];
  if (membership.admin) {
    items.push({ href: "/rede", label: "Rede e acessos", enabled: true, grupo: "Administração" });
  }
  return items;
}
