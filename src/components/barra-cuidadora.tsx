"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useNaoLidos } from "@/components/sino-alertas";
import { cn } from "@/lib/cn";

function Icone({ caminhos }: { caminhos: string[] }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {caminhos.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** No celular de quem cuida, três botões grandes no lugar do menu longo. */
export function BarraCuidadora({ menuAberto, onMais }: { menuAberto: boolean; onMais: (abrir: boolean) => void }) {
  const pathname = usePathname();
  const naoLidos = useNaoLidos();
  const item = (ativo: boolean) =>
    cn("flex min-h-16 flex-col items-center justify-center gap-0.5 text-sm font-medium", ativo ? "text-primary" : "text-subtle");
  const noInicio = !menuAberto && (pathname === "/painel" || pathname.startsWith("/hoje"));

  return (
    <nav aria-label="Principal" className="fixed inset-x-0 bottom-0 z-40 grid h-16 grid-cols-3 border-t border-line bg-card md:hidden">
      <Link href="/painel" onClick={() => onMais(false)} aria-current={noInicio ? "page" : undefined} className={item(noInicio)}>
        <Icone caminhos={["m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M9 22v-8h6v8"]} />
        Hoje
      </Link>
      <Link
        href="/alertas"
        onClick={() => onMais(false)}
        aria-label={naoLidos > 0 ? `Avisos: ${naoLidos} não lido${naoLidos > 1 ? "s" : ""}` : "Avisos"}
        className={cn(item(!menuAberto && pathname === "/alertas"), "relative")}
      >
        <span className="relative">
          <Icone caminhos={["M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9", "M10.3 21a1.94 1.94 0 0 0 3.4 0"]} />
          {naoLidos > 0 && (
            <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
              {naoLidos > 9 ? "9+" : naoLidos}
            </span>
          )}
        </span>
        Avisos
      </Link>
      <button type="button" aria-expanded={menuAberto} onClick={() => onMais(!menuAberto)} className={item(menuAberto)}>
        <Icone caminhos={["M4 7h16", "M4 12h16", "M4 17h16"]} />
        Mais
      </button>
    </nav>
  );
}
