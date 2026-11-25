"use client";

// Fotos do dia no painel da família. Sem aviso a cada foto: elas aparecem aqui.

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui";
import { linksDasFotos } from "@/lib/diario";
import { abrirArquivo } from "@/lib/documentos";

type Foto = { id: string; data: string; legenda: string | null; foto_url: string; autor_id: string | null };

const QUANTAS = 6;

const quando = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export function FotosRecentes({ idosoId }: { idosoId: string }) {
  const supabase = createClient();
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const { data } = await supabase
        .from("entrada_diario")
        .select("id, data, legenda, foto_url, autor_id")
        .eq("idoso_id", idosoId)
        .is("deleted_at", null)
        .not("foto_url", "is", null)
        .order("data", { ascending: false })
        .limit(QUANTAS);
      const lista = (data ?? []) as Foto[];
      const ids = [...new Set(lista.map((f) => f.autor_id).filter(Boolean))] as string[];
      const [mapa, { data: us }] = await Promise.all([
        linksDasFotos(supabase, lista.map((f) => f.foto_url)),
        ids.length ? supabase.from("usuario").select("id, nome").in("id", ids) : Promise.resolve({ data: [] }),
      ]);
      if (cancelado) return;
      setFotos(lista);
      setLinks(mapa);
      setNomes(Object.fromEntries((us ?? []).map((u) => [u.id as string, ((u.nome as string) ?? "").split(" ")[0]])));
    })();
    return () => {
      cancelado = true;
    };
  }, [supabase, idosoId]);

  // Sem foto nenhuma, o painel não ganha um cartão vazio.
  if (fotos.length === 0) return null;

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">Fotos recentes</h2>
        <Link href="/diario" className="text-xs text-primary hover:underline">
          Ver o diário
        </Link>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {fotos.map((f) => {
          const autor = f.autor_id ? nomes[f.autor_id] : "";
          return (
            <li key={f.id} className="flex flex-col gap-1">
              <button
                type="button"
                onClick={async () => setErro(await abrirArquivo(supabase, "diario", f.foto_url))}
                className="aspect-square overflow-hidden rounded-lg border border-line bg-panel"
                aria-label={`Abrir a foto de ${quando(f.data)}${f.legenda ? `: ${f.legenda}` : ""}`}
              >
                {links[f.foto_url] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={links[f.foto_url]} alt="" className="h-full w-full object-cover" />
                )}
              </button>
              {f.legenda && <p className="line-clamp-2 text-xs text-ink">{f.legenda}</p>}
              <p className="text-[11px] text-subtle">
                {quando(f.data)}
                {autor ? ` · ${autor}` : ""}
              </p>
            </li>
          );
        })}
      </ul>
      {erro && <p className="mt-2 text-sm text-danger" role="alert">{erro}</p>}
    </Card>
  );
}
