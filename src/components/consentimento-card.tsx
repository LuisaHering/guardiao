"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, Card } from "@/components/ui";

const VERSAO_TERMO = "v1";

type Consentimento = {
  id: string;
  versao_termo: string;
  aceito_em: string;
};

export function ConsentimentoCard({
  idosoId,
  idosoNome,
}: {
  idosoId: string;
  idosoNome: string;
}) {
  const supabase = createClient();
  const [carregando, setCarregando] = useState(true);
  const [ativo, setAtivo] = useState<Consentimento | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data } = await supabase
      .from("consentimento")
      .select("id, versao_termo, aceito_em")
      .eq("idoso_id", idosoId)
      .is("revogado_em", null)
      .order("aceito_em", { ascending: false })
      .limit(1)
      .maybeSingle();
    setAtivo((data as Consentimento) ?? null);
    setCarregando(false);
  }, [supabase, idosoId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function registrar() {
    setOcupado(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("consentimento").insert({
      idoso_id: idosoId,
      versao_termo: VERSAO_TERMO,
      operado_por: user!.id,
    });
    await carregar();
    setOcupado(false);
  }

  async function revogar() {
    if (!ativo) return;
    setOcupado(true);
    await supabase
      .from("consentimento")
      .update({ revogado_em: new Date().toISOString() })
      .eq("id", ativo.id);
    await carregar();
    setOcupado(false);
  }

  if (carregando) return null;

  if (ativo) {
    const data = new Date(ativo.aceito_em).toLocaleDateString("pt-BR");
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 border-primary/30 bg-primary-soft">
        <div>
          <p className="text-sm font-medium text-primary">
            Consentimento registrado
          </p>
          <p className="text-xs text-primary-ink">
            Tratamento de dados de saúde autorizado em {data} (termo{" "}
            {ativo.versao_termo}).
          </p>
        </div>
        <Button variant="ghost" onClick={revogar} disabled={ocupado} className="h-8 px-3 text-xs">
          Revogar
        </Button>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3 border-warn/40">
      <div>
        <p className="text-sm font-medium text-ink">Consentimento (LGPD)</p>
        <p className="mt-1 text-sm text-subtle">
          Autorizo o tratamento dos dados de saúde de {idosoNome} nesta
          plataforma (medicações, sintomas, exames, consultas e afins) para
          coordenar o cuidado, nos termos da LGPD (Lei 13.709/2018, art. 11). O
          consentimento pode ser revogado a qualquer momento.
        </p>
      </div>
      <div>
        <Button variant="primary" onClick={registrar} disabled={ocupado}>
          {ocupado ? "Registrando..." : "Registrar consentimento do titular"}
        </Button>
      </div>
    </Card>
  );
}
