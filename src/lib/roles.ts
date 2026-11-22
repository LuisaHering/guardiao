export type Role = "idoso" | "cuidador" | "familiar";

export type Membership = {
  role: Role;
  admin: boolean;
  idosoId?: string;
  idosoNome?: string;
};

export type NavItem = {
  href: string;
  label: string;
  /** false enquanto a rota ainda nao foi construida (cards seguintes) */
  enabled: boolean;
};

export const roleLabels: Record<Role, string> = {
  idoso: "Idoso",
  cuidador: "Cuidador",
  familiar: "Familiar",
};

const byRole: Record<Role, NavItem[]> = {
  familiar: [
    { href: "/painel", label: "Painel", enabled: true },
    { href: "/visao-360", label: "Visão 360", enabled: true },
    { href: "/alertas", label: "Alertas", enabled: true },
    { href: "/perfil", label: "Perfil do idoso", enabled: true },
    { href: "/identidade", label: "Preferências e história", enabled: true },
    { href: "/timeline", label: "Timeline", enabled: true },
    { href: "/medicacao", label: "Medicação", enabled: true },
    { href: "/diario", label: "Diário", enabled: true },
    { href: "/sintomas", label: "Sintomas", enabled: true },
    { href: "/emergencia", label: "Emergência", enabled: true },
    { href: "/consultas", label: "Consultas", enabled: true },
    { href: "/pauta", label: "Pauta médica", enabled: true },
    { href: "/receitas", label: "Receitas", enabled: true },
    { href: "/exames", label: "Exames", enabled: true },
    { href: "/tendencias", label: "Tendências", enabled: true },
    { href: "/insights", label: "Observações", enabled: true },
    { href: "/diretivas", label: "Diretivas", enabled: true },
    { href: "/documentos", label: "Documentos", enabled: false },
  ],
  cuidador: [
    { href: "/painel", label: "Hoje", enabled: true },
    { href: "/alertas", label: "Alertas", enabled: true },
    { href: "/perfil", label: "Perfil do idoso", enabled: true },
    { href: "/identidade", label: "Preferências e história", enabled: true },
    { href: "/timeline", label: "Timeline", enabled: true },
    { href: "/medicacao", label: "Medicação", enabled: true },
    { href: "/diario", label: "Diário", enabled: true },
    { href: "/sintomas", label: "Sintomas", enabled: true },
    { href: "/emergencia", label: "Emergência", enabled: true },
    { href: "/consultas", label: "Consultas", enabled: true },
    { href: "/pauta", label: "Pauta médica", enabled: true },
    { href: "/receitas", label: "Receitas", enabled: true },
    { href: "/exames", label: "Exames", enabled: true },
    { href: "/tendencias", label: "Tendências", enabled: true },
    { href: "/insights", label: "Observações", enabled: true },
  ],
  idoso: [
    { href: "/painel", label: "Painel", enabled: true },
    { href: "/perfil", label: "Meu perfil", enabled: true },
    { href: "/alertas", label: "Alertas", enabled: true },
    { href: "/diretivas", label: "Diretivas", enabled: true },
    { href: "/conversa", label: "Conversa", enabled: false },
    { href: "/identidade", label: "Minhas preferências", enabled: true },
  ],
};

/** A navegacao depende do papel; admin ganha "Rede e acessos" por cima. */
export function navFor(membership: Membership): NavItem[] {
  const items = [...byRole[membership.role]];
  if (membership.admin) {
    items.push({ href: "/rede", label: "Rede e acessos", enabled: true });
  }
  return items;
}
