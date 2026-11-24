"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { conteudoOnboarding, EVENTO_BOAS_VINDAS, preencher } from "@/lib/onboarding";
import { Button, Card } from "@/components/ui";
import { cn } from "@/lib/cn";

type Filtro = { coluna: string; valor: string };

/** Conta linhas sem trazê-las. `suave`: a tabela tem deleted_at. */
async function contar(
  supabase: SupabaseClient,
  tabela: string,
  filtros: Filtro[],
  suave = true,
): Promise<number> {
  let q = supabase.from(tabela).select("id", { count: "exact", head: true });
  for (const f of filtros) q = q.eq(f.coluna, f.valor);
  if (suave) q = q.is("deleted_at", null);
  const { count } = await q;
  return count ?? 0;
}

/** Cada passo é marcado sozinho, a partir do que a pessoa já fez no sistema. */
async function concluidos(
  supabase: SupabaseClient,
  idosoId: string,
  eu: string,
  role: string,
  ids: string[],
): Promise<Record<string, boolean>> {
  const doIdoso: Filtro[] = [{ coluna: "idoso_id", valor: idosoId }];
  const feitoPor = (coluna: string): Filtro[] => [...doIdoso, { coluna, valor: eu }];

  const verificadores: Record<string, () => Promise<boolean>> = {
    perfil: async () =>
      (await contar(supabase, "condicao", doIdoso)) +
        (await contar(supabase, "alergia", doIdoso)) +
        (await contar(supabase, "contato_emergencia", doIdoso)) >
      0,
    rede: async () =>
      (await contar(supabase, "vinculo", doIdoso)) > 1 ||
      (await contar(supabase, "convite", doIdoso, false)) > 0,
    medicacao: async () => {
      if (role === "cuidador") {
        return (await contar(supabase, "registro_medicacao", [{ coluna: "registrado_por", valor: eu }])) > 0;
      }
      return (await contar(supabase, "medicacao", doIdoso)) > 0;
    },
    checkin: async () => (await contar(supabase, "conversa", feitoPor("iniciada_por"), false)) > 0,
    preferencias: async () => {
      const filtros = role === "idoso" ? feitoPor("autor_id") : doIdoso;
      return (await contar(supabase, "preferencia", filtros)) > 0;
    },
    registro: async () =>
      (await contar(supabase, "entrada_diario", feitoPor("autor_id"))) +
        (await contar(supabase, "sintoma", feitoPor("autor_id"))) >
      0,
    diario: async () => (await contar(supabase, "entrada_diario", feitoPor("autor_id"))) > 0,
    diretivas: async () => (await contar(supabase, "diretiva", doIdoso, false)) > 0,
  };

  const resultado: Record<string, boolean> = {};
  await Promise.all(
    ids.map(async (id) => {
      try {
        resultado[id] = (await verificadores[id]?.()) ?? false;
      } catch {
        resultado[id] = false;
      }
    }),
  );
  return resultado;
}

export function PrimeirosPassos() {
  const membership = useRole();
  const [feitos, setFeitos] = useState<Record<string, boolean> | null>(null);
  const [dispensado, setDispensado] = useState(true);
  const [eu, setEu] = useState<string | null>(null);

  useEffect(() => {
    if (!membership?.idosoId) return;
    let cancelado = false;
    (async () => {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data: u } = await supabase
        .from("usuario")
        .select("onboarding_dispensado_em")
        .eq("id", auth.user.id)
        .maybeSingle();
      if (u?.onboarding_dispensado_em) {
        if (!cancelado) {
          setDispensado(true);
          setFeitos({});
        }
        return;
      }
      const { passos } = conteudoOnboarding(membership.role, membership.admin);
      const r = await concluidos(
        supabase,
        membership.idosoId as string,
        auth.user.id,
        membership.role,
        passos.map((p) => p.id),
      );
      if (cancelado) return;
      setEu(auth.user.id);
      setFeitos(r);
      setDispensado(false);
    })();
    return () => {
      cancelado = true;
    };
  }, [membership]);

  if (!membership || feitos === null || dispensado || !eu) return null;

  const { passos } = conteudoOnboarding(membership.role, membership.admin);
  const nome = membership.idosoNome ?? "a pessoa cuidada";
  const total = passos.length;
  const feitosN = passos.filter((p) => feitos[p.id]).length;
  const tudo = feitosN === total;
  const proximo = passos.find((p) => !feitos[p.id]);

  async function dispensar() {
    setDispensado(true);
    const supabase = createClient();
    await supabase
      .from("usuario")
      .update({ onboarding_dispensado_em: new Date().toISOString() })
      .eq("id", eu as string);
  }

  return (
    <Card className="flex flex-col gap-4 border-primary/30">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">
            {tudo ? "Tudo pronto!" : "Primeiros passos"}
          </h2>
          <p className="text-xs text-subtle">
            {tudo
              ? `O Guardião já conhece bem ${nome}. Daqui em diante é só o dia a dia.`
              : `${feitosN} de ${total} feitos. Leva poucos minutos, e cada passo ajuda o cuidado de ${nome}.`}
          </p>
        </div>
        <span className="shrink-0 text-sm font-semibold text-primary" aria-hidden>
          {Math.round((feitosN / total) * 100)}%
        </span>
      </div>

      <div
        className="h-1.5 overflow-hidden rounded-full bg-panel"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={feitosN}
        aria-label="Progresso dos primeiros passos"
      >
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${(feitosN / total) * 100}%` }}
        />
      </div>

      {!tudo && (
        <ul className="flex flex-col gap-1">
          {passos.map((p) => {
            const feito = !!feitos[p.id];
            const eOProximo = proximo?.id === p.id;
            return (
              <li key={p.id}>
                <Link
                  href={p.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-panel",
                    eOProximo && "bg-primary-soft/50",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px]",
                      feito ? "border-primary bg-primary text-white" : "border-line text-transparent",
                    )}
                    aria-hidden
                  >
                    ✓
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm", feito ? "text-subtle line-through" : "text-ink")}>
                      {preencher(p.titulo, nome)}
                    </span>
                    {!feito && <span className="block text-xs text-subtle">{p.dica}</span>}
                  </span>
                  {eOProximo && <span className="shrink-0 text-xs font-medium text-primary">Fazer agora</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(EVENTO_BOAS_VINDAS))}
          className="text-xs text-subtle underline-offset-2 hover:text-ink hover:underline"
        >
          Rever as boas-vindas
        </button>
        <Button variant={tudo ? "primary" : "ghost"} onClick={dispensar} className="h-8 px-3 text-xs">
          {tudo ? "Fechar" : "Dispensar"}
        </Button>
      </div>
    </Card>
  );
}
