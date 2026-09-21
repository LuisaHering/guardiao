"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Button, Card, Field } from "@/components/ui";

type Sintoma = {
  id: string;
  descricao: string;
  gravidade: number | null;
  duracao_declarada: string | null;
  data: string;
};

const DURACOES: { valor: string; rotulo: string }[] = [
  { valor: "hoje", rotulo: "Comecou hoje" },
  { valor: "alguns_dias", rotulo: "Alguns dias" },
  { valor: "algumas_semanas", rotulo: "Algumas semanas" },
  { valor: "meses_ou_mais", rotulo: "Meses ou mais" },
];

const GRAVIDADES = [1, 2, 3, 4, 5];

function corGravidade(g: number | null) {
  if (g === null) return "bg-panel text-subtle";
  if (g <= 2) return "bg-success/15 text-success";
  if (g === 3) return "bg-warn/15 text-warn";
  return "bg-danger/15 text-danger";
}

function dataHora(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function rotuloDuracao(v: string | null) {
  return DURACOES.find((d) => d.valor === v)?.rotulo ?? null;
}

export default function SintomasPage() {
  const supabase = createClient();
  const membership = useRole();
  const idosoId = membership?.idosoId;

  const [carregando, setCarregando] = useState(true);
  const [sintomas, setSintomas] = useState<Sintoma[]>([]);

  const [descricao, setDescricao] = useState("");
  const [gravidade, setGravidade] = useState(3);
  const [duracao, setDuracao] = useState("hoje");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!idosoId) {
      setCarregando(false);
      return;
    }
    setCarregando(true);
    const { data } = await supabase
      .from("sintoma")
      .select("id, descricao, gravidade, duracao_declarada, data")
      .eq("idoso_id", idosoId)
      .is("deleted_at", null)
      .order("data", { ascending: false })
      .limit(80);
    setSintomas((data ?? []) as Sintoma[]);
    setCarregando(false);
  }, [supabase, idosoId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!idosoId || !descricao.trim()) return;
    setErro(null);
    setSalvando(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("sintoma").insert({
      idoso_id: idosoId,
      autor_id: user!.id,
      descricao: descricao.trim(),
      gravidade,
      duracao_declarada: duracao,
    });
    if (error) {
      setErro(error.message);
      setSalvando(false);
      return;
    }
    setDescricao("");
    setGravidade(3);
    setDuracao("hoje");
    setSalvando(false);
    await carregar();
  }

  async function remover(id: string) {
    await supabase
      .from("sintoma")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    await carregar();
  }

  if (!membership) {
    return (
      <p className="text-sm text-subtle">
        Crie o perfil do idoso primeiro para registrar sintomas.
      </p>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Sintomas</h1>
        <p className="text-sm text-subtle">
          Registre o que {membership.idosoNome} sentiu, com a gravidade e ha quanto
          tempo. O historico ajuda a enxergar padroes ao longo do tempo.
        </p>
      </div>

      <Card className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-ink">Novo sintoma</h2>
        <form onSubmit={salvar} className="flex flex-col gap-3">
          <Field label="O que sentiu">
            <textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Ex: dor de cabeca forte na nuca, tontura ao levantar..."
              rows={2}
              className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            />
          </Field>

          <div>
            <p className="mb-1 text-sm text-subtle">Gravidade</p>
            <div className="flex gap-2">
              {GRAVIDADES.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGravidade(g)}
                  className={`h-10 w-10 rounded-lg border text-sm font-medium transition-colors ${
                    gravidade === g
                      ? "border-primary bg-primary text-white"
                      : "border-line bg-card text-ink hover:bg-panel"
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-subtle">
              1 = leve, 5 = muito forte.
            </p>
          </div>

          <Field label="Ha quanto tempo">
            <select
              value={duracao}
              onChange={(e) => setDuracao(e.target.value)}
              className="h-10 rounded-lg border border-line bg-card px-2 text-sm text-ink"
            >
              {DURACOES.map((d) => (
                <option key={d.valor} value={d.valor}>
                  {d.rotulo}
                </option>
              ))}
            </select>
          </Field>

          {erro && <p className="text-sm text-danger">{erro}</p>}
          <Button variant="primary" type="submit" disabled={salvando}>
            {salvando ? "Salvando..." : "Registrar sintoma"}
          </Button>
        </form>
      </Card>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-ink">Historico</h2>
        {carregando && <p className="text-sm text-subtle">Carregando...</p>}
        {!carregando && sintomas.length === 0 && (
          <p className="text-sm text-subtle">Nenhum sintoma registrado ainda.</p>
        )}
        {sintomas.map((s) => (
          <Card key={s.id} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${corGravidade(
                    s.gravidade,
                  )}`}
                >
                  {s.gravidade ?? "-"}
                </span>
                <span className="text-xs text-subtle">{dataHora(s.data)}</span>
              </div>
              <Button
                variant="ghost"
                onClick={() => remover(s.id)}
                className="h-7 px-2 text-xs"
              >
                Remover
              </Button>
            </div>
            <p className="text-sm text-ink">{s.descricao}</p>
            {rotuloDuracao(s.duracao_declarada) && (
              <p className="text-xs text-subtle">
                {rotuloDuracao(s.duracao_declarada)}
              </p>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
