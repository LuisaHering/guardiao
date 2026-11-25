"use client";

// "Tirar foto de <nome>", na tela Hoje de quem cuida. Fica fora do checklist: não é obrigação.
// O botão abre a câmera; depois a pessoa vê a foto, escreve uma legenda se quiser e guarda.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button, Input } from "@/components/ui";
import { LIMITE_LEGENDA, prepararFotoDoDia, subirFotoDoDia } from "@/lib/diario";
import { hojeBR } from "@/lib/medicacao";

type Rascunho = { foto: Blob; previa: string };

export function FotoDoDia({ idosoId, nome, recarga }: { idosoId: string; nome: string; recarga: number }) {
  const supabase = createClient();
  const camera = useRef<HTMLInputElement>(null);
  const cartao = useRef<HTMLDivElement>(null);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [legenda, setLegenda] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [guardou, setGuardou] = useState(false);
  const [hojeTem, setHojeTem] = useState(0);
  const [lembretes, setLembretes] = useState<string[]>([]);
  const [versao, setVersao] = useState(0);
  const hoje = hojeBR();

  // Quantas fotos já há hoje, e o que a pessoa cuidada não gosta que envolva foto.
  useEffect(() => {
    let cancelado = false;
    (async () => {
      const [{ count }, { data: prefs }] = await Promise.all([
        supabase
          .from("entrada_diario")
          .select("id", { count: "exact", head: true })
          .eq("idoso_id", idosoId)
          .is("deleted_at", null)
          .not("foto_url", "is", null)
          .gte("data", `${hoje}T00:00:00-03:00`),
        supabase
          .from("preferencia")
          .select("chave, valor")
          .eq("idoso_id", idosoId)
          .eq("categoria", "incomoda")
          .is("deleted_at", null)
          .or("chave.ilike.*foto*,valor.ilike.*foto*"),
      ]);
      if (cancelado) return;
      setHojeTem(count ?? 0);
      setLembretes((prefs ?? []).map((p) => [p.chave, p.valor].filter(Boolean).join(": ")));
    })();
    return () => {
      cancelado = true;
    };
  }, [supabase, idosoId, hoje, recarga, versao]);

  // A prévia é um endereço temporário na memória do celular.
  useEffect(() => {
    if (!rascunho) return;
    return () => URL.revokeObjectURL(rascunho.previa);
  }, [rascunho]);

  // A tela vai até a foto, para o botão de guardar não ficar escondido.
  const aoCarregarPrevia = () => cartao.current?.scrollIntoView({ behavior: "smooth", block: "center" });

  async function escolheu(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = ""; // permite escolher de novo
    if (!arquivo) return;
    setErro(null);
    setGuardou(false);
    setOcupado(true);
    const foto = await prepararFotoDoDia(arquivo);
    setOcupado(false);
    if (!foto) {
      setErro("Não consegui abrir essa foto. Tire outra.");
      return;
    }
    setRascunho({ foto, previa: URL.createObjectURL(foto) });
  }

  async function guardar() {
    if (!rascunho || ocupado) return;
    setOcupado(true);
    setErro(null);
    const caminho = await subirFotoDoDia(supabase, idosoId, rascunho.foto);
    const { data: auth } = await supabase.auth.getUser();
    const falha =
      !caminho ||
      (
        await supabase.from("entrada_diario").insert({
          idoso_id: idosoId,
          autor_id: auth.user?.id ?? null,
          foto_url: caminho,
          legenda: legenda.trim() || null,
        })
      ).error;
    setOcupado(false);
    if (falha) {
      // A foto continua na tela para tentar de novo.
      setErro("Não consegui guardar a foto. Confira a internet e tente de novo.");
      return;
    }
    setRascunho(null);
    setLegenda("");
    setGuardou(true);
    setVersao((v) => v + 1);
  }

  const aviso = lembretes.length > 0 && (
    <p className="rounded-xl bg-warn/10 px-4 py-3 text-base text-ink">
      <span className="font-semibold text-warn">Lembre: </span>
      {lembretes.join(" · ")}
    </p>
  );

  return (
    <section className="flex flex-col gap-3" aria-label={`Foto de ${nome}`}>
      <input ref={camera} type="file" accept="image/*" capture="environment" onChange={escolheu} className="hidden" />

      {!rascunho && (
        <>
          {aviso}
          <button
            type="button"
            disabled={ocupado}
            onClick={() => camera.current?.click()}
            className="flex min-h-[72px] w-full items-center gap-4 rounded-2xl border-2 border-primary bg-card px-4 text-left text-lg font-semibold text-ink hover:bg-panel disabled:opacity-60"
          >
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
              <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3Z" />
              <path d="M12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
            </svg>
            {ocupado ? "Abrindo a foto..." : `Tirar foto de ${nome}`}
          </button>
        </>
      )}

      {rascunho && (
        <div ref={cartao} className="flex scroll-mb-20 scroll-mt-16 flex-col gap-3 rounded-2xl border-2 border-primary bg-card p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={rascunho.previa} onLoad={aoCarregarPrevia} alt="Foto que você tirou" className="max-h-64 w-full rounded-xl object-contain" />
          <label className="flex flex-col gap-1 text-base text-subtle">
            Escrever algo sobre a foto (se quiser)
            <Input value={legenda} maxLength={LIMITE_LEGENDA} onChange={(e) => setLegenda(e.target.value)} className="h-12 text-base" />
          </label>
          <Button variant="primary" disabled={ocupado} onClick={guardar} className="h-14 text-lg">
            {ocupado ? "Guardando..." : "Guardar foto"}
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button disabled={ocupado} onClick={() => camera.current?.click()} className="h-12 text-base">
              Tirar outra
            </Button>
            <Button
              variant="ghost"
              disabled={ocupado}
              onClick={() => {
                setRascunho(null);
                setLegenda("");
                setErro(null);
              }}
              className="h-12 text-base"
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {erro && <p className="text-base text-danger" role="alert">{erro}</p>}

      {!rascunho && (guardou || hojeTem > 0) && (
        <p className="text-base text-subtle" aria-live="polite">
          {guardou && <span className="font-medium text-success">✓ Foto guardada. A família de {nome} já pode ver. </span>}
          {hojeTem > 0 && (
            <Link href="/diario" className="text-primary underline">
              {hojeTem === 1 ? "Ver a foto de hoje" : `Ver as ${hojeTem} fotos de hoje`}
            </Link>
          )}
        </p>
      )}
    </section>
  );
}
