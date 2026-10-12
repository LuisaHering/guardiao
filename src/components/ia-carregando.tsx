"use client";

import { useEffect, useState } from "react";

/**
 * Indicador para operacoes de IA, que podem levar quase um minuto.
 * Monte o componente so enquanto a operacao roda: ao desmontar o cronometro
 * zera sozinho. Mostra os segundos para a pessoa ver que algo esta andando.
 */
export function IACarregando({ rotulo }: { rotulo: string }) {
  const [segundos, setSegundos] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 rounded-lg bg-panel px-3 py-2.5 text-sm"
    >
      <span
        className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent"
        aria-hidden
      />
      <span className="text-ink">
        {rotulo}{" "}
        <span className="text-subtle">
          {segundos}s{" "}
          {segundos < 60
            ? "· pode levar ate 1 minuto, nao feche a tela"
            : "· demorando mais que o normal, aguarde mais um pouco"}
        </span>
      </span>
    </div>
  );
}
