"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { navFor, roleLabels, type NavItem } from "@/lib/roles";
import { cn } from "@/lib/cn";
import { SinoAlertas } from "@/components/sino-alertas";
import { BoasVindas } from "@/components/boas-vindas";
import { PopupRevisao } from "@/components/popup-revisao";
import { EVENTO_BOAS_VINDAS } from "@/lib/onboarding";

function Shield() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

const semIdoso: NavItem[] = [
  { href: "/perfil", label: "Perfil do idoso", enabled: true },
];

/** A lista de navegação, com os títulos de grupo. Serve à barra lateral e ao menu do celular. */
function NavLista({ items, aoNavegar }: { items: NavItem[]; aoNavegar?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1" aria-label="Navegação principal">
      {items.map((item, i) => {
        const novoGrupo = item.grupo !== items[i - 1]?.grupo;
        const active = pathname === item.href;
        return (
          <div key={item.href} className="flex flex-col">
            {novoGrupo && (
              <p
                className={cn(
                  "px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-subtle/70",
                  item.grupo ? "pt-4" : "pt-1",
                )}
              >
                {item.grupo ?? ""}
              </p>
            )}
            {!item.enabled ? (
              <span className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-subtle/60">
                {item.label}
                <span className="text-[10px] uppercase tracking-wide">em breve</span>
              </span>
            ) : (
              <Link
                href={item.href}
                onClick={aoNavegar}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-primary-soft font-medium text-primary"
                    : "text-subtle hover:bg-panel hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const membership = useRole();
  const router = useRouter();
  const items = membership ? navFor(membership) : semIdoso;
  const [menuAberto, setMenuAberto] = useState(false);

  async function sair() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 flex-col gap-1 overflow-y-auto border-r border-line bg-card p-4 md:flex">
        <div className="flex items-center gap-2 px-2 pb-4 text-primary">
          <Shield />
          <span className="text-base font-semibold text-ink">Guardião</span>
        </div>

        <NavLista items={items} />

        <div className="mt-auto flex flex-col gap-2 border-t border-line pt-4">
          {membership && (
            <div className="px-3 text-xs text-subtle">
              <div className="text-ink">{membership.idosoNomeCompleto ?? membership.idosoNome}</div>
              <div>
                {roleLabels[membership.role]}
                {membership.admin ? " · admin" : ""}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={sair}
            className="rounded-lg px-3 py-2 text-left text-sm text-subtle hover:bg-panel hover:text-ink"
          >
            Sair
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative flex h-14 items-center gap-3 border-b border-line bg-card px-4">
          {/* No celular a barra lateral some: o menu abre por este botão. */}
          <button
            type="button"
            onClick={() => setMenuAberto(!menuAberto)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-subtle hover:bg-panel hover:text-ink md:hidden"
            aria-label={menuAberto ? "Fechar menu" : "Abrir menu"}
            aria-expanded={menuAberto}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              aria-hidden
            >
              {menuAberto ? (
                <path d="M6 6l12 12M18 6L6 18" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" />
              )}
            </svg>
          </button>
          <span className="text-primary md:hidden">
            <Shield />
          </span>
          <span className="text-sm font-medium text-ink md:hidden">Guardião</span>
          {membership && (
            <div className="ml-auto flex items-center gap-3">
              <button
                type="button"
                onClick={() => window.dispatchEvent(new Event(EVENTO_BOAS_VINDAS))}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-subtle hover:bg-panel hover:text-ink"
                aria-label="Ajuda: rever as boas-vindas"
                title="Ajuda"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="12" r="9" />
                  <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5" />
                  <path d="M12 17h.01" />
                </svg>
              </button>
              <SinoAlertas />
              <span className="hidden text-xs text-subtle sm:inline">
                {roleLabels[membership.role]}
                {membership.admin ? " · admin" : ""}
              </span>
            </div>
          )}
        </header>

        {menuAberto && (
          <div className="fixed inset-x-0 bottom-0 top-14 z-40 flex flex-col gap-4 overflow-y-auto bg-card p-4 md:hidden">
            {membership && (
              <div className="px-3 text-xs text-subtle">
                <div className="text-sm text-ink">{membership.idosoNomeCompleto ?? membership.idosoNome}</div>
                <div>
                  {roleLabels[membership.role]}
                  {membership.admin ? " · admin" : ""}
                </div>
              </div>
            )}
            <NavLista items={items} aoNavegar={() => setMenuAberto(false)} />
            <button
              type="button"
              onClick={sair}
              className="mt-2 rounded-lg border border-line px-3 py-2 text-left text-sm text-subtle hover:bg-panel hover:text-ink"
            >
              Sair
            </button>
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
      <PopupRevisao />
      <BoasVindas />
    </div>
  );
}
