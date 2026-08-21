"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRole } from "@/lib/role-context";
import { navFor, roleLabels, type Membership, type Role } from "@/lib/roles";
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

export function AppShell({ children }: { children: React.ReactNode }) {
  const { membership, setMembership } = useRole();
  const pathname = usePathname();
  const items = navFor(membership);

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

        <div className="mt-auto border-t border-line pt-4">
          <RoleSwitcher membership={membership} onChange={setMembership} />
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-line bg-card px-4">
          <span className="text-primary md:hidden">
            <Shield />
          </span>
          <span className="text-sm font-medium text-ink md:hidden">Guardião</span>
          <span className="ml-auto text-xs text-subtle">
            {roleLabels[membership.role]}
            {membership.admin ? " · admin" : ""}
          </span>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}

const ROLES: Role[] = ["idoso", "cuidador", "familiar"];

function RoleSwitcher({
  membership,
  onChange,
}: {
  membership: Membership;
  onChange: (m: Membership) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] uppercase tracking-wide text-subtle">
        Ver como (temporário)
      </span>
      <select
        value={membership.role}
        onChange={(e) =>
          onChange({ ...membership, role: e.target.value as Role })
        }
        className="rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm text-ink"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {roleLabels[r]}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-2 text-xs text-subtle">
        <input
          type="checkbox"
          checked={membership.admin}
          onChange={(e) =>
            onChange({ ...membership, admin: e.target.checked })
          }
        />
        Administrador
      </label>
    </div>
  );
}
