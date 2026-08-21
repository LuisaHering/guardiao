"use client";

import { createContext, useContext } from "react";
import type { Membership } from "@/lib/roles";

// O papel vem do vínculo real no banco, carregado no servidor e injetado aqui.
const RoleContext = createContext<Membership | null>(null);

export function RoleProvider({
  membership,
  children,
}: {
  membership: Membership | null;
  children: React.ReactNode;
}) {
  return (
    <RoleContext.Provider value={membership}>{children}</RoleContext.Provider>
  );
}

/** Retorna o vínculo do usuário, ou null se ele ainda não tem idoso. */
export function useRole(): Membership | null {
  return useContext(RoleContext);
}
