"use client";

import { createContext, useContext, useState } from "react";
import type { Membership } from "@/lib/roles";

type RoleContextValue = {
  membership: Membership;
  setMembership: (m: Membership) => void;
};

const RoleContext = createContext<RoleContextValue | null>(null);

// Papel inicial de desenvolvimento. Sera substituido pelo vinculo real do
// Supabase quando o auth (cards #5 e #6) estiver pronto.
const DEFAULT_MEMBERSHIP: Membership = { role: "familiar", admin: true };

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [membership, setMembership] = useState<Membership>(DEFAULT_MEMBERSHIP);
  return (
    <RoleContext.Provider value={{ membership, setMembership }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext);
  if (!ctx) {
    throw new Error("useRole precisa estar dentro de <RoleProvider>");
  }
  return ctx;
}
