"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Button, Card, Field } from "@/components/ui";

type Entrada = {
  id: string;
  data: string;
  alimentacao: string | null;
  ocorrencias: string | null;
  foto_url: string | null;
  autor_id: string | null;
};

function dataHora(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function DiarioPage() {
  const supabase = createClient();
  const membership = useRole();
  const idosoId = membership?.idosoId;

  const [carregando, setCarregando] = useState(true);
  const [entradas, setEntradas] = useState<Entrada[]>([]);
  const [fotos, setFotos] = useState<Record<string, string>>({});

  const [alimentacao, setAlimentacao] = useState("");
  const [ocorrencias, setOcorrencias] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!idosoId) {
      setCarregando(false);
      return;
    }
    setCarregando(true);
    const { data } = await supabase
      .from("entrada_diario")
      .select("id, data, alimentacao, ocorrencias, foto_url, autor_id")
      .eq("idoso_id", idosoId)
      .is("deleted_at", null)
      .order("data", { ascending: false })
      .limit(60);
    const lista = (data ?? []) as Entrada[];
    setEntradas(lista);

    // URLs assinadas para as fotos (bucket privado).
    const comFoto = lista.filter((e) => e.foto_url);
    if (comFoto.length > 0) {
      const mapa: Record<string, string> = {};
      await Promise.all(
        comFoto.map(async (e) => {
          const { data: assinada } = await supabase.storage
            .from("diario")
            .createSignedUrl(e.foto_url as string, 3600);
          if (assinada?.signedUrl) mapa[e.id] = assinada.signedUrl;
        }),
      );
      setFotos(mapa);
    } else {
      setFotos({});
    }
    setCarregando(false);
  }, [supabase, idosoId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!idosoId) return;
    if (!alimentacao.trim() && !ocorrencias.trim() && !arquivo) {
      setErro("Escreva algo ou anexe uma foto antes de salvar.");
      return;
    }
    setErro(null);
    setSalvando(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let caminho: string | null = null;
    if (arquivo) {
      const ext = arquivo.name.split(".").pop() || "jpg";
      caminho = `${idosoId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErro } = await supabase.storage
        .from("diario")
        .upload(caminho, arquivo, { upsert: false });
      if (upErro) {
        setErro(`Nao consegui subir a foto: ${upErro.message}`);
        setSalvando(false);
        return;
      }
    }

    const { error } = await supabase.from("entrada_diario").insert({
      idoso_id: idosoId,
      autor_id: user!.id,
      alimentacao: alimentacao.trim() || null,
      ocorrencias: ocorrencias.trim() || null,
      foto_url: caminho,
    });
    if (error) {
      setErro(error.message);
      setSalvando(false);
      return;
    }
    setAlimentacao("");
    setOcorrencias("");
    setArquivo(null);
    setSalvando(false);
    await carregar();
  }

  async function remover(id: string) {
    await supabase
      .from("entrada_diario")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    await carregar();
  }

  if (!membership) {
    return (
      <p className="text-sm text-subtle">
        Crie o perfil do idoso primeiro para usar o diario.
      </p>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Diario do cuidador</h1>
        <p className="text-sm text-subtle">
          Como foi o dia de {membership.idosoNome}: alimentacao, ocorrencias e uma
          foto, se quiser. Cada registro guarda quem escreveu e quando.
        </p>
      </div>

      <Card className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-ink">Nova entrada</h2>
        <form onSubmit={salvar} className="flex flex-col gap-3">
          <Field label="Alimentacao">
            <textarea
              value={alimentacao}
              onChange={(e) => setAlimentacao(e.target.value)}
              placeholder="O que comeu, como foi o apetite..."
              rows={2}
              className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            />
          </Field>
          <Field label="Ocorrencias">
            <textarea
              value={ocorrencias}
              onChange={(e) => setOcorrencias(e.target.value)}
              placeholder="Humor, sono, quedas, visitas, qualquer coisa que valha registrar..."
              rows={3}
              className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            />
          </Field>
          <Field label="Foto do dia (opcional)">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              className="text-sm text-subtle file:mr-3 file:rounded-lg file:border file:border-line file:bg-panel file:px-3 file:py-2 file:text-sm file:text-ink"
            />
          </Field>
          {erro && <p className="text-sm text-danger">{erro}</p>}
          <Button variant="primary" type="submit" disabled={salvando}>
            {salvando ? "Salvando..." : "Salvar entrada"}
          </Button>
        </form>
      </Card>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-ink">Registros recentes</h2>
        {carregando && <p className="text-sm text-subtle">Carregando...</p>}
        {!carregando && entradas.length === 0 && (
          <p className="text-sm text-subtle">Nenhuma entrada ainda.</p>
        )}
        {entradas.map((e) => (
          <Card key={e.id} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-subtle">{dataHora(e.data)}</span>
              <Button
                variant="ghost"
                onClick={() => remover(e.id)}
                className="h-7 px-2 text-xs"
              >
                Remover
              </Button>
            </div>
            {e.alimentacao && (
              <p className="text-sm text-ink">
                <span className="text-subtle">Alimentacao: </span>
                {e.alimentacao}
              </p>
            )}
            {e.ocorrencias && (
              <p className="text-sm text-ink">
                <span className="text-subtle">Ocorrencias: </span>
                {e.ocorrencias}
              </p>
            )}
            {e.foto_url && fotos[e.id] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={fotos[e.id]}
                alt="Foto do dia"
                className="mt-1 max-h-64 w-fit rounded-lg border border-line object-cover"
              />
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
