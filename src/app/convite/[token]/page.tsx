"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui";
import { roleLabels, type Role } from "@/lib/roles";

type Info = {
  idoso_nome: string;
  papel: string;
  aceito: boolean;
  expirado: boolean;
};

type Estado = "carregando" | "deslogado" | "ok" | "invalido";

export default function AceitarConvitePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const supabase = createClient();
  const router = useRouter();

  const [estado, setEstado] = useState<Estado>("carregando");
  const [info, setInfo] = useState<Info | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setEstado("deslogado");
      return;
    }
    const { data } = await supabase.rpc("convite_info", { p_token: token });
    if (!data) {
      setEstado("invalido");
      return;
    }
    setInfo(data as Info);
    setEstado("ok");
  }, [supabase, token]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function aceitar() {
    setOcupado(true);
    setErro(null);
    const { error } = await supabase.rpc("aceitar_convite", { p_token: token });
    if (error) {
      setErro(error.message);
      setOcupado(false);
      return;
    }
    router.push("/painel");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm text-center">
        <div className="mb-6 flex items-center justify-center gap-2 text-primary">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
          <span className="text-lg font-semibold text-ink">Guardião</span>
        </div>

        {estado === "carregando" && <p className="text-sm text-subtle">Carregando...</p>}

        {estado === "deslogado" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink">
              Você recebeu um convite para ajudar a cuidar de alguém no Guardião.
            </p>
            <p className="text-sm text-subtle">
              Entre ou crie sua conta e depois abra este link de novo para aceitar.
            </p>
            <Link
              href="/login"
              className="mx-auto inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-white hover:opacity-90"
            >
              Entrar ou criar conta
            </Link>
          </div>
        )}

        {estado === "invalido" && (
          <p className="text-sm text-subtle">
            Este convite não é válido. Peça um novo para quem te convidou.
          </p>
        )}

        {estado === "ok" && info && (
          <div className="flex flex-col gap-4">
            {info.aceito ? (
              <p className="text-sm text-subtle">Este convite já foi aceito.</p>
            ) : info.expirado ? (
              <p className="text-sm text-subtle">Este convite expirou. Peça um novo.</p>
            ) : (
              <>
                <p className="text-sm text-ink">
                  Você foi convidada para cuidar de{" "}
                  <span className="font-medium">{info.idoso_nome}</span> como{" "}
                  <span className="font-medium">
                    {roleLabels[info.papel as Role] ?? info.papel}
                  </span>
                  .
                </p>
                {erro && <p className="text-sm text-danger">{erro}</p>}
                <Button variant="primary" onClick={aceitar} disabled={ocupado} className="mx-auto">
                  {ocupado ? "Aceitando..." : "Aceitar convite"}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
