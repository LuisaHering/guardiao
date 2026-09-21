"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Alergia = { substancia: string; reacao: string | null; gravidade: string | null };
type Medicacao = { nome: string; dosagem: string | null };
type Contato = { nome: string; telefone: string | null; relacao: string | null };
type Perfil = {
  nome: string;
  data_nascimento: string | null;
  tipo_sanguineo: string | null;
  alergias: Alergia[];
  condicoes: string[];
  medicacoes: Medicacao[];
  contatos: Contato[];
};

type Estado = "carregando" | "ok" | "invalido";

function idade(nasc: string | null) {
  if (!nasc) return null;
  const d = new Date(nasc);
  const hoje = new Date();
  let anos = hoje.getFullYear() - d.getFullYear();
  const m = hoje.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < d.getDate())) anos--;
  return anos;
}

function Secao({
  titulo,
  vazio,
  children,
}: {
  titulo: string;
  vazio: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-line pt-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">
        {titulo}
      </h2>
      {vazio ? (
        <p className="text-sm text-subtle">Nada registrado.</p>
      ) : (
        children
      )}
    </div>
  );
}

export default function EmergenciaPublicaPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const supabase = createClient();

  const [estado, setEstado] = useState<Estado>("carregando");
  const [perfil, setPerfil] = useState<Perfil | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc("emergencia_por_token", {
      p_token: token,
    });
    if (error || !data) {
      setEstado("invalido");
      return;
    }
    setPerfil(data as Perfil);
    setEstado("ok");
  }, [supabase, token]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  return (
    <div className="min-h-screen bg-canvas px-4 py-8">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-4 flex items-center justify-center gap-2 text-danger">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
          <span className="text-sm font-semibold uppercase tracking-wide">
            Perfil de emergencia
          </span>
        </div>

        {estado === "carregando" && (
          <p className="text-center text-sm text-subtle">Carregando...</p>
        )}

        {estado === "invalido" && (
          <div className="rounded-xl border border-line bg-card p-6 text-center">
            <p className="text-sm text-ink">
              Este perfil de emergencia nao esta disponivel.
            </p>
            <p className="mt-1 text-sm text-subtle">
              O codigo pode ter sido revogado ou nao existe.
            </p>
          </div>
        )}

        {estado === "ok" && perfil && (
          <div className="flex flex-col gap-5 rounded-xl border border-danger/30 bg-card p-6">
            <div>
              <h1 className="text-2xl font-semibold text-ink">{perfil.nome}</h1>
              <p className="text-sm text-subtle">
                {[
                  idade(perfil.data_nascimento) !== null
                    ? `${idade(perfil.data_nascimento)} anos`
                    : null,
                  perfil.tipo_sanguineo
                    ? `Tipo sanguineo ${perfil.tipo_sanguineo}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Dados basicos nao informados"}
              </p>
            </div>

            <Secao titulo="Alergias" vazio={perfil.alergias.length === 0}>
              <ul className="flex flex-col gap-1.5">
                {perfil.alergias.map((a, i) => (
                  <li key={i} className="text-sm text-ink">
                    <span className="font-medium text-danger">{a.substancia}</span>
                    {a.gravidade && (
                      <span className="text-subtle"> · {a.gravidade}</span>
                    )}
                    {a.reacao && <span className="text-subtle"> · {a.reacao}</span>}
                  </li>
                ))}
              </ul>
            </Secao>

            <Secao titulo="Condicoes de saude" vazio={perfil.condicoes.length === 0}>
              <ul className="flex flex-col gap-1">
                {perfil.condicoes.map((c, i) => (
                  <li key={i} className="text-sm text-ink">
                    {c}
                  </li>
                ))}
              </ul>
            </Secao>

            <Secao titulo="Medicacoes em uso" vazio={perfil.medicacoes.length === 0}>
              <ul className="flex flex-col gap-1">
                {perfil.medicacoes.map((m, i) => (
                  <li key={i} className="text-sm text-ink">
                    {m.nome}
                    {m.dosagem && <span className="text-subtle"> · {m.dosagem}</span>}
                  </li>
                ))}
              </ul>
            </Secao>

            <Secao
              titulo="Contatos de emergencia"
              vazio={perfil.contatos.length === 0}
            >
              <ul className="flex flex-col gap-2">
                {perfil.contatos.map((c, i) => (
                  <li key={i} className="flex items-center justify-between gap-3">
                    <span className="text-sm text-ink">
                      {c.nome}
                      {c.relacao && (
                        <span className="text-subtle"> · {c.relacao}</span>
                      )}
                    </span>
                    {c.telefone && (
                      <a
                        href={`tel:${c.telefone}`}
                        className="whitespace-nowrap rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-white"
                      >
                        Ligar {c.telefone}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </Secao>

            <p className="border-t border-line pt-3 text-center text-xs text-subtle">
              Dados de emergencia compartilhados via Guardiao. Uso restrito a
              situacoes de socorro.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
