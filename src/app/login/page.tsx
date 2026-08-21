"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui";

function traduzErro(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid login credentials")) return "Email ou senha incorretos.";
  if (m.includes("already registered")) return "Esse email já tem uma conta.";
  if (m.includes("at least 6")) return "A senha precisa de ao menos 6 caracteres.";
  if (m.includes("email")) return "Verifique o email informado.";
  return msg;
}

const inputClass =
  "h-10 w-full rounded-lg border border-line bg-card px-3 text-sm text-ink placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [modo, setModo] = useState<"login" | "cadastro">("login");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setAviso(null);
    setCarregando(true);

    if (modo === "login") {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password: senha,
      });
      if (error) setErro(traduzErro(error.message));
      else router.push("/painel");
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password: senha,
        options: { data: { nome } },
      });
      if (error) setErro(traduzErro(error.message));
      else if (data.session) router.push("/painel");
      else
        setAviso(
          "Conta criada. Confira seu email para confirmar o cadastro antes de entrar.",
        );
    }

    setCarregando(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2 text-primary">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
          <span className="text-lg font-semibold text-ink">Guardião</span>
        </div>

        <h1 className="text-xl font-semibold text-ink">
          {modo === "login" ? "Entrar" : "Criar conta"}
        </h1>
        <p className="mb-6 mt-1 text-sm text-subtle">
          {modo === "login"
            ? "Acesse o cuidado do idoso."
            : "Comece a acompanhar o cuidado do idoso."}
        </p>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          {modo === "cadastro" && (
            <label className="flex flex-col gap-1 text-sm text-ink">
              Nome
              <input
                className={inputClass}
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                required
                autoComplete="name"
              />
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm text-ink">
            Email
            <input
              type="email"
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink">
            Senha
            <input
              type="password"
              className={inputClass}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
              autoComplete={modo === "login" ? "current-password" : "new-password"}
              minLength={6}
            />
          </label>

          {erro && <p className="text-sm text-danger">{erro}</p>}
          {aviso && <p className="text-sm text-primary">{aviso}</p>}

          <Button variant="primary" type="submit" disabled={carregando} className="mt-1">
            {carregando
              ? "Aguarde..."
              : modo === "login"
                ? "Entrar"
                : "Criar conta"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-subtle">
          {modo === "login" ? "Não tem conta?" : "Já tem conta?"}{" "}
          <button
            type="button"
            onClick={() => {
              setModo(modo === "login" ? "cadastro" : "login");
              setErro(null);
              setAviso(null);
            }}
            className="font-medium text-primary hover:underline"
          >
            {modo === "login" ? "Criar conta" : "Entrar"}
          </button>
        </p>

        <p className="mt-8 text-center text-xs text-subtle">
          <Link href="/" className="hover:underline">
            Voltar ao início
          </Link>
        </p>
      </div>
    </div>
  );
}
