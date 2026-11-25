"use client";

// Quem enviou a foto confere o que a IA leu: TUDO o que vai para a lista, uma pergunta por
// tela, sem digitar. Qualquer "não, ou não sei" deixa aquele item para a família.
// A foto já foi enviada antes: sair no meio não perde nada.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button, Input } from "@/components/ui";
import {
  aplicarInicio,
  compararHorarios,
  diasEntre,
  hojeBR,
  juntar,
  perguntasDoRemedio,
  rotuloHorario,
  somarMeses,
  type Agenda,
  type Pergunta,
  type Recorrencia,
} from "@/lib/medicacao";
import { gravarConferencia, lerPapel, SEM_PREPARO, type ItemRemedio, type Leitura } from "@/lib/leituras";
import { rotuloEnvio, type TipoEnvio } from "@/lib/documentos";
import { cn } from "@/lib/cn";

type Etapa = "lendo" | "sem_leitura" | "tipo" | "conferindo" | "faltou" | "gravando" | "falhou" | "pronto";

type Passo = Pergunta | "medico" | "exames" | "preparo" | "aviso" | "anotado" | "recusado";

/** Uma parte do papel: o médico e a data, um remédio, ou o pedido de exame. */
type Bloco = { tipo: "medico" } | { tipo: "remedio"; indice: number } | { tipo: "exames" };

type Posicao = { bloco: number; passo: Passo };

type Respostas = { agendas: Record<number, Agenda>; recusas: Record<string, string> };

type Props = {
  idosoId: string;
  documentoId: string;
  arquivo: File;
  envio: TipoEnvio;
  onFim: () => void;
};

const cartao = "flex flex-col gap-3 rounded-2xl border-2 border-line bg-card p-4";

const chaveDo = (b: Bloco) => (b.tipo === "remedio" ? `remedio:${b.indice}` : b.tipo);

const diaMes = (iso: string) => iso.split("-").reverse().slice(0, 2).join("/");
const diaMesAno = (iso: string) => iso.split("-").reverse().join("/");

const NOMES_DOS_DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

function blocosDe(l: Leitura): Bloco[] {
  const blocos: Bloco[] = [];
  const temRemedio = l.remedios.some((r) => perguntasDoRemedio(r.classe).length > 0);
  if (temRemedio && (l.papel.medico || l.papel.data)) blocos.push({ tipo: "medico" });
  l.remedios.forEach((_, indice) => blocos.push({ tipo: "remedio", indice }));
  if (l.papel.exames.length) blocos.push({ tipo: "exames" });
  return blocos;
}

function passosDo(b: Bloco, l: Leitura): Passo[] {
  if (b.tipo === "medico") return ["medico"];
  if (b.tipo === "exames") return ["exames", "preparo", "anotado"];
  const perguntas = perguntasDoRemedio(l.remedios[b.indice].classe);
  return perguntas.length ? [...perguntas, "anotado"] : ["aviso"];
}

/** Os remédios com o resultado da conferência, prontos para gravar. */
function conferidos(l: Leitura, r: Respostas): ItemRemedio[] {
  return l.remedios.map((item, i): ItemRemedio => {
    if (perguntasDoRemedio(item.classe).length === 0) return item;
    const recusou = r.recusas[`remedio:${i}`];
    if (recusou) return { ...item, resposta: null, recusou };
    const classe = item.classe.acao === "novo" && r.agendas[i] ? { ...item.classe, agenda: r.agendas[i] } : item.classe;
    return { ...item, classe, resposta: "igual" };
  });
}

function quantasVezes(a: Agenda, recorrencia: Recorrencia | null): string {
  if (a.frequencia === "quando_precisar") return "Só quando precisar";
  if (a.frequencia === "unica") return "Uma vez só, e acabou";
  if (a.frequencia === "mensal") {
    return (a.intervalo_dias ?? 1) > 1 ? `Só a cada ${a.intervalo_dias} meses` : "Só 1 vez por mês";
  }
  if (a.frequencia === "intervalo") return `Só a cada ${a.intervalo_dias} dias`;
  if (a.frequencia === "semana") {
    const vezes = recorrencia?.tipo === "semana" ? recorrencia.vezes : null;
    if (!vezes) return "Só em alguns dias da semana";
    return vezes === 1 ? "Só 1 vez por semana" : `${vezes} vezes por semana`;
  }
  return "Todo dia";
}

function horaDoDia(a: Agenda): string {
  if (!a.horarios.length) return "O papel não diz a hora";
  const lista = juntar([...a.horarios].sort(compararHorarios).map((h) => rotuloHorario(h)));
  return lista.charAt(0) + lista.slice(1).toLowerCase();
}

/** O remédio inteiro em uma frase, para o "Anotado". */
function frase(a: Agenda): string {
  const partes: string[] = [];
  if (a.frequencia === "diaria") partes.push("Todo dia");
  else if (a.frequencia === "quando_precisar") partes.push("Só quando precisar");
  else if (a.frequencia === "semana") partes.push(`Toda semana: ${juntar(a.dias_semana.map((d) => NOMES_DOS_DIAS[d]))}`);
  else if (a.frequencia === "unica") partes.push(`Uma vez só, em ${diaMes(a.inicio)}`);
  else if (a.frequencia === "intervalo") partes.push(`A cada ${a.intervalo_dias} dias, a próxima em ${diaMes(a.inicio)}`);
  else {
    const cada = (a.intervalo_dias ?? 1) > 1 ? `A cada ${a.intervalo_dias} meses` : "Todo mês";
    partes.push(`${cada}, no dia ${Number(a.inicio.slice(8, 10))}, a próxima em ${diaMes(a.inicio)}`);
  }
  if (a.horarios.length) partes.push(horaDoDia(a).toLowerCase());
  if (a.fim && a.frequencia !== "unica") partes.push(`até ${diaMes(a.fim)}`);
  return partes.join(", ");
}

export function ConferirPapel({ idosoId, documentoId, arquivo, envio, onFim }: Props) {
  const [etapa, setEtapa] = useState<Etapa>("lendo");
  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const [motivo, setMotivo] = useState("");
  const [posicao, setPosicao] = useState<Posicao>({ bloco: 0, passo: "aviso" });
  const [historico, setHistorico] = useState<Posicao[]>([]);
  const [respostas, setRespostas] = useState<Respostas>({ agendas: {}, recusas: {} });
  const [faltou, setFaltou] = useState(false);
  const [previa, setPrevia] = useState<string | null>(null);
  const pergunta = useRef<HTMLDivElement>(null);
  // Uma leitura por foto: o efeito pode rodar duas vezes, e a cota gratuita da IA é pequena.
  const pedido = useRef<ReturnType<typeof lerPapel> | null>(null);

  // A cada pergunta a tela vai até ela, para os botões não ficarem escondidos.
  useEffect(() => {
    if (etapa === "conferindo" || etapa === "faltou" || etapa === "pronto") {
      pergunta.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [etapa, posicao]);

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
      setPosicao({ bloco: 0, passo: passosDo(blocosDe(r)[0], r)[0] });
      const lido = r.papel.tipo_documento;
      const trocado = (lido === "receita" || lido === "pedido_exame") && lido !== envio;
      setEtapa(trocado ? "tipo" : "conferindo");
    })();
    return () => {
      cancelado = true;
    };
  }, [idosoId, documentoId, arquivo, envio]);

  const blocos = leitura ? blocosDe(leitura) : [];
  const bloco = blocos[posicao.bloco];

  function ir(proxima: Posicao) {
    setHistorico((h) => [...h, posicao]);
    setPosicao(proxima);
    setEtapa("conferindo");
  }

  function proximoBloco() {
    if (!leitura) return;
    const n = posicao.bloco + 1;
    if (n < blocos.length) {
      ir({ bloco: n, passo: passosDo(blocos[n], leitura)[0] });
    } else {
      setHistorico((h) => [...h, posicao]);
      setEtapa("faltou");
    }
  }

  /** Respondeu que sim: segue para a próxima pergunta desta parte (ou para a próxima parte). */
  function seguir() {
    if (!leitura || !bloco) return;
    const passos = passosDo(bloco, leitura);
    const depois = passos[passos.indexOf(posicao.passo) + 1];
    if (depois) ir({ bloco: posicao.bloco, passo: depois });
    else proximoBloco();
  }

  function recusar(oQue: string) {
    if (!bloco) return;
    setRespostas((r) => ({ ...r, recusas: { ...r.recusas, [chaveDo(bloco)]: oQue } }));
    if (bloco.tipo === "medico") proximoBloco();
    else ir({ bloco: posicao.bloco, passo: "recusado" });
  }

  function voltar() {
    const anterior = historico[historico.length - 1];
    if (!anterior) return;
    setHistorico(historico.slice(0, -1));
    setPosicao(anterior);
    setEtapa("conferindo");
    // Voltar para uma pergunta desfaz o "não" daquela parte.
    const alvo = blocos[anterior.bloco];
    if (alvo && anterior.passo !== "recusado") {
      setRespostas((r) => {
        const recusas = { ...r.recusas };
        delete recusas[chaveDo(alvo)];
        return { ...r, recusas };
      });
    }
  }

  function refazer() {
    if (!leitura || !bloco) return;
    if (bloco.tipo === "remedio") {
      setRespostas((r) => {
        const agendas = { ...r.agendas };
        delete agendas[bloco.indice];
        return { ...r, agendas };
      });
    }
    ir({ bloco: posicao.bloco, passo: passosDo(bloco, leitura)[0] });
  }

  async function confirmarTipo(tipo: TipoEnvio) {
    // A família vê o papel com o nome certo.
    const dia = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    await createClient().from("documento").update({ envio: tipo, nome: `${rotuloEnvio(tipo)} ${dia}` }).eq("id", documentoId);
    setEtapa("conferindo");
  }

  async function guardar(temAlgoFaltando: boolean) {
    if (!leitura) return;
    setFaltou(temAlgoFaltando);
    setEtapa("gravando");
    const falha = await gravarConferencia(
      createClient(),
      idosoId,
      documentoId,
      arquivo,
      { ...leitura, remedios: conferidos(leitura, respostas) },
      leitura.papel.exames.length ? (respostas.recusas.exames ? "diferente" : "igual") : null,
      temAlgoFaltando,
      !respostas.recusas.medico,
    );
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

  const botaoVoltar = historico.length > 0 && (
    <Button variant="ghost" onClick={voltar} className="h-12 text-base">← Voltar</Button>
  );

  if (etapa === "conferindo" && leitura && bloco) {
    const perguntas: Passo[] = passosDo(bloco, leitura).filter((p) => p !== "anotado" && p !== "aviso");
    const numero = perguntas.indexOf(posicao.passo) + 1;
    const onde =
      bloco.tipo === "medico"
        ? "A receita"
        : bloco.tipo === "exames"
          ? "Pedido de exame"
          : `Remédio ${bloco.indice + 1} de ${leitura.remedios.length}`;

    return (
      <div className="flex flex-col gap-3">
        <p className="text-base text-subtle">
          {onde}
          {numero > 0 && perguntas.length > 1 ? ` · pergunta ${numero} de ${perguntas.length}` : ""}
        </p>
        {foto}
        <div ref={pergunta} className={`${cartao} scroll-mt-16`}>
          <Tela
            key={`${posicao.bloco}:${posicao.passo}`}
            leitura={leitura}
            bloco={bloco}
            passo={posicao.passo}
            agenda={bloco.tipo === "remedio" ? respostas.agendas[bloco.indice] : undefined}
            recusa={respostas.recusas[chaveDo(bloco)]}
            onSim={seguir}
            onNao={recusar}
            onDia={(agenda) => {
              if (bloco.tipo !== "remedio") return;
              setRespostas((r) => ({ ...r, agendas: { ...r.agendas, [bloco.indice]: agenda } }));
              seguir();
            }}
            onProximo={proximoBloco}
            onRefazer={refazer}
          />
        </div>
        {botaoVoltar}
      </div>
    );
  }

  if (etapa === "faltou") {
    return (
      <div className="flex flex-col gap-3">
        {foto}
        <div ref={pergunta} className={`${cartao} scroll-mt-16`}>
          <p className="text-xl font-semibold text-ink">Olhe o papel. Ficou faltando alguma coisa?</p>
          <p className="text-base text-subtle">Um remédio ou um exame que não apareceu.</p>
          <Button variant="primary" onClick={() => guardar(false)} className="h-16 text-xl">Não, apareceu tudo</Button>
          <Button onClick={() => guardar(true)} className="h-14 text-lg">Sim, ficou faltando</Button>
        </div>
        {botaoVoltar}
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

  const finais = conferidos(leitura, respostas);
  const valendo = finais.filter((r) => r.resposta === "igual" && (r.classe.acao === "novo" || r.classe.acao === "mudar"));
  const paraFamilia = finais.filter((r) => r.recusou || r.classe.acao === "duvida" || r.classe.acao === "parar");
  const parar = finais.some((r) => r.classe.acao === "parar");
  const temExames = leitura.papel.exames.length > 0;
  const exameForaDaLista = temExames && !!respostas.recusas.exames;

  return (
    <div className="flex flex-col gap-3">
      <div ref={pergunta} className={`${cartao} scroll-mt-16`} role="status">
        <p className="text-2xl font-semibold text-success">✓ Pronto</p>
        {valendo.length > 0 && (
          <p className="text-lg text-ink">
            <strong>Já vale na lista:</strong> {valendo.map((r) => r.nome).join(", ")}.
          </p>
        )}
        {temExames && !exameForaDaLista && (
          <p className="text-lg text-ink">
            <strong>Exame anotado:</strong> {leitura.papel.exames.join(", ")}.
          </p>
        )}
        {(paraFamilia.length > 0 || exameForaDaLista) && (
          <p className="rounded-xl bg-warn/10 p-3 text-lg text-ink">
            <strong>Não coloquei:</strong>{" "}
            {[...paraFamilia.map((r) => r.nome), ...(exameForaDaLista ? ["o pedido de exame"] : [])].join(", ")}. A família
            vai olhar a foto.
            {paraFamilia.length > 0 && " Os remédios ficam em “Esperando a família”, e você pode pedir a aprovação."}
          </p>
        )}
        {parar && (
          <p className="rounded-xl bg-danger/10 p-3 text-lg font-medium text-danger">
            O papel parece mandar parar um remédio. Fale com a família antes da próxima dose.
          </p>
        )}
        <p className="text-base text-subtle">A família vai conferir com a foto.</p>
      </div>
      {(valendo.length > 0 || paraFamilia.length > 0) && (
        <Link href="/hoje/remedios" className="flex min-h-14 items-center justify-center rounded-lg bg-primary text-lg font-medium text-white">
          Ver os remédios de hoje
        </Link>
      )}
      <Button onClick={onFim} className="h-14 text-lg">Fechar</Button>
    </div>
  );
}

/** O que está sendo conferido, em letra grande. */
function Destaque({ children, atencao }: { children: React.ReactNode; atencao?: boolean }) {
  return (
    <div className={cn("rounded-xl px-3 py-4 text-center text-2xl font-bold leading-tight", atencao ? "bg-warn/15 text-warn" : "bg-panel text-ink")}>
      {children}
    </div>
  );
}

const Pequeno = ({ children }: { children: React.ReactNode }) => <p className="text-base text-subtle">{children}</p>;

/** Toda conferência manda olhar o papel: sem isso, é fácil confiar demais na leitura. */
function SimNao({ pergunta, onSim, onNao }: { pergunta: string; onSim: () => void; onNao: () => void }) {
  return (
    <>
      <p className="pt-1 text-xl font-semibold text-ink">Olhe o papel. {pergunta}</p>
      <Button variant="primary" onClick={onSim} className="h-16 text-xl">Sim, está igual</Button>
      <Button onClick={onNao} className="h-14 text-lg">Não, ou não sei</Button>
    </>
  );
}

type TelaProps = {
  leitura: Leitura;
  bloco: Bloco;
  passo: Passo;
  /** a agenda já com o dia escolhido, se houver */
  agenda?: Agenda;
  recusa?: string;
  onSim: () => void;
  onNao: (oQue: string) => void;
  onDia: (agenda: Agenda) => void;
  onProximo: () => void;
  onRefazer: () => void;
};

function Tela({ leitura, bloco, passo, agenda: escolhida, recusa, onSim, onNao, onDia, onProximo, onRefazer }: TelaProps) {
  const papel = leitura.papel;

  if (bloco.tipo === "medico") {
    const data = papel.data && /^\d{4}-\d{2}-\d{2}$/.test(papel.data) ? diaMesAno(papel.data) : papel.data;
    return (
      <>
        <Destaque>
          <span className="block">{papel.medico || "Não li o nome do médico"}</span>
          <span className="mt-1 block text-lg">{data ? `Data: ${data}` : "Não li a data"}</span>
        </Destaque>
        <SimNao pergunta="O médico e a data são estes?" onSim={onSim} onNao={() => onNao("o médico e a data")} />
      </>
    );
  }

  if (passo === "recusado") {
    return (
      <>
        <p className="text-2xl font-bold text-ink">Tudo bem, não coloquei.</p>
        <p className="text-lg text-ink">
          {bloco.tipo === "exames" ? "O pedido de exame" : leitura.remedios[bloco.indice].nome} vai para a família olhar na foto,
          porque você não confirmou {recusa}.
        </p>
        <Button variant="primary" onClick={onProximo} className="h-16 text-xl">Continuar</Button>
      </>
    );
  }

  if (bloco.tipo === "exames") {
    if (passo === "exames") {
      return (
        <>
          <Destaque>
            {papel.exames.map((n, i) => (
              <span key={`${i}-${n}`} className="block">{n}</span>
            ))}
          </Destaque>
          <SimNao pergunta="São estes os exames, sem faltar nenhum?" onSim={onSim} onNao={() => onNao("os exames")} />
        </>
      );
    }
    if (passo === "preparo") {
      const preparo = papel.preparo?.trim();
      return (
        <>
          <Destaque>{preparo || "O papel não fala de preparo"}</Destaque>
          {!preparo && <Pequeno>{SEM_PREPARO}</Pequeno>}
          <SimNao
            pergunta={preparo ? "O preparo é este?" : "É verdade que não há preparo escrito?"}
            onSim={onSim}
            onNao={() => onNao("o preparo")}
          />
        </>
      );
    }
    return (
      <>
        <p className="text-2xl font-semibold text-success">✓ Anotado</p>
        <Destaque>{papel.exames.join(", ")}</Destaque>
        <Pequeno>Depois é só marcar o dia em Exames.</Pequeno>
        <Button variant="primary" onClick={onProximo} className="h-16 text-xl">Continuar</Button>
        <Button onClick={onRefazer} className="h-12 text-base">Conferir de novo</Button>
      </>
    );
  }

  const item = leitura.remedios[bloco.indice];
  const classe = item.classe;
  const nomeCompleto = [item.nome, item.dosagem].filter(Boolean).join(" ");
  const titulo = <p className="text-xl font-bold leading-tight text-ink">{nomeCompleto}</p>;
  const noPapel = item.texto ? <Pequeno>No papel: “{item.texto}”</Pequeno> : <Pequeno>Não li como tomar.</Pequeno>;
  const agenda = escolhida ?? (classe.acao === "novo" ? classe.agenda : undefined);

  if (passo === "aviso") {
    const parar = classe.acao === "parar";
    return (
      <>
        <p className="text-2xl font-bold leading-tight text-warn">
          {parar ? "O papel parece mandar parar este remédio" : "Este eu não coloco sozinho"}
        </p>
        {titulo}
        {noPapel}
        <p className="text-lg text-ink">
          {classe.acao === "duvida" ? `Porque ${classe.motivo}. A família vai olhar a foto.` : "Não mudei nada. Fale com a família antes da próxima dose."}
        </p>
        <Button variant="primary" onClick={onProximo} className="h-16 text-xl">Entendi, continuar</Button>
      </>
    );
  }

  if (passo === "nome") {
    return (
      <>
        {classe.acao === "ja_toma" && <Pequeno>Este já está na lista. Confira mesmo assim.</Pequeno>}
        {classe.acao === "mudar" && <Pequeno>Este já está na lista, e o papel tem mudança.</Pequeno>}
        <Destaque>
          <span className="block">{item.nome}</span>
          <span className="mt-1 block">{item.dosagem || "Não li a dose"}</span>
        </Destaque>
        <SimNao pergunta="O nome e a dose são estes?" onSim={onSim} onNao={() => onNao("o nome e a dose")} />
      </>
    );
  }

  if (passo === "como") {
    return (
      <>
        {titulo}
        <Destaque>{item.texto ? `“${item.texto}”` : "Não li como tomar"}</Destaque>
        <SimNao
          pergunta={item.texto ? "Está escrito assim, com tudo?" : "Ele não explica como tomar?"}
          onSim={onSim}
          onNao={() => onNao("o modo de tomar")}
        />
      </>
    );
  }

  if (passo === "muda" && classe.acao === "mudar") {
    return (
      <>
        {titulo}
        <Pequeno>Em {classe.alvo.nome}, a lista vai mudar:</Pequeno>
        <Destaque atencao>
          {classe.mudancas.map((m) => (
            <span key={m} className="block text-xl">{m}</span>
          ))}
        </Destaque>
        <SimNao pergunta="É essa a mudança?" onSim={onSim} onNao={() => onNao("a mudança")} />
      </>
    );
  }

  if (passo === "anotado") {
    return (
      <>
        <p className="text-2xl font-semibold text-success">✓ Anotado</p>
        {titulo}
        <Destaque>
          <span className="text-xl">
            {classe.acao === "ja_toma"
              ? "Já está na lista. Não vou colocar de novo."
              : classe.acao === "mudar"
                ? classe.mudancas.join(". ")
                : agenda
                  ? frase(agenda)
                  : ""}
          </span>
        </Destaque>
        <Button variant="primary" onClick={onProximo} className="h-16 text-xl">Continuar</Button>
        <Button onClick={onRefazer} className="h-12 text-base">Conferir este de novo</Button>
      </>
    );
  }

  if (classe.acao !== "novo" || !agenda) return null;

  if (passo === "vezes") {
    const naoDiario = !!classe.recorrencia;
    return (
      <>
        {titulo}
        {naoDiario && <p className="text-xl font-bold text-danger">Atenção: não é de todo dia</p>}
        <Destaque atencao={naoDiario}>{quantasVezes(classe.agenda, classe.recorrencia)}</Destaque>
        {classe.agenda.frequencia === "unica" && (
          <p className="text-base font-medium text-warn">Se for uma vez todo dia, toque em “Não, ou não sei”.</p>
        )}
        <SimNao pergunta="É isso mesmo?" onSim={onSim} onNao={() => onNao("quantas vezes tomar")} />
      </>
    );
  }

  if (passo === "dia" && classe.recorrencia) {
    return (
      <>
        {titulo}
        <EscolherDia
          recorrencia={classe.recorrencia}
          marcados={agenda.dias_semana}
          onSemana={(dias) => onDia({ ...classe.agenda, dias_semana: dias })}
          onData={(inicio) => onDia(aplicarInicio(classe.agenda, inicio, classe.duracao))}
        />
        <Button variant="ghost" onClick={() => onNao("o dia de tomar")} className="h-12 text-base">Não sei o dia</Button>
      </>
    );
  }

  if (passo === "hora") {
    return (
      <>
        {titulo}
        <Pequeno>A que hora do dia:</Pequeno>
        <Destaque>{horaDoDia(agenda)}</Destaque>
        {!agenda.horarios.length && (
          <p className="text-base font-medium text-warn">
            Na lista ele aparece uma vez no dia. Se for mais de uma vez, siga o papel e avise a família.
          </p>
        )}
        <SimNao pergunta="É isso mesmo?" onSim={onSim} onNao={() => onNao("a hora de tomar")} />
      </>
    );
  }

  if (passo === "ate") {
    const total = agenda.fim ? diasEntre(agenda.inicio, agenda.fim) + 1 : 0;
    return (
      <>
        {titulo}
        <Pequeno>Até quando tomar:</Pequeno>
        <Destaque>
          {agenda.fim ? (
            <>
              <span className="block">Até {diaMesAno(agenda.fim)}</span>
              <span className="mt-1 block text-lg">
                {total} {total === 1 ? "dia" : "dias"}, a partir de {agenda.inicio === hojeBR() ? "hoje" : diaMes(agenda.inicio)}
              </span>
            </>
          ) : (
            "Sem data para acabar"
          )}
        </Destaque>
        <SimNao pergunta="É isso mesmo?" onSim={onSim} onNao={() => onNao("até quando tomar")} />
      </>
    );
  }

  return null;
}

const DIAS: [number, string][] = [
  [1, "Segunda"], [2, "Terça"], [3, "Quarta"], [4, "Quinta"], [5, "Sexta"], [6, "Sábado"], [0, "Domingo"],
];

/** Escolher quando tomar. Com uma escolha só, tocar já responde. */
function EscolherDia({
  recorrencia,
  marcados,
  onSemana,
  onData,
}: {
  recorrencia: Recorrencia;
  marcados: number[];
  onSemana: (dias: number[]) => void;
  onData: (inicio: string) => void;
}) {
  const [dias, setDias] = useState<number[]>(marcados);
  const [outro, setOutro] = useState(false);
  const [data, setData] = useState("");
  const hoje = hojeBR();
  const botao = (marcado: boolean) =>
    cn("min-h-16 rounded-xl border-2 px-2 text-lg font-semibold", marcado ? "border-primary bg-primary text-white" : "border-line bg-card text-ink");

  if (recorrencia.tipo === "semana") {
    const um = recorrencia.vezes === 1;
    const pronto = recorrencia.vezes ? dias.length === recorrencia.vezes : dias.length > 0;
    return (
      <>
        <p className="text-xl font-semibold text-ink">
          {um ? "Em que dia da semana ele toma?" : `Em que dias da semana ele toma?${recorrencia.vezes ? ` Escolha ${recorrencia.vezes}.` : ""}`}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {DIAS.map(([d, nome]) => (
            <button
              key={d}
              type="button"
              aria-pressed={dias.includes(d)}
              onClick={() => (um ? onSemana([d]) : setDias((l) => (l.includes(d) ? l.filter((x) => x !== d) : [...l, d].sort())))}
              className={botao(dias.includes(d))}
            >
              {nome}
            </button>
          ))}
        </div>
        {!um && (
          <Button variant="primary" disabled={!pronto} onClick={() => onSemana(dias)} className="h-16 text-xl">Continuar</Button>
        )}
      </>
    );
  }

  return (
    <>
      <p className="text-xl font-semibold text-ink">
        {recorrencia.tipo === "unica" ? "Que dia ele toma?" : "Quando ele toma a próxima?"}
      </p>
      {outro ? (
        <>
          <Input
            type="date"
            aria-label="Escolha o dia"
            min={hoje}
            max={somarMeses(hoje, 24)}
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="h-14 text-lg"
          />
          <Button variant="primary" disabled={!data || data < hoje} onClick={() => onData(data)} className="h-16 text-xl">Continuar</Button>
          <Button onClick={() => setOutro(false)} className="h-12 text-base">É hoje</Button>
        </>
      ) : (
        <>
          <button type="button" onClick={() => onData(hoje)} className={botao(false)}>Hoje, {diaMes(hoje)}</button>
          <button type="button" onClick={() => setOutro(true)} className={botao(false)}>Outro dia</button>
        </>
      )}
    </>
  );
}
