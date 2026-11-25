"use client";

import { useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { CamposAgenda } from "@/components/campos-agenda";
import { agendaParaGravar, agendaVazia, validarAgenda, type Agenda, type Remedio } from "@/lib/medicacao";

export type DadosRemedio = Agenda & { nome: string; dosagem: string | null; instrucoes: string | null };

export function FormRemedio({
  inicial,
  rotuloBotao,
  pedirMotivo = false,
  onSalvar,
  onCancelar,
}: {
  inicial?: Remedio;
  rotuloBotao: string;
  /** nos pedidos de mudança, quem pede pode explicar por quê */
  pedirMotivo?: boolean;
  /** devolve a mensagem de erro, ou null se gravou */
  onSalvar: (dados: DadosRemedio, motivo: string) => Promise<string | null>;
  onCancelar?: () => void;
}) {
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [dosagem, setDosagem] = useState(inicial?.dosagem ?? "");
  const [instrucoes, setInstrucoes] = useState(inicial?.instrucoes ?? "");
  const [agenda, setAgenda] = useState<Agenda>(inicial ? { ...inicial } : agendaVazia());
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) {
      setErro("Escreva o nome do remédio.");
      return;
    }
    const problema = validarAgenda(agenda);
    if (problema) {
      setErro(problema);
      return;
    }
    setErro(null);
    setSalvando(true);
    const falha = await onSalvar(
      {
        ...agendaParaGravar(agenda),
        nome: nome.trim(),
        dosagem: dosagem.trim() || null,
        instrucoes: instrucoes.trim() || null,
      },
      motivo.trim(),
    );
    setSalvando(false);
    if (falha) {
      setErro(falha);
    } else if (!inicial) {
      setNome("");
      setDosagem("");
      setInstrucoes("");
      setAgenda(agendaVazia());
    }
  }

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome do remédio">
          <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex: Losartana" />
        </Field>
        <Field label="Dosagem">
          <Input value={dosagem} onChange={(e) => setDosagem(e.target.value)} placeholder="ex: 50 mg, 1 comprimido" />
        </Field>
      </div>
      <Field label="Instruções (opcional)">
        <Input value={instrucoes} onChange={(e) => setInstrucoes(e.target.value)} placeholder="ex: em jejum" />
      </Field>
      <CamposAgenda valor={agenda} onChange={setAgenda} />
      {pedirMotivo && (
        <Field label="Por que mudar? (opcional)">
          <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="ex: o médico mudou na consulta" />
        </Field>
      )}
      {erro && <p className="text-sm text-danger" role="alert">{erro}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={salvando}>
          {salvando ? "Salvando..." : rotuloBotao}
        </Button>
        {onCancelar && (
          <Button type="button" variant="ghost" onClick={onCancelar}>Cancelar</Button>
        )}
      </div>
    </form>
  );
}
