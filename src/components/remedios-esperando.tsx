"use client";

// Remédios que apareceram numa foto mas não entraram na lista. Eles não somem: quem cuida
// vê que estão esperando e pode pedir a aprovação; o administrador resolve.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Button } from "@/components/ui";
import { FormRemedio, type DadosRemedio } from "@/components/form-remedio";
import { agendaVazia, horaBR, type Remedio } from "@/lib/medicacao";
import { abrirArquivo } from "@/lib/documentos";
import { EVENTO_REMEDIOS } from "@/lib/revisoes";

type Pendente = {
  id: string;
  documento_id: string;
  nome: string;
  texto: string | null;
  motivo: string;
  tipo: "duvida" | "nao_confere" | "parar";
  pedido_em: string | null;
};

const UMA_HORA = 3_600_000;

export function RemediosEsperando({ idosoId }: { idosoId: string }) {
  const supabase = createClient();
  const membership = useRole();
  const admin = !!membership?.admin;
  const [itens, setItens] = useState<(Pendente & { recente: boolean })[]>([]);
  const [versao, setVersao] = useState(0);
  const [cadastrando, setCadastrando] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const atualizar = () => setVersao((v) => v + 1);
    window.addEventListener(EVENTO_REMEDIOS, atualizar);
    window.addEventListener("focus", atualizar);
    return () => {
      window.removeEventListener(EVENTO_REMEDIOS, atualizar);
      window.removeEventListener("focus", atualizar);
    };
  }, []);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const { data } = await supabase
        .from("remedio_pendente")
        .select("id, documento_id, nome, texto, motivo, tipo, pedido_em")
        .eq("idoso_id", idosoId)
        .eq("status", "esperando")
        .order("created_at");
      const agora = Date.now();
      if (!cancelado) {
        setItens(
          ((data ?? []) as Pendente[]).map((p) => ({
            ...p,
            recente: !!p.pedido_em && agora - Date.parse(p.pedido_em) < UMA_HORA,
          })),
        );
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [supabase, idosoId, versao]);

  if (itens.length === 0) return null;

  async function pedir(p: Pendente) {
    setOcupado(true);
    setErro(null);
    const { error } = await supabase.rpc("pedir_aprovacao_remedio", { p_pendente: p.id });
    if (error) setErro("Não consegui avisar agora. Se for urgente, ligue para a família.");
    setOcupado(false);
    setVersao((v) => v + 1);
  }

  async function resolver(p: Pendente, cadastrado: boolean): Promise<string | null> {
    const { error } = await supabase.rpc("resolver_remedio_pendente", { p_pendente: p.id, p_cadastrado: cadastrado });
    if (error) return "Não consegui encerrar este item.";
    setCadastrando(null);
    window.dispatchEvent(new Event(EVENTO_REMEDIOS));
    return null;
  }

  async function cadastrar(p: Pendente, dados: DadosRemedio): Promise<string | null> {
    const { error } = await supabase.from("medicacao").insert({ idoso_id: idosoId, ...dados });
    if (error) return "Não consegui salvar o remédio.";
    return resolver(p, true);
  }

  async function verFoto(p: Pendente) {
    const { data } = await supabase.from("documento").select("arquivo_url").eq("id", p.documento_id).maybeSingle();
    setErro(data ? await abrirArquivo(supabase, "documentos", data.arquivo_url as string) : "Não encontrei a foto.");
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border-2 border-danger bg-card p-5">
      <h2 className="text-lg font-semibold text-danger">
        {admin ? `Esperando você (${itens.length})` : `Esperando a família (${itens.length})`}
      </h2>
      <p className="text-base text-ink">
        {admin
          ? "Apareceram numa foto e não entraram na lista."
          : "Apareceram na foto, mas não estão na lista. Se precisar tomar hoje, ligue para a família."}
      </p>
      {erro && <p className="text-base text-danger" role="alert">{erro}</p>}

      {itens.map((p) => (
        <div key={p.id} className="flex flex-col gap-2 border-t border-line pt-3">
          <p className="text-lg font-semibold leading-tight text-ink">{p.nome}</p>
          {p.texto && <p className="text-base text-ink">No papel: {p.texto}</p>}
          <p className="text-sm text-subtle">Não entrou porque {p.motivo}.</p>
          {p.tipo === "parar" && (
            <p className="text-base font-medium text-danger">
              {admin ? "Se for para parar, suspenda o remédio na lista." : "Fale com a família antes da próxima dose."}
            </p>
          )}

          {!admin && (
            <>
              <Button variant="primary" disabled={ocupado || p.recente} onClick={() => pedir(p)} className="h-14 text-lg">
                {p.recente ? "Aviso enviado" : "Pedir para a família aprovar"}
              </Button>
              {p.pedido_em && <p className="text-sm text-subtle">Último pedido às {horaBR(new Date(p.pedido_em))}.</p>}
            </>
          )}

          {admin && cadastrando === p.id && (
            <FormRemedio
              inicial={
                { ...agendaVazia(), id: p.id, nome: p.nome, dosagem: null, instrucoes: p.texto, ativo: true, confirmado: true, autor_id: null } as Remedio
              }
              rotuloBotao="Colocar na lista"
              onSalvar={(dados) => cadastrar(p, dados)}
              onCancelar={() => setCadastrando(null)}
            />
          )}
          {admin && cadastrando !== p.id && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => verFoto(p)}>Ver a foto</Button>
              {p.tipo === "parar" ? (
                <Button variant="primary" onClick={async () => setErro(await resolver(p, true))}>Já resolvi</Button>
              ) : (
                <>
                  <Button variant="primary" onClick={() => setCadastrando(p.id)}>Colocar na lista</Button>
                  <Button variant="ghost" onClick={async () => setErro(await resolver(p, false))}>Não colocar</Button>
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
