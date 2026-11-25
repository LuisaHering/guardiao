"use client";

// Quem enviou a foto confere o que a IA leu, um item por vez, sem digitar nada.
// "Está igual" vale na hora. Qualquer outra resposta deixa o item para a família.
// A foto já foi enviada antes: sair no meio não perde nada.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui";
import { descreverAgenda, type Agenda } from "@/lib/medicacao";
import { gravarConferencia, lerPapel, SEM_PREPARO, type Leitura, type Resposta } from "@/lib/leituras";
import { rotuloEnvio, type TipoEnvio } from "@/lib/documentos";

type Etapa = "lendo" | "sem_leitura" | "tipo" | "itens" | "faltou" | "gravando" | "falhou" | "pronto";

type Props = {
  idosoId: string;
  documentoId: string;
  arquivo: File;
  envio: TipoEnvio;
  onFim: () => void;
};

const cartao = "flex flex-col gap-3 rounded-2xl border-2 border-line bg-card p-4";

export function ConferirPapel({ idosoId, documentoId, arquivo, envio, onFim }: Props) {
  const [etapa, setEtapa] = useState<Etapa>("lendo");
  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const [motivo, setMotivo] = useState("");
  const [indice, setIndice] = useState(0);
  const [exames, setExames] = useState<Resposta | null>(null);
  const [faltou, setFaltou] = useState(false);
  const [previa, setPrevia] = useState<string | null>(null);
  const pergunta = useRef<HTMLDivElement>(null);
  // Uma leitura por foto: o efeito pode rodar duas vezes, e a cota gratuita da IA é pequena.
  const pedido = useRef<ReturnType<typeof lerPapel> | null>(null);

  // A cada pergunta a tela vai até ela, para os botões não ficarem escondidos.
  useEffect(() => {
    if (etapa === "itens" || etapa === "faltou" || etapa === "pronto") {
      pergunta.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [etapa, indice]);

  useEffect(() => {
    if (!arquivo.type.startsWith("image/")) return;
    const url = URL.createObjectURL(arquivo);
    let vivo = true;
    Promise.resolve().then(() => vivo && setPrevia(url));
    return () => {
      vivo = false;
      URL.revokeObjectURL(url);
    };
  }, [arquivo]);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      pedido.current ??= lerPapel(createClient(), idosoId, arquivo);
      const r = await pedido.current;
      if (cancelado) return;
      if ("erro" in r) {
        setMotivo(r.erro);
        setEtapa("sem_leitura");
        return;
      }
      if (r.remedios.length === 0 && r.papel.exames.length === 0) {
        setMotivo("Não encontrei remédios nem exames pedidos nesta foto.");
        setEtapa("sem_leitura");
        return;
      }
      setLeitura(r);
      const lido = r.papel.tipo_documento;
      const trocado = (lido === "receita" || lido === "pedido_exame") && lido !== envio;
      setEtapa(trocado ? "tipo" : "itens");
    })();
    return () => {
      cancelado = true;
    };
  }, [idosoId, documentoId, arquivo, envio]);

  const total = leitura ? leitura.remedios.length + (leitura.papel.exames.length ? 1 : 0) : 0;

  function avancar() {
    if (indice + 1 < total) setIndice(indice + 1);
    else setEtapa("faltou");
  }

  function responder(resposta: Resposta | null) {
    if (!leitura) return;
    if (indice < leitura.remedios.length) {
      setLeitura({ ...leitura, remedios: leitura.remedios.map((r, i) => (i === indice ? { ...r, resposta } : r)) });
    } else {
      setExames(resposta);
    }
    avancar();
  }

  async function confirmarTipo(tipo: TipoEnvio) {
    // A família vê o papel com o nome certo.
    const diaMes = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    await createClient().from("documento").update({ envio: tipo, nome: `${rotuloEnvio(tipo)} ${diaMes}` }).eq("id", documentoId);
    setEtapa("itens");
  }

  async function guardar(temAlgoFaltando: boolean) {
    if (!leitura) return;
    setFaltou(temAlgoFaltando);
    setEtapa("gravando");
    const falha = await gravarConferencia(createClient(), idosoId, documentoId, arquivo, leitura, exames, temAlgoFaltando);
    if (falha) {
      setMotivo(falha);
      setEtapa("falhou");
    } else {
      setEtapa("pronto");
    }
  }

  const foto = previa && (
    <details className="rounded-2xl bg-panel p-3">
      <summary className="cursor-pointer text-base font-medium text-ink">Ver a foto que você tirou</summary>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={previa} alt="Foto do papel" className="mt-2 w-full rounded-xl" />
    </details>
  );

  if (etapa === "lendo") {
    return (
      <div className={cartao} role="status">
        <p className="text-xl font-semibold text-success">✓ Foto enviada à família</p>
        <p className="text-lg text-ink">Agora estou lendo o papel. Pode levar até um minuto.</p>
        <div className="h-2.5 overflow-hidden rounded-full bg-panel">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-primary" />
        </div>
        <p className="text-sm text-subtle">Se sair desta tela, a foto continua com a família.</p>
      </div>
    );
  }

  if (etapa === "sem_leitura") {
    return (
      <div className={cartao} role="status">
        <p className="text-xl font-semibold text-success">✓ A foto está com a família</p>
        <p className="text-lg text-ink">{motivo}</p>
        <p className="text-base text-subtle">Nada foi mudado nos remédios nem nos exames. A família vai olhar a foto.</p>
        <Button onClick={onFim} className="h-14 text-lg">Fechar</Button>
      </div>
    );
  }

  if (etapa === "tipo" && leitura) {
    const lido = leitura.papel.tipo_documento as TipoEnvio;
    return (
      <div className={cartao}>
        <p className="text-xl font-semibold text-ink">
          Você escolheu {rotuloEnvio(envio)}, mas parece {rotuloEnvio(lido)}.
        </p>
        <p className="text-base text-subtle">O que é este papel?</p>
        {foto}
        <Button variant="primary" onClick={() => confirmarTipo(lido)} className="h-14 text-lg">
          É {rotuloEnvio(lido)}
        </Button>
        <Button
          onClick={() => {
            setMotivo("Certo. Não vou usar a minha leitura.");
            setEtapa("sem_leitura");
          }}
          className="h-14 text-base"
        >
          É {rotuloEnvio(envio)} mesmo
        </Button>
      </div>
    );
  }

  if (etapa === "itens" && leitura) {
    const item = leitura.remedios[indice];
    return (
      <div className="flex flex-col gap-3">
        <p className="text-base text-subtle">
          Compare com o papel · {indice + 1} de {total}
        </p>
        {foto}
        <div ref={pergunta} className={`${cartao} scroll-mt-16`}>
          {item ? <Remedio item={item} /> : <Exames nomes={leitura.papel.exames} preparo={leitura.papel.preparo} />}
          {item && (item.classe.acao === "duvida" || item.classe.acao === "parar") ? (
            <Button variant="primary" onClick={() => responder(null)} className="h-14 text-lg">Entendi, continuar</Button>
          ) : (
            <>
              <p className="pt-1 text-lg font-semibold text-ink">Está igual ao papel?</p>
              <Button variant="primary" onClick={() => responder("igual")} className="h-16 text-xl">✓ Está igual</Button>
              <Button onClick={() => responder("diferente")} className="h-14 text-lg">Não está igual</Button>
            </>
          )}
        </div>
        {indice > 0 && (
          <Button variant="ghost" onClick={() => setIndice(indice - 1)} className="h-12 text-base">← Item anterior</Button>
        )}
      </div>
    );
  }

  if (etapa === "faltou") {
    return (
      <div className="flex flex-col gap-3">
        {foto}
        <div ref={pergunta} className={`${cartao} scroll-mt-16`}>
          <p className="text-xl font-semibold text-ink">Ficou faltando alguma coisa do papel?</p>
          <p className="text-base text-subtle">Um remédio ou um exame que não apareceu.</p>
          <Button variant="primary" onClick={() => guardar(false)} className="h-16 text-xl">Não, apareceu tudo</Button>
          <Button onClick={() => guardar(true)} className="h-14 text-lg">Sim, ficou faltando</Button>
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            setIndice(total - 1);
            setEtapa("itens");
          }}
          className="h-12 text-base"
        >
          ← Item anterior
        </Button>
      </div>
    );
  }

  if (etapa === "gravando") {
    return <p className="text-lg font-semibold text-ink" role="status">Guardando...</p>;
  }

  if (etapa === "falhou") {
    return (
      <div className={cartao} role="alert">
        <p className="text-xl font-semibold text-danger">Ainda não foi guardado</p>
        <p className="text-base text-ink">{motivo}</p>
        <Button variant="primary" onClick={() => guardar(faltou)} className="h-14 text-lg">Tentar de novo</Button>
        <Button variant="ghost" onClick={onFim} className="h-12 text-base">Deixar para a família</Button>
      </div>
    );
  }

  if (etapa !== "pronto" || !leitura) return null;

  const valendo = leitura.remedios.filter(
    (r) => r.resposta === "igual" && (r.classe.acao === "novo" || r.classe.acao === "mudar"),
  );
  const paraFamilia = leitura.remedios.filter(
    (r) => r.resposta === "diferente" || r.classe.acao === "duvida" || r.classe.acao === "parar",
  );
  const parar = leitura.remedios.some((r) => r.classe.acao === "parar");

  return (
    <div className="flex flex-col gap-3">
      <div ref={pergunta} className={`${cartao} scroll-mt-16`} role="status">
        <p className="text-2xl font-semibold text-success">✓ Pronto</p>
        {valendo.length > 0 && (
          <p className="text-lg text-ink">
            <strong>Já vale na lista:</strong> {valendo.map((r) => r.nome).join(", ")}.
          </p>
        )}
        {exames === "igual" && (
          <p className="text-lg text-ink">
            <strong>Exame anotado:</strong> {leitura.papel.exames.join(", ")}.
          </p>
        )}
        {(paraFamilia.length > 0 || exames === "diferente") && (
          <p className="rounded-xl bg-warn/10 p-3 text-lg text-ink">
            <strong>Não coloquei:</strong>{" "}
            {[...paraFamilia.map((r) => r.nome), ...(exames === "diferente" ? ["o pedido de exame"] : [])].join(", ")}. A
            família vai olhar a foto.
          </p>
        )}
        {parar && (
          <p className="rounded-xl bg-danger/10 p-3 text-lg font-medium text-danger">
            O papel parece mandar parar um remédio. Fale com a família antes da próxima dose.
          </p>
        )}
        <p className="text-base text-subtle">A família vai conferir com a foto.</p>
      </div>
      {valendo.length > 0 && (
        <Link href="/hoje/remedios" className="flex min-h-14 items-center justify-center rounded-lg bg-primary text-lg font-medium text-white">
          Ver os remédios de hoje
        </Link>
      )}
      <Button onClick={onFim} className="h-14 text-lg">Fechar</Button>
    </div>
  );
}

const Rotulo = ({ children, atencao }: { children: React.ReactNode; atencao?: boolean }) => (
  <p className={`text-sm font-semibold uppercase tracking-wide ${atencao ? "text-warn" : "text-subtle"}`}>{children}</p>
);

const NoPapel = ({ texto }: { texto: string }) =>
  texto ? <p className="text-lg text-ink">No papel: {texto}</p> : <p className="text-lg text-subtle">Não li como tomar.</p>;

function ComoEntra({ agenda }: { agenda: Agenda }) {
  const semHorario = agenda.frequencia !== "quando_precisar" && agenda.horarios.length === 0;
  return (
    <div className="rounded-xl bg-panel p-3">
      <p className="text-base text-subtle">Na lista vai ficar:</p>
      <p className="text-lg font-medium text-ink">{descreverAgenda(agenda)}</p>
      {semHorario && (
        <p className="mt-1 text-base font-medium text-warn">
          Sem horário: aparece uma vez por dia na lista. Se for mais de uma vez, siga o papel e avise a família.
        </p>
      )}
    </div>
  );
}

function Remedio({ item }: { item: Leitura["remedios"][number] }) {
  const c = item.classe;
  const nome = (
    <p className="text-2xl font-bold leading-tight text-ink">
      {item.nome} {item.dosagem}
    </p>
  );

  if (c.acao === "novo") {
    return (
      <>
        <Rotulo>Remédio novo</Rotulo>
        {nome}
        <NoPapel texto={item.texto} />
        <ComoEntra agenda={c.agenda} />
      </>
    );
  }
  if (c.acao === "mudar") {
    return (
      <>
        <Rotulo atencao>Já está na lista e vai mudar</Rotulo>
        {nome}
        <NoPapel texto={item.texto} />
        <div className="rounded-xl bg-panel p-3">
          <p className="text-base text-subtle">Em {c.alvo.nome}:</p>
          {c.mudancas.map((m) => (
            <p key={m} className="text-lg font-medium text-ink">{m}</p>
          ))}
        </div>
      </>
    );
  }
  if (c.acao === "ja_toma") {
    return (
      <>
        <Rotulo>Já está na lista: não vou colocar de novo</Rotulo>
        {nome}
        <NoPapel texto={item.texto} />
        <div className="rounded-xl bg-panel p-3">
          <p className="text-base text-subtle">Na lista hoje:</p>
          <p className="text-lg font-medium text-ink">
            {[c.alvo.nome, c.alvo.dosagem].filter(Boolean).join(" ")} · {descreverAgenda(c.alvo)}
          </p>
          {c.alvo.instrucoes && <p className="text-base text-ink">{c.alvo.instrucoes}</p>}
        </div>
      </>
    );
  }
  if (c.acao === "parar") {
    return (
      <>
        <Rotulo atencao>O papel parece mandar parar</Rotulo>
        {nome}
        <NoPapel texto={item.texto} />
        <p className="text-lg font-medium text-warn">Não mudei nada. Fale com a família antes da próxima dose.</p>
      </>
    );
  }
  return (
    <>
      <Rotulo atencao>Este eu não coloco sozinho</Rotulo>
      {nome}
      <NoPapel texto={item.texto} />
      <p className="text-lg text-ink">Porque {c.motivo}. A família vai olhar a foto.</p>
    </>
  );
}

function Exames({ nomes, preparo }: { nomes: string[]; preparo: string | null }) {
  return (
    <>
      <Rotulo>Pedido de exame</Rotulo>
      <ul className="flex flex-col gap-1">
        {nomes.map((n, i) => (
          <li key={`${i}-${n}`} className="text-2xl font-bold leading-tight text-ink">{n}</li>
        ))}
      </ul>
      <div className="rounded-xl bg-panel p-3">
        <p className="text-base text-subtle">Preparo:</p>
        <p className="text-lg font-medium text-ink">{preparo?.trim() || `O papel não diz. ${SEM_PREPARO}`}</p>
      </div>
    </>
  );
}
