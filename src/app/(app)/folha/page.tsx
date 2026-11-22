"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Button, Card } from "@/components/ui";
import { IACarregando } from "@/components/ia-carregando";
import { AVISO_PLANO_GRATIS, NOME_PROVEDOR } from "@/lib/ai/nome-provedor";
import type { ConteudoFolha } from "@/lib/folha-cuidado/pdf";

function quando(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function FolhaPage() {
  const supabase = createClient();
  const membership = useRole();
  const idosoId = membership?.idosoId;

  const [carregando, setCarregando] = useState(true);
  const [folha, setFolha] = useState<ConteudoFolha | null>(null);
  const [geradoEm, setGeradoEm] = useState<string | null>(null);
  const [suficiente, setSuficiente] = useState(true);
  const [gerando, setGerando] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!idosoId) {
      setCarregando(false);
      return;
    }
    const { data } = await supabase
      .from("folha_cuidado")
      .select("conteudo, gerado_em")
      .eq("idoso_id", idosoId)
      .order("gerado_em", { ascending: false })
      .limit(1);
    const ultima = data?.[0];
    if (ultima?.conteudo) {
      try {
        setFolha(JSON.parse(ultima.conteudo as string) as ConteudoFolha);
        setGeradoEm(ultima.gerado_em as string);
      } catch {
        // conteúdo ilegível: trata como se não houvesse folha
      }
    }
    setCarregando(false);
  }, [supabase, idosoId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function gerar() {
    if (!idosoId) return;
    setErro(null);
    setGerando(true);
    try {
      const resp = await fetch("/api/ia/folha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idosoId }),
      });
      const json = await resp.json();
      if (!resp.ok) {
        setErro(json.erro ?? "Não consegui gerar a folha.");
      } else {
        setSuficiente(json.suficiente);
        if (json.suficiente) {
          setFolha(json.folha as ConteudoFolha);
          setGeradoEm(json.geradoEm as string);
        }
      }
    } catch {
      setErro("Sem conexão com o servidor. Tente de novo.");
    }
    setGerando(false);
  }

  async function baixar() {
    if (!idosoId) return;
    setErro(null);
    setBaixando(true);
    try {
      const resp = await fetch("/api/folha-cuidado/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idosoId }),
      });
      if (!resp.ok) {
        const json = await resp.json().catch(() => null);
        setErro(json?.erro ?? "Não consegui gerar o PDF.");
      } else {
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "como-cuidar.pdf";
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      setErro("Sem conexão com o servidor. Tente de novo.");
    }
    setBaixando(false);
  }

  if (!membership) {
    return (
      <p className="text-sm text-subtle">
        Crie o perfil do idoso primeiro para gerar a folha de cuidado.
      </p>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Como cuidar de {membership.idosoNome}</h1>
        <p className="text-sm text-subtle">
          Uma folha prática para quem cuida (cuidadora, familiar, quem cobre um turno),
          montada a partir das preferências e da história registradas e confirmadas. Os
          dados de saúde vêm direto do cadastro, sem passar pela IA.
        </p>
      </div>

      <Card className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={gerar} disabled={gerando}>
          {gerando ? "Montando a folha..." : folha ? "Gerar de novo" : "Gerar folha"}
        </Button>
        {folha && (
          <Button onClick={baixar} disabled={baixando}>
            {baixando ? "Preparando o PDF..." : "Baixar PDF"}
          </Button>
        )}
        {gerando && (
          <div className="w-full">
            <IACarregando rotulo="Organizando as preferências..." />
          </div>
        )}
        <p className="w-full text-xs text-subtle">
          As preferências e memórias são enviadas à {NOME_PROVEDOR} para redigir a folha.
          {AVISO_PLANO_GRATIS}
        </p>
        {erro && <p className="w-full text-sm text-danger">{erro}</p>}
      </Card>

      {carregando && <p className="text-sm text-subtle">Carregando...</p>}

      {!suficiente && (
        <Card>
          <p className="text-sm text-ink">Ainda não há preferências suficientes.</p>
          <p className="mt-1 text-sm text-subtle">
            Registre e confirme pelo menos duas em{" "}
            <Link href="/identidade" className="text-primary hover:underline">
              Preferências e história
            </Link>{" "}
            e gere de novo.
          </p>
        </Card>
      )}

      {folha && (
        <div className="flex flex-col gap-4">
          <p className="text-xs text-subtle">
            Gerada em {geradoEm ? quando(geradoEm) : ""}. Revise antes de usar: a IA organiza,
            mas só vale o que foi registrado.
          </p>

          <Card className="border-primary/40 bg-primary-soft">
            <p className="text-sm text-ink">{folha.ia.apresentacao}</p>
            {folha.comoChamar && (
              <p className="mt-2 text-sm font-medium text-ink">
                Gosta de ser chamado de: {folha.comoChamar}
              </p>
            )}
          </Card>

          <Card className="flex flex-col gap-2 border-warn/40 bg-warn/5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-warn">
              Atenção: saúde (do cadastro)
            </h2>
            <p className="text-sm text-ink">
              <span className="font-medium">Alergias:</span>{" "}
              {folha.fatos.alergias.length
                ? folha.fatos.alergias
                    .map(
                      (a) =>
                        `${a.substancia}${a.reacao ? ` (${a.reacao})` : ""}${a.gravidade ? `, gravidade ${a.gravidade}` : ""}`,
                    )
                    .join("; ")
                : "nenhuma registrada"}
            </p>
            <p className="text-sm text-ink">
              <span className="font-medium">Condições:</span>{" "}
              {folha.fatos.condicoes.length ? folha.fatos.condicoes.join("; ") : "nenhuma registrada"}
            </p>
            <p className="text-sm text-ink">
              <span className="font-medium">Medicação em uso:</span>{" "}
              {folha.fatos.medicacoes.length
                ? folha.fatos.medicacoes
                    .map(
                      (m) =>
                        `${m.nome}${m.dosagem ? ` ${m.dosagem}` : ""}${m.instrucoes ? ` (${m.instrucoes})` : ""}`,
                    )
                    .join("; ")
                : "nenhuma registrada"}
            </p>
          </Card>

          {folha.ia.secoes
            .filter((s) => s.itens.length > 0)
            .map((s) => (
              <Card key={s.titulo} className="flex flex-col gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">{s.titulo}</h2>
                <ul className="list-disc pl-5 text-sm text-ink">
                  {s.itens.map((i, k) => (
                    <li key={k}>{i}</li>
                  ))}
                </ul>
              </Card>
            ))}

          {folha.fatos.contatos.length > 0 && (
            <Card className="flex flex-col gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">Quem chamar</h2>
              <ul className="list-disc pl-5 text-sm text-ink">
                {folha.fatos.contatos.map((c, k) => (
                  <li key={k}>
                    {c.nome}
                    {c.relacao ? ` (${c.relacao})` : ""}
                    {c.telefone ? `: ${c.telefone}` : ""}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <p className="text-xs text-subtle">
            Preferências registradas
            {folha.fontes.length ? ` por ${folha.fontes.join(", ")}` : ""} e organizadas por IA.
            Pode estar incompleta ou desatualizada: na dúvida, confirme com a família.
          </p>
        </div>
      )}
    </div>
  );
}
