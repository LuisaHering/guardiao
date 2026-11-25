"use client";

// O que quem cuida faz com papéis: ver os documentos para levar e enviar a foto de um papel.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui";
import { abrirArquivo, enviarPapel, rotuloEnvio, TIPOS_ENVIO, type TipoEnvio } from "@/lib/documentos";

const botao = "flex min-h-[64px] w-full items-center rounded-2xl border-2 border-line bg-card px-4 text-left text-lg font-semibold text-ink hover:bg-panel";

type Doc = { id: string; nome: string; arquivo_url: string; envio: string | null; created_at: string };

/** Documentos marcados pela família para levar nas consultas, em botões grandes. */
export function DocumentosParaLevar({ idosoId }: { idosoId: string }) {
  const supabase = createClient();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const { data, error } = await supabase
        .from("documento")
        .select("id, nome, arquivo_url, envio, created_at")
        .eq("idoso_id", idosoId)
        .eq("levar_consulta", true)
        .is("deleted_at", null)
        .order("nome");
      if (cancelado) return;
      if (error) setErro("Não consegui carregar os documentos. Confira a internet.");
      setDocs((data ?? []) as Doc[]);
    })();
    return () => {
      cancelado = true;
    };
  }, [supabase, idosoId]);

  if (!docs) return <p className="text-base text-subtle">Carregando...</p>;

  return (
    <div className="flex flex-col gap-2">
      {erro && <p className="text-base text-danger" role="alert">{erro}</p>}
      {!erro && docs.length === 0 && (
        <p className="rounded-2xl border border-line bg-card p-4 text-base text-ink">
          Nenhum documento marcado ainda. Peça à família para marcar a carteirinha do plano e o RG como &quot;levar nas consultas&quot;.
        </p>
      )}
      {docs.map((d) => (
        <button key={d.id} type="button" className={botao} onClick={async () => setErro(await abrirArquivo(supabase, "documentos", d.arquivo_url))}>
          {d.nome}
        </button>
      ))}
    </div>
  );
}

/** Escolhe o que é o papel e tira a foto. */
export function EnviarFoto({ idosoId, tipos, onEnviado }: { idosoId: string; tipos?: TipoEnvio[]; onEnviado?: () => void }) {
  const [enviando, setEnviando] = useState<TipoEnvio | null>(null);
  const [mensagem, setMensagem] = useState<{ ok: boolean; texto: string } | null>(null);

  async function escolher(tipo: TipoEnvio, arquivo: File) {
    setEnviando(tipo);
    setMensagem(null);
    const falha = await enviarPapel(createClient(), idosoId, arquivo, tipo);
    setEnviando(null);
    setMensagem(
      falha ? { ok: false, texto: falha } : { ok: true, texto: `${rotuloEnvio(tipo)} enviado. A família já pode ver.` },
    );
    if (!falha) onEnviado?.();
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-base text-subtle">O que é o papel? Toque e tire a foto.</p>
      {TIPOS_ENVIO.filter((t) => !tipos || tipos.includes(t.valor)).map((t) => (
        <label key={t.valor} className={`${botao} cursor-pointer justify-between ${enviando ? "pointer-events-none opacity-60" : ""}`}>
          {t.rotulo}
          <span className="text-sm font-normal text-subtle">{enviando === t.valor ? "Enviando..." : "tirar foto"}</span>
          <input
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            className="sr-only"
            disabled={!!enviando}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) escolher(t.valor, f);
            }}
          />
        </label>
      ))}
      {mensagem && (
        <p className={`rounded-2xl p-3 text-center text-base font-medium ${mensagem.ok ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`} role="status">
          {mensagem.ok ? "✓ " : ""}
          {mensagem.texto}
        </p>
      )}
    </div>
  );
}

/** A tela de Documentos de quem cuida: sem pastas. */
export function DocumentosCuidadora({ idosoId, nome }: { idosoId: string; nome: string }) {
  const supabase = createClient();
  const [enviados, setEnviados] = useState<Doc[]>([]);
  const [versao, setVersao] = useState(0);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const { data } = await supabase
        .from("documento")
        .select("id, nome, arquivo_url, envio, created_at")
        .eq("idoso_id", idosoId)
        .eq("autor_id", auth.user?.id ?? "")
        .not("envio", "is", null)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(10);
      if (!cancelado) setEnviados((data ?? []) as Doc[]);
    })();
    return () => {
      cancelado = true;
    };
  }, [supabase, idosoId, versao]);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-5">
      <h1 className="text-2xl font-semibold text-ink">Documentos de {nome}</h1>
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-ink">Para levar</h2>
        <DocumentosParaLevar idosoId={idosoId} />
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-ink">Enviar foto de um papel</h2>
        <EnviarFoto idosoId={idosoId} onEnviado={() => setVersao((v) => v + 1)} />
      </section>
      {enviados.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-ink">O que você enviou</h2>
          {erro && <p className="text-base text-danger" role="alert">{erro}</p>}
          {enviados.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-2 rounded-2xl bg-panel px-4 py-2">
              <span className="text-base text-ink">{d.nome}</span>
              <Button className="h-11" onClick={async () => setErro(await abrirArquivo(supabase, "documentos", d.arquivo_url))}>Ver</Button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
