"use client";

// O que a própria pessoa enviou, para abrir de novo ou apagar o que foi errado.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui";
import { ApagarEnvio } from "@/components/apagar-envio";
import { EVENTO_ENVIOS } from "@/lib/apagar";
import { abrirArquivo } from "@/lib/documentos";

type Envio = { id: string; nome: string; arquivo_url: string };

/** `versao` muda quando a tela envia um papel novo. */
export function MeusEnvios({ idosoId, versao = 0 }: { idosoId: string; versao?: number }) {
  const [enviados, setEnviados] = useState<Envio[]>([]);
  const [recarga, setRecarga] = useState(0);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const atualizar = () => setRecarga((v) => v + 1);
    window.addEventListener(EVENTO_ENVIOS, atualizar);
    window.addEventListener("focus", atualizar);
    return () => {
      window.removeEventListener(EVENTO_ENVIOS, atualizar);
      window.removeEventListener("focus", atualizar);
    };
  }, []);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      const { data } = await supabase
        .from("documento")
        .select("id, nome, arquivo_url")
        .eq("idoso_id", idosoId)
        .eq("autor_id", auth.user?.id ?? "")
        .not("envio", "is", null)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(10);
      if (!cancelado) setEnviados((data ?? []) as Envio[]);
    })();
    return () => {
      cancelado = true;
    };
  }, [idosoId, versao, recarga]);

  if (!enviados.length) return null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold text-ink">O que você enviou</h2>
      {erro && <p className="text-base text-danger" role="alert">{erro}</p>}
      {enviados.map((d) => (
        <div key={d.id} className="flex flex-col gap-2 rounded-2xl bg-panel px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-base font-medium text-ink">{d.nome}</span>
            <Button className="h-11 text-base" onClick={async () => setErro(await abrirArquivo(createClient(), "documentos", d.arquivo_url))}>
              Ver
            </Button>
          </div>
          <ApagarEnvio documentoId={d.id} rotulo="Mandei errado, apagar" />
        </div>
      ))}
    </section>
  );
}
