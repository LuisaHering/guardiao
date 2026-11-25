"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";

/** Avisa o sino de que o estado de leitura mudou (ex: ao marcar como lido na tela). */
export const EVENTO_ALERTAS = "guardiao:alertas";

/** Quantos avisos meus estão sem ler. Reconta ao trocar de tela e quando um aviso muda. */
export function useNaoLidos() {
  const pathname = usePathname();
  const [naoLidos, setNaoLidos] = useState(0);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { count } = await supabase
        .from("alerta_destinatario")
        .select("id", { count: "exact", head: true })
        .eq("usuario_id", user.id)
        .is("lido_em", null);
      if (!cancelado) setNaoLidos(count ?? 0);
    })();
    return () => {
      cancelado = true;
    };
  }, [pathname, versao]);

  useEffect(() => {
    const recontar = () => setVersao((v) => v + 1);
    window.addEventListener(EVENTO_ALERTAS, recontar);
    return () => window.removeEventListener(EVENTO_ALERTAS, recontar);
  }, []);

  return naoLidos;
}

export function SinoAlertas() {
  const membership = useRole();
  const idosoId = membership?.idosoId;
  const naoLidos = useNaoLidos();

  // O silêncio de registro não tem agendador: é verificado quando alguém abre o app.
  useEffect(() => {
    if (!idosoId) return;
    const cliente = createClient();
    Promise.all([
      cliente.rpc("gerar_alertas_silencio", { p_idoso: idosoId }),
      cliente.rpc("gerar_alertas_exames", { p_idoso: idosoId }),
    ]).then(() => window.dispatchEvent(new Event(EVENTO_ALERTAS)));
  }, [idosoId]);

  return (
    <Link
      href="/alertas"
      className="relative flex h-9 w-9 items-center justify-center rounded-lg text-subtle hover:bg-panel hover:text-ink"
      aria-label={
        naoLidos > 0
          ? `Alertas: ${naoLidos} não lido${naoLidos > 1 ? "s" : ""}`
          : "Alertas"
      }
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {naoLidos > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
          {naoLidos > 9 ? "9+" : naoLidos}
        </span>
      )}
    </Link>
  );
}
