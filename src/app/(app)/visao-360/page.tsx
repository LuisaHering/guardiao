"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Badge, Button, Card } from "@/components/ui";
import { IACarregando } from "@/components/ia-carregando";
import { AVISO_PLANO_GRATIS, NOME_PROVEDOR } from "@/lib/ai/nome-provedor";

type Relato = { quem: string; papel: string; relato: string; data: string | null };

type Visao = {
  resumo: string;
  saude: { titulo: string; detalhe: string; fonte: string; data: string | null }[];
  medicacao: { situacao: string; pontos: string[] };
  humor: string | null;
  divergencias: { tema: string; relatos: Relato[]; observacao: string }[];
  lacunas: string[];
  base?: Record<string, number>;
};

type Pauta = { id: string; titulo: string };

const FONTE: Record<string, string> = {
  condicao: "Condição",
  alergia: "Alergia",
  sintoma: "Sintoma",
  exame: "Exame",
  consulta: "Consulta",
  diario: "Diário",
  medicacao: "Medicação",
  humor: "Humor",
};

function quando(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dataBr(iso: string | null) {
  return iso ? iso.split("-").reverse().join("/") : "";
}

export default function Visao360Page() {
  const supabase = createClient();
  const membership = useRole();
  const idosoId = membership?.idosoId;

  const [carregando, setCarregando] = useState(true);
  const [visao, setVisao] = useState<Visao | null>(null);
  const [geradoEm, setGeradoEm] = useState<string | null>(null);
  const [suficiente, setSuficiente] = useState(true);
  const [pauta, setPauta] = useState<Pauta[]>([]);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!idosoId) {
      setCarregando(false);
      return;
    }
    const [{ data: v }, { data: p }] = await Promise.all([
      supabase
        .from("visao_360")
        .select("conteudo, gerado_em")
        .eq("idoso_id", idosoId)
        .order("gerado_em", { ascending: false })
        .limit(1),
      // A pauta médica é lida de sua própria tabela, nunca copiada para dentro do texto da IA.
      supabase
        .from("item_pauta")
        .select("id, titulo")
        .eq("idoso_id", idosoId)
        .is("resolvido_em", null)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    const ultima = v?.[0];
    if (ultima?.conteudo) {
      try {
        setVisao(JSON.parse(ultima.conteudo as string) as Visao);
        setGeradoEm(ultima.gerado_em as string);
      } catch {
        // conteúdo ilegível: trata como se não houvesse visão gerada
      }
    }
    setPauta((p ?? []) as Pauta[]);
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
      const resp = await fetch("/api/ia/visao-360", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idosoId }),
      });
      const json = await resp.json();
      if (!resp.ok) {
        setErro(json.erro ?? "Não consegui gerar a visão 360.");
      } else {
        setSuficiente(json.suficiente);
        if (json.suficiente) {
          setVisao(json.visao as Visao);
          setGeradoEm(json.geradoEm as string);
        }
        await carregar();
      }
    } catch {
      setErro("Sem conexão com o servidor. Tente de novo.");
    }
    setGerando(false);
  }

  if (!membership) {
    return (
      <p className="text-sm text-subtle">
        Crie o perfil do idoso primeiro para ver a visão 360.
      </p>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Visão 360</h1>
        <p className="text-sm text-subtle">
          Um panorama atual de {membership.idosoNome}, montado a partir de tudo o que foi
          registrado: saúde, medicação, humor, consultas e exames. Quando duas pessoas
          registram coisas diferentes, a diferença aparece aqui, sem que o sistema decida
          quem tem razão.
        </p>
      </div>

      <Card className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={gerar} disabled={gerando}>
          {gerando ? "Montando o panorama..." : visao ? "Gerar de novo" : "Gerar visão 360"}
        </Button>
        {gerando && (
          <div className="w-full">
            <IACarregando rotulo="Reunindo os registros..." />
          </div>
        )}
        <p className="w-full text-xs text-subtle">
          Os registros são enviados à {NOME_PROVEDOR} para montar o panorama.
          {AVISO_PLANO_GRATIS}
        </p>
        {erro && <p className="w-full text-sm text-danger">{erro}</p>}
      </Card>

      {carregando && <p className="text-sm text-subtle">Carregando...</p>}

      {!suficiente && (
        <Card>
          <p className="text-sm text-ink">Ainda não há registros suficientes.</p>
          <p className="mt-1 text-sm text-subtle">
            Registre sintomas, diário, medicação, consultas ou exames e gere de novo.
          </p>
        </Card>
      )}

      {visao && (
        <div className="flex flex-col gap-4">
          <p className="text-xs text-subtle">
            Gerada em {geradoEm ? quando(geradoEm) : ""}
            {visao.base
              ? ` · ${Object.entries({
                  sintomas: ["sintoma", "sintomas"],
                  diario: ["entrada de diário", "entradas de diário"],
                  registros_medicacao: ["registro de medicação", "registros de medicação"],
                  consultas: ["consulta", "consultas"],
                  exames: ["exame", "exames"],
                  humor: ["registro de humor", "registros de humor"],
                })
                  .filter(([k]) => (visao.base?.[k] ?? 0) > 0)
                  .map(([k, [um, varios]]) => {
                    const n = visao.base?.[k] ?? 0;
                    return `${n} ${n === 1 ? um : varios}`;
                  })
                  .join(", ")}`
              : ""}
          </p>

          <Card>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">Resumo</h2>
            <p className="mt-1 text-sm text-ink">{visao.resumo}</p>
          </Card>

          {visao.saude.length > 0 && (
            <Card className="flex flex-col gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">Saúde</h2>
              {visao.saude.map((s, i) => (
                <div key={i} className="flex flex-col gap-0.5 border-t border-line pt-3 first:border-0 first:pt-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-ink">{s.titulo}</p>
                    <Badge tone="neutral">
                      {FONTE[s.fonte] ?? s.fonte}
                      {s.data ? ` · ${dataBr(s.data)}` : ""}
                    </Badge>
                  </div>
                  <p className="text-sm text-subtle">{s.detalhe}</p>
                </div>
              ))}
            </Card>
          )}

          <Card className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">Medicação</h2>
            <p className="text-sm text-ink">{visao.medicacao.situacao}</p>
            {visao.medicacao.pontos.length > 0 && (
              <ul className="list-disc pl-5 text-sm text-subtle">
                {visao.medicacao.pontos.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            )}
          </Card>

          {visao.humor && (
            <Card>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">Humor</h2>
              <p className="mt-1 text-sm text-ink">{visao.humor}</p>
            </Card>
          )}

          {visao.divergencias.length > 0 && (
            <Card className="flex flex-col gap-4 border-warn/40 bg-warn/5">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-warn">
                  Relatos que não coincidem
                </h2>
                <p className="mt-1 text-xs text-subtle">
                  Os dois lados estão registrados. O sistema mostra a diferença e não decide quem
                  tem razão: vale conversar com as pessoas envolvidas e, se for o caso, com o médico.
                </p>
              </div>
              {visao.divergencias.map((d, i) => (
                <div key={i} className="flex flex-col gap-2 border-t border-line pt-3 first:border-0 first:pt-0">
                  <p className="text-sm font-medium text-ink">{d.tema}</p>
                  {d.relatos.map((r, j) => (
                    <p key={j} className="text-sm text-ink">
                      <span className="font-medium">
                        {r.quem} ({r.papel})
                        {r.data ? ` · ${dataBr(r.data)}` : ""}:
                      </span>{" "}
                      {r.relato}
                    </p>
                  ))}
                  <p className="text-xs text-subtle">{d.observacao}</p>
                </div>
              ))}
            </Card>
          )}

          {visao.lacunas.length > 0 && (
            <Card className="flex flex-col gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">
                O que ainda não dá para saber
              </h2>
              <ul className="list-disc pl-5 text-sm text-subtle">
                {visao.lacunas.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </Card>
          )}

          <p className="text-xs text-subtle">
            Panorama feito por IA a partir dos registros. Não é diagnóstico nem orientação
            médica: confira com quem convive com a pessoa e leve as dúvidas ao médico.
          </p>
        </div>
      )}

      <Card className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">
          Pauta médica ({pauta.length} {pauta.length === 1 ? "item em aberto" : "itens em aberto"})
        </h2>
        {pauta.length === 0 ? (
          <p className="text-sm text-subtle">Nenhum item aguardando a próxima consulta.</p>
        ) : (
          <ul className="list-disc pl-5 text-sm text-ink">
            {pauta.map((p) => (
              <li key={p.id}>{p.titulo}</li>
            ))}
          </ul>
        )}
        <p className="text-xs text-subtle">
          A pauta vem direto da lista própria dela e não é reescrita pela IA.
        </p>
      </Card>
    </div>
  );
}
