export type Role = "idoso" | "cuidador" | "familiar";

export type Membership = {
  role: Role;
  admin: boolean;
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
    { href: "/timeline", label: "Timeline", enabled: false },
    { href: "/medicacao", label: "Medicação", enabled: false },
    { href: "/documentos", label: "Documentos", enabled: false },
  ],
  cuidador: [
    { href: "/painel", label: "Hoje", enabled: true },
    { href: "/medicacao", label: "Medicação", enabled: false },
    { href: "/diario", label: "Diário", enabled: false },
    { href: "/sintomas", label: "Sintomas", enabled: false },
  ],
  idoso: [
    { href: "/painel", label: "Painel", enabled: true },
    { href: "/conversa", label: "Conversa", enabled: false },
    { href: "/preferencias", label: "Minhas preferências", enabled: false },
  ],
};

/** A navegacao depende do papel; admin ganha "Rede e acessos" por cima. */
export function navFor(membership: Membership): NavItem[] {
  const items = [...byRole[membership.role]];
  if (membership.admin) {
    items.push({ href: "/rede", label: "Rede e acessos", enabled: false });
  }
  return items;
}
