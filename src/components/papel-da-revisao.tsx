"use client";

// O arquivo ao lado do formulário de correção, para comparar sem sair da tela.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function PapelDaRevisao({ bucket, caminho }: { bucket: "documentos" | "exames"; caminho: string }) {
  const [link, setLink] = useState<{ de: string; url: string } | null>(null);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    let cancelado = false;
    createClient()
      .storage.from(bucket)
      .createSignedUrl(caminho, 3600)
      .then(({ data }) => {
        if (cancelado) return;
        if (data?.signedUrl) setLink({ de: caminho, url: data.signedUrl });
        else setFalhou(true);
      });
    return () => {
      cancelado = true;
    };
  }, [bucket, caminho]);

  const url = link && link.de === caminho ? link.url : null;
  if (falhou) return <p className="text-sm text-danger" role="alert">Não consegui abrir o arquivo.</p>;
  if (!url) return <p className="text-sm text-subtle">Abrindo o arquivo...</p>;
  const ehPdf = caminho.toLowerCase().endsWith(".pdf");

  return (
    <div className="flex flex-col gap-2">
      {ehPdf ? (
        <iframe src={url} title="O arquivo" className="h-[55vh] w-full rounded-lg border border-line bg-white lg:h-[75vh]" />
      ) : (
        <div className="max-h-[55vh] overflow-auto rounded-lg border border-line bg-panel lg:max-h-[75vh]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="O arquivo enviado" className="w-full" />
        </div>
      )}
      <a href={url} target="_blank" rel="noopener" className="text-sm text-primary hover:underline">
        Abrir em tamanho grande
      </a>
    </div>
  );
}
