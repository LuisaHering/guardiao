"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Card } from "@/components/ui";
import { calcularCompletude, type ResultadoCompletude } from "@/lib/completude";

export function CompletudePerfil() {
  const supabase = createClient();
  const membership = useRole();
  const idosoId = membership?.idosoId;
  const [resultado, setResultado] = useState<ResultadoCompletude | null>(null);

  const carregar = useCallback(async () => {
    if (!idosoId) return;

    const contar = async (
      tabela: string,
      filtro: (q: ReturnType<typeof base>) => ReturnType<typeof base>,
    ) => {
      const { count } = await filtro(base(tabela));
      return count ?? 0;
    };
    function base(tabela: string) {
      return supabase.from(tabela).select("id", { count: "exact", head: true }).eq("idoso_id", idosoId!);
    }

    const [
      { data: idoso },
      contatos,
      condicoes,
      alergias,
      medicacoes,
      consentimento,
      qr,
      preferencias,
      comunicacao,
      memorias,
      diretiva,
      exames,
      consultas,
    ] = await Promise.all([
      supabase
        .from("idoso")
        .select("como_chamar, data_nascimento, tipo_sanguineo")
        .eq("id", idosoId)
        .single(),
      contar("contato_emergencia", (q) => q.is("deleted_at", null)),
      contar("condicao", (q) => q.is("deleted_at", null)),
      contar("alergia", (q) => q.is("deleted_at", null)),
      contar("medicacao", (q) => q.eq("ativo", true).is("deleted_at", null)),
      contar("consentimento", (q) => q.is("revogado_em", null)),
      contar("emergencia_token", (q) => q.eq("ativo", true).is("revogado_em", null)),
      contar("preferencia", (q) => q.eq("confirmado", true).is("deleted_at", null)),
      contar("preferencia", (q) =>
        q.eq("confirmado", true).eq("categoria", "comunicacao").is("deleted_at", null),
      ),
      contar("memoria", (q) => q.eq("confirmado", true).is("deleted_at", null)),
      contar("diretiva", (q) => q),
      contar("exame", (q) => q.is("deleted_at", null)),
      contar("consulta", (q) => q.is("deleted_at", null)),
    ]);

    setResultado(
      calcularCompletude({
        comoChamar: !!idoso?.como_chamar,
        nascimento: !!idoso?.data_nascimento,
        tipoSanguineo: !!idoso?.tipo_sanguineo,
        contatos,
        condicoes,
        alergias,
        medicacoes,
        consentimento: consentimento > 0,
        qrEmergencia: qr > 0,
        preferencias,
        preferenciasComunicacao: comunicacao,
        memorias,
        diretiva: diretiva > 0,
        exames,
        consultas,
      }),
    );
  }, [supabase, idosoId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  if (!resultado) return null;

  const { percentual, proximos } = resultado;

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">
          Perfil preenchido
        </h2>
        <p className="text-lg font-semibold text-ink">{percentual}%</p>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-panel"
        role="progressbar"
        aria-valuenow={percentual}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Perfil preenchido"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${percentual}%` }} />
      </div>

      {proximos.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-subtle">Para avançar, o que mais ajuda agora:</p>
          {proximos.slice(0, 3).map((p) => (
            <Link
              key={p.id}
              href={p.href}
              className="flex items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-panel"
            >
              <span className="text-ink">{p.rotulo}</span>
              <span className="text-xs text-subtle">{p.dica}</span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink">Tudo o que o sistema pede já está preenchido.</p>
      )}

      <p className="text-xs text-subtle">
        Isto mede o que já foi registrado, não a qualidade do cuidado.
      </p>
    </Card>
  );
}
