"use client";

import { useCallback, useEffect, useState } from "react";
import { useRole } from "@/lib/role-context";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, Field, Input } from "@/components/ui";
import { roleLabels, type Role } from "@/lib/roles";

type Convite = {
  id: string;
  email: string;
  papel: string;
  token: string;
  aceito_em: string | null;
};

export default function RedePage() {
  const membership = useRole();
  const supabase = createClient();

  const [convites, setConvites] = useState<Convite[]>([]);
  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState<Role>("cuidador");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!membership?.idosoId) return;
    const { data } = await supabase
      .from("convite")
      .select("id, email, papel, token, aceito_em")
      .eq("idoso_id", membership.idosoId)
      .order("created_at", { ascending: false });
    setConvites((data ?? []) as Convite[]);
  }, [supabase, membership?.idosoId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function convidar(e: React.FormEvent) {
    e.preventDefault();
    if (!membership?.idosoId) return;
    setErro(null);
    setOcupado(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const token = crypto.randomUUID();
    const expira = new Date();
    expira.setDate(expira.getDate() + 7);
    const { error } = await supabase.from("convite").insert({
      idoso_id: membership.idosoId,
      email,
      papel,
      admin: false,
      token,
      criado_por: user!.id,
      expira_em: expira.toISOString(),
    });
    if (error) setErro(error.message);
    setEmail("");
    setOcupado(false);
    await carregar();
  }

  function linkDe(token: string) {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/convite/${token}`;
  }

  if (!membership) return null;
  if (!membership.admin) {
    return (
      <p className="text-sm text-subtle">
        Só administradores acessam Rede e acessos.
      </p>
    );
  }

  const pendentes = convites.filter((c) => !c.aceito_em);
  const aceitos = convites.filter((c) => c.aceito_em);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Rede e acessos</h1>
        <p className="text-sm text-subtle">
          Convide quem ajuda a cuidar de {membership.idosoNome}.
        </p>
      </div>

      <Card className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-ink">Novo convite</h2>
        <form onSubmit={convidar} className="grid gap-3 sm:grid-cols-3">
          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="pessoa@email.com"
              required
            />
          </Field>
          <Field label="Papel">
            <select
              value={papel}
              onChange={(e) => setPapel(e.target.value as Role)}
              className="h-10 rounded-lg border border-line bg-card px-2 text-sm text-ink"
            >
              <option value="cuidador">Cuidador</option>
              <option value="familiar">Familiar</option>
            </select>
          </Field>
          <div className="flex items-end">
            <Button variant="primary" type="submit" disabled={ocupado}>
              {ocupado ? "Criando..." : "Criar convite"}
            </Button>
          </div>
        </form>
        {erro && <p className="text-sm text-danger">{erro}</p>}
        <p className="text-xs text-subtle">
          O convite gera um link. Copie e envie para a pessoa (por enquanto o
          envio é manual, não por email automático).
        </p>
      </Card>

      {pendentes.length > 0 && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-ink">Convites pendentes</h2>
          {pendentes.map((c) => (
            <div key={c.id} className="flex flex-col gap-1 border-b border-line pb-3 last:border-0 last:pb-0">
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink">{c.email}</span>
                <span className="text-xs text-subtle">{roleLabels[c.papel as Role] ?? c.papel}</span>
              </div>
              <div className="flex items-center gap-2">
                <Input readOnly value={linkDe(c.token)} className="text-xs" />
                <Button
                  onClick={() => navigator.clipboard?.writeText(linkDe(c.token))}
                  className="h-10 whitespace-nowrap px-3 text-xs"
                >
                  Copiar
                </Button>
              </div>
            </div>
          ))}
        </Card>
      )}

      {aceitos.length > 0 && (
        <Card className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-ink">Convites aceitos</h2>
          {aceitos.map((c) => (
            <div key={c.id} className="flex items-center justify-between text-sm">
              <span className="text-ink">{c.email}</span>
              <span className="text-xs text-subtle">
                {roleLabels[c.papel as Role] ?? c.papel} · aceito
              </span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
