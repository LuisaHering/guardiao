"use client";

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Button, Card } from "@/components/ui";

type Token = { id: string; token: string; created_at: string };

export default function EmergenciaAdminPage() {
  const supabase = createClient();
  const membership = useRole();
  const idosoId = membership?.idosoId;

  const [carregando, setCarregando] = useState(true);
  const [token, setToken] = useState<Token | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const link =
    token && typeof window !== "undefined"
      ? `${window.location.origin}/emergencia/${token.token}`
      : "";

  const carregar = useCallback(async () => {
    if (!idosoId) {
      setCarregando(false);
      return;
    }
    setCarregando(true);
    const { data } = await supabase
      .from("emergencia_token")
      .select("id, token, created_at")
      .eq("idoso_id", idosoId)
      .eq("ativo", true)
      .is("revogado_em", null)
      .order("created_at", { ascending: false })
      .limit(1);
    setToken((data?.[0] as Token) ?? null);
    setCarregando(false);
  }, [supabase, idosoId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    if (!link) {
      setQr(null);
      return;
    }
    QRCode.toDataURL(link, { width: 320, margin: 1 })
      .then(setQr)
      .catch(() => setQr(null));
  }, [link]);

  async function gerar() {
    if (!idosoId) return;
    setOcupado(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("emergencia_token").insert({
      idoso_id: idosoId,
      token: crypto.randomUUID(),
      criado_por: user!.id,
    });
    setOcupado(false);
    await carregar();
  }

  async function revogar() {
    if (!token) return;
    setOcupado(true);
    await supabase
      .from("emergencia_token")
      .update({ ativo: false, revogado_em: new Date().toISOString() })
      .eq("id", token.id);
    setOcupado(false);
    await carregar();
  }

  async function copiar() {
    await navigator.clipboard?.writeText(link);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  if (!membership) {
    return (
      <p className="text-sm text-subtle">
        Crie o perfil do idoso primeiro para gerar o QR de emergencia.
      </p>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Emergencia</h1>
        <p className="text-sm text-subtle">
          Um QR code que mostra os dados criticos de {membership.idosoNome} sem
          precisar de login: alergias, condicoes, medicacoes e contatos. Imprima e
          deixe na carteira ou numa pulseira.
        </p>
      </div>

      {carregando && <p className="text-sm text-subtle">Carregando...</p>}

      {!carregando && !token && (
        <Card className="flex flex-col items-start gap-3">
          <p className="text-sm text-ink">
            Ainda nao ha um QR de emergencia ativo.
          </p>
          {membership.admin ? (
            <Button variant="primary" onClick={gerar} disabled={ocupado}>
              {ocupado ? "Gerando..." : "Gerar QR de emergencia"}
            </Button>
          ) : (
            <p className="text-sm text-subtle">
              Peca ao administrador para gerar o QR.
            </p>
          )}
        </Card>
      )}

      {!carregando && token && (
        <Card className="flex flex-col items-center gap-4">
          {qr && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qr}
              alt="QR code de emergencia"
              className="h-56 w-56 rounded-lg border border-line bg-white p-2"
            />
          )}
          <div className="flex w-full items-center gap-2">
            <input
              readOnly
              value={link}
              className="h-10 w-full rounded-lg border border-line bg-panel px-3 text-xs text-subtle"
            />
            <Button onClick={copiar} className="h-10 whitespace-nowrap px-3 text-xs">
              {copiado ? "Copiado" : "Copiar"}
            </Button>
          </div>
          <div className="flex w-full flex-wrap gap-2">
            <Button onClick={() => window.print()} className="flex-1">
              Imprimir
            </Button>
            {membership.admin && (
              <Button
                variant="ghost"
                onClick={revogar}
                disabled={ocupado}
                className="flex-1 text-danger"
              >
                {ocupado ? "Revogando..." : "Revogar QR"}
              </Button>
            )}
          </div>
          <p className="text-center text-xs text-subtle">
            Revogar invalida o QR na hora. Gere um novo depois, se precisar (util se
            a pulseira for perdida).
          </p>
        </Card>
      )}
    </div>
  );
}
