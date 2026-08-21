"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { navFor, roleLabels, type NavItem } from "@/lib/roles";
import { cn } from "@/lib/cn";

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

export function AppShell({ children }: { children: React.ReactNode }) {
  const membership = useRole();
  const pathname = usePathname();
  const router = useRouter();
  const items = membership ? navFor(membership) : semIdoso;

  async function sair() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 flex-col gap-1 border-r border-line bg-card p-4 md:flex">
        <div className="flex items-center gap-2 px-2 pb-4 text-primary">
          <Shield />
          <span className="text-base font-semibold text-ink">Guardião</span>
        </div>

        <nav className="flex flex-col gap-1">
          {items.map((item) => {
            const active = pathname === item.href;
            if (!item.enabled) {
              return (
                <span
                  key={item.href}
                  className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-subtle/60"
                >
                  {item.label}
                  <span className="text-[10px] uppercase tracking-wide">
                    em breve
                  </span>
                </span>
              );
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-primary-soft font-medium text-primary"
                    : "text-subtle hover:bg-panel hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-2 border-t border-line pt-4">
          {membership && (
            <div className="px-3 text-xs text-subtle">
              <div className="text-ink">{membership.idosoNome}</div>
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

      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-line bg-card px-4">
          <span className="text-primary md:hidden">
            <Shield />
          </span>
          <span className="text-sm font-medium text-ink md:hidden">Guardião</span>
          {membership && (
            <span className="ml-auto text-xs text-subtle">
              {roleLabels[membership.role]}
              {membership.admin ? " · admin" : ""}
            </span>
          )}
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
