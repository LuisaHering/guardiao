"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Button, Card, Field, Input } from "@/components/ui";

type Med = {
  id: string;
  nome: string;
  dosagem: string | null;
  instrucoes: string | null;
};
type Registro = {
  medicacao_id: string;
  status: string;
  motivo: string | null;
};

const MOTIVOS = ["esqueceu", "recusou", "acabou", "efeito_adverso", "outro"];

function hojeLocal() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export default function MedicacaoPage() {
  const supabase = createClient();
  const membership = useRole();
  const idosoId = membership?.idosoId;

  const [carregando, setCarregando] = useState(true);
  const [meds, setMeds] = useState<Med[]>([]);
  const [registros, setRegistros] = useState<Record<string, Registro>>({});
  const [silencioDias, setSilencioDias] = useState<number | null>(null);
  const [repor, setRepor] = useState<string[]>([]);

  const [nova, setNova] = useState({ nome: "", dosagem: "", instrucoes: "" });
  const [motivoAberto, setMotivoAberto] = useState<string | null>(null);
  const [motivoSel, setMotivoSel] = useState("esqueceu");

  const hoje = hojeLocal();

  const carregar = useCallback(async () => {
    if (!idosoId) {
      setCarregando(false);
      return;
    }
    setCarregando(true);
    const { data: medsData } = await supabase
      .from("medicacao")
      .select("id, nome, dosagem, instrucoes")
      .eq("idoso_id", idosoId)
      .eq("ativo", true)
      .is("deleted_at", null)
      .order("nome");
    const lista = (medsData ?? []) as Med[];
    setMeds(lista);

    const ids = lista.map((m) => m.id);
    if (ids.length > 0) {
      const [{ data: regsHoje }, { data: recentes }] = await Promise.all([
        supabase
          .from("registro_medicacao")
          .select("medicacao_id, status, motivo")
          .in("medicacao_id", ids)
          .eq("data", hoje)
          .is("deleted_at", null),
        supabase
          .from("registro_medicacao")
          .select("registrado_em")
          .in("medicacao_id", ids)
          .is("deleted_at", null)
          .order("registrado_em", { ascending: false })
          .limit(1),
      ]);

      const mapa: Record<string, Registro> = {};
      for (const r of (regsHoje ?? []) as Registro[]) mapa[r.medicacao_id] = r;
      setRegistros(mapa);
      setRepor(
        Object.values(mapa)
          .filter((r) => r.motivo === "acabou")
          .map((r) => lista.find((m) => m.id === r.medicacao_id)?.nome ?? ""),
      );

      const ultimo = recentes?.[0]?.registrado_em as string | undefined;
      if (!ultimo) {
        setSilencioDias(999);
      } else {
        const dias = Math.floor(
          (Date.now() - new Date(ultimo).getTime()) / 86400000,
        );
        setSilencioDias(dias >= 3 ? dias : null);
      }
    } else {
      setRegistros({});
      setSilencioDias(null);
      setRepor([]);
    }
    setCarregando(false);
  }, [supabase, idosoId, hoje]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function registrar(medId: string, status: string, motivo?: string) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("registro_medicacao").upsert(
      {
        medicacao_id: medId,
        data: hoje,
        status,
        motivo: motivo ?? null,
        registrado_por: user!.id,
        registrado_em: new Date().toISOString(),
      },
      { onConflict: "medicacao_id,data" },
    );
    setMotivoAberto(null);
    await carregar();
  }

  async function addMed(e: React.FormEvent) {
    e.preventDefault();
    if (!idosoId || !nova.nome) return;
    await supabase.from("medicacao").insert({
      idoso_id: idosoId,
      nome: nova.nome,
      dosagem: nova.dosagem || null,
      instrucoes: nova.instrucoes || null,
    });
    setNova({ nome: "", dosagem: "", instrucoes: "" });
    await carregar();
  }

  async function removerMed(id: string) {
    await supabase
      .from("medicacao")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    await carregar();
  }

  if (!membership) {
    return (
      <p className="text-sm text-subtle">
        Crie o perfil do idoso primeiro para gerenciar a medicação.
      </p>
    );
  }
  if (carregando) return <p className="text-sm text-subtle">Carregando...</p>;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Medicação</h1>
        <p className="text-sm text-subtle">
          Marque o que foi dado hoje. Não precisa ser na hora, pode preencher
          depois.
        </p>
      </div>

      {silencioDias !== null && (
        <Card className="border-warn/40 bg-warn/10">
          <p className="text-sm font-medium text-warn">
            Faz{" "}
            {silencioDias === 999 ? "vários dias" : `${silencioDias} dias`} que
            ninguém registra a medicação.
          </p>
          <p className="mt-1 text-xs text-subtle">
            Isso é sobre o registro, não sobre o idoso. Vale conferir se está
            tudo bem.
          </p>
        </Card>
      )}

      {repor.length > 0 && (
        <Card className="border-primary/30 bg-primary-soft">
          <p className="text-sm font-medium text-primary">
            Repor: {repor.join(", ")}
          </p>
          <p className="mt-1 text-xs text-primary-ink">
            Marcado como &quot;acabou&quot; hoje.
          </p>
        </Card>
      )}

      <Card className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-ink">Medicação de hoje</h2>
        {meds.length === 0 && (
          <p className="text-sm text-subtle">
            Nenhum remédio ativo. Cadastre abaixo.
          </p>
        )}
        {meds.map((m) => {
          const reg = registros[m.id];
          const aberto = motivoAberto === m.id;
          return (
            <div key={m.id} className="flex flex-col gap-2 border-b border-line pb-3 last:border-0 last:pb-0">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-ink">{m.nome}</p>
                  {m.dosagem && <p className="text-xs text-subtle">{m.dosagem}</p>}
                </div>
                {reg ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-subtle">
                      {reg.status === "dada" ? "✓ deu" : `não deu · ${reg.motivo ?? ""}`}
                    </span>
                    <Button onClick={() => setMotivoAberto(aberto ? null : `edit-${m.id}`)} className="h-8 px-2 text-xs">
                      alterar
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button variant="primary" onClick={() => registrar(m.id, "dada")} className="h-8 px-3 text-xs">
                      Deu
                    </Button>
                    <Button onClick={() => { setMotivoAberto(m.id); setMotivoSel("esqueceu"); }} className="h-8 px-3 text-xs">
                      Não deu
                    </Button>
                  </div>
                )}
              </div>

              {(aberto || motivoAberto === `edit-${m.id}`) && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary" onClick={() => registrar(m.id, "dada")} className="h-8 px-3 text-xs">
                    Deu
                  </Button>
                  <select
                    value={motivoSel}
                    onChange={(e) => setMotivoSel(e.target.value)}
                    className="h-8 rounded-lg border border-line bg-card px-2 text-xs text-ink"
                  >
                    {MOTIVOS.map((mo) => (
                      <option key={mo} value={mo}>
                        {mo.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                  <Button onClick={() => registrar(m.id, "nao_dada", motivoSel)} className="h-8 px-3 text-xs">
                    Não deu
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-ink">Medicamentos</h2>
        {meds.map((m) => (
          <div key={m.id} className="flex items-center justify-between border-b border-line pb-2 last:border-0 last:pb-0">
            <div>
              <p className="text-sm text-ink">{m.nome}</p>
              <p className="text-xs text-subtle">
                {[m.dosagem, m.instrucoes].filter(Boolean).join(" · ")}
              </p>
            </div>
            <Button variant="ghost" onClick={() => removerMed(m.id)} className="h-8 px-2 text-xs">
              Remover
            </Button>
          </div>
        ))}
        <form onSubmit={addMed} className="grid gap-2 sm:grid-cols-4">
          <Input placeholder="Nome (ex: Losartana)" value={nova.nome} onChange={(e) => setNova({ ...nova, nome: e.target.value })} className="sm:col-span-2" />
          <Input placeholder="Dosagem (ex: 50mg)" value={nova.dosagem} onChange={(e) => setNova({ ...nova, dosagem: e.target.value })} />
          <Input placeholder="Instruções" value={nova.instrucoes} onChange={(e) => setNova({ ...nova, instrucoes: e.target.value })} />
          <Button type="submit" className="sm:col-span-4">Adicionar remédio</Button>
        </form>
      </Card>
    </div>
  );
}
