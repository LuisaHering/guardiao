"use client";

// Gravação da consulta, protegida. Fica na moldura do app (não na tela), então trocar de
// tela não perde o áudio. Proteções:
//  * mantém a tela acesa (quando o navegador permite);
//  * aviso em letra grande para não fechar nem bloquear o celular;
//  * avisa se a gravação for interrompida, e guarda o que foi gravado até ali.
// Nenhuma delas garante que o navegador não pare de gravar: elas reduzem o risco e avisam.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Button } from "@/components/ui";
import { EVENTO_CONSULTA, guardarAudio } from "@/lib/consulta";
import { horaBR } from "@/lib/medicacao";

type Estado = "parado" | "gravando" | "guardando" | "falhou";

type Gravacao = {
  estado: Estado;
  segundos: number;
  /** devolve a mensagem de erro, ou null se começou */
  iniciar: (forcarNova?: boolean) => Promise<string | null>;
  parar: () => void;
};

const Contexto = createContext<Gravacao | null>(null);

export function useGravacao() {
  const c = useContext(Contexto);
  if (!c) throw new Error("useGravacao fora do GravacaoProvider");
  return c;
}

const relogioTexto = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/** Sem pedaço novo por este tempo, a gravação provavelmente parou. */
const SILENCIO_DO_GRAVADOR_MS = 6000;

export function GravacaoProvider({ children }: { children: React.ReactNode }) {
  const membership = useRole();
  const idosoId = membership?.idosoId;

  const [estado, setEstado] = useState<Estado>("parado");
  const [segundos, setSegundos] = useState(0);
  const [telaAcesa, setTelaAcesa] = useState(true);
  const [alerta, setAlerta] = useState<string | null>(null);
  const [interrompida, setInterrompida] = useState<string | null>(null);
  const [guardada, setGuardada] = useState(false);
  const [baixar, setBaixar] = useState<string | null>(null);

  const gravador = useRef<MediaRecorder | null>(null);
  const pedacos = useRef<Blob[]>([]);
  const ultimoPedaco = useRef(0);
  const relogio = useRef<number | null>(null);
  const trava = useRef<WakeLockSentinel | null>(null);
  const paradaPedida = useRef(false);
  const motivoInterrupcao = useRef<string | null>(null);
  const pendente = useRef<{ audio: Blob; forcarNova: boolean } | null>(null);

  const acenderTela = useCallback(async () => {
    try {
      if (!("wakeLock" in navigator)) {
        setTelaAcesa(false);
        return;
      }
      trava.current = await navigator.wakeLock.request("screen");
      setTelaAcesa(true);
      trava.current.addEventListener("release", () => {
        if (gravador.current?.state === "recording" && document.visibilityState === "visible") setTelaAcesa(false);
      });
    } catch {
      setTelaAcesa(false);
    }
  }, []);

  const soltar = useCallback(() => {
    if (relogio.current) window.clearInterval(relogio.current);
    relogio.current = null;
    trava.current?.release().catch(() => {});
    trava.current = null;
    gravador.current?.stream.getTracks().forEach((t) => t.stop());
  }, []);

  const enviar = useCallback(async () => {
    const item = pendente.current;
    if (!item || !idosoId) return;
    setEstado("guardando");
    try {
      await guardarAudio(createClient(), idosoId, item.audio, item.forcarNova);
      pendente.current = null;
      setBaixar((url) => {
        if (url) URL.revokeObjectURL(url);
        return null;
      });
      setEstado("parado");
      setGuardada(true);
      window.dispatchEvent(new Event(EVENTO_CONSULTA));
    } catch {
      setBaixar((url) => url ?? URL.createObjectURL(item.audio));
      setEstado("falhou");
    }
  }, [idosoId]);

  const parar = useCallback(() => {
    paradaPedida.current = true;
    if (gravador.current && gravador.current.state !== "inactive") gravador.current.stop();
  }, []);

  /** Algo parou a gravação sem a pessoa pedir: avisa e encerra, guardando o que há. */
  const interromper = useCallback((motivo: string) => {
    if (paradaPedida.current || motivoInterrupcao.current) return;
    motivoInterrupcao.current = `${motivo} (às ${horaBR()})`;
    const g = gravador.current;
    if (g && g.state !== "inactive") g.stop();
    else setInterrompida(motivoInterrupcao.current);
  }, []);

  const iniciar = useCallback(
    async (forcarNova = false) => {
      if (pendente.current) return "Há uma gravação que ainda não foi guardada. Resolva essa primeiro.";
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        return "Este navegador não grava áudio.";
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        return "Não consegui usar o microfone. Toque em permitir quando o celular perguntar.";
      }
      const g = new MediaRecorder(stream);
      pedacos.current = [];
      paradaPedida.current = false;
      motivoInterrupcao.current = null;
      setInterrompida(null);
      setAlerta(null);
      setGuardada(false);

      g.ondataavailable = (e) => {
        if (e.data.size > 0) {
          pedacos.current.push(e.data);
          ultimoPedaco.current = Date.now();
          setAlerta((a) => (a?.startsWith("A gravação parece") ? null : a));
        }
      };
      g.onerror = () => interromper("O gravador do celular deu erro");
      g.onstop = () => {
        const audio = new Blob(pedacos.current, { type: g.mimeType || "audio/webm" });
        soltar();
        if (!paradaPedida.current) {
          setInterrompida(motivoInterrupcao.current ?? `A gravação parou sozinha (às ${horaBR()})`);
        }
        if (audio.size > 0) {
          pendente.current = { audio, forcarNova };
          enviar();
        } else {
          setEstado("parado");
        }
      };
      for (const faixa of stream.getAudioTracks()) {
        faixa.onended = () => interromper("O microfone foi desligado, talvez por uma ligação");
        faixa.onmute = () => setAlerta("O microfone parou de captar o som. Confira se há uma ligação ou outro aplicativo usando.");
        faixa.onunmute = () => setAlerta(null);
      }

      // Em pedaços de 1 s: se algo parar no meio, o que veio antes está guardado.
      g.start(1000);
      gravador.current = g;
      ultimoPedaco.current = Date.now();
      setSegundos(0);
      setEstado("gravando");
      await acenderTela();
      relogio.current = window.setInterval(() => {
        setSegundos((s) => s + 1);
        if (Date.now() - ultimoPedaco.current > SILENCIO_DO_GRAVADOR_MS) {
          setAlerta("A gravação parece ter parado. Toque em Parar e guardar, e comece outra.");
        }
      }, 1000);
      return null;
    },
    [acenderTela, enviar, interromper, soltar],
  );

  // Saiu da tela, bloqueou o celular ou trocou de aplicativo: é quando a gravação costuma parar.
  useEffect(() => {
    if (estado !== "gravando") return;
    let saiuAs: string | null = null;
    function mudou() {
      if (document.visibilityState === "hidden") {
        saiuAs = horaBR();
        return;
      }
      const g = gravador.current;
      if (!g || g.state !== "recording") {
        interromper("A tela foi bloqueada ou o aplicativo foi trocado");
        return;
      }
      if (saiuAs) {
        setAlerta(`Você saiu desta tela às ${saiuAs}. A gravação pode ter um pedaço sem som.`);
      }
      ultimoPedaco.current = Date.now();
      acenderTela();
    }
    document.addEventListener("visibilitychange", mudou);
    return () => document.removeEventListener("visibilitychange", mudou);
  }, [estado, acenderTela, interromper]);

  // Fechar ou recarregar a página perderia o áudio: o navegador pede confirmação.
  useEffect(() => {
    if (estado === "parado") return;
    const antesDeSair = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", antesDeSair);
    return () => window.removeEventListener("beforeunload", antesDeSair);
  }, [estado]);

  return (
    <Contexto.Provider value={{ estado, segundos, iniciar, parar }}>
      {(estado !== "parado" || interrompida || guardada) && (
        <PainelGravacao
          estado={estado}
          segundos={segundos}
          telaAcesa={telaAcesa}
          alerta={alerta}
          interrompida={interrompida}
          guardada={guardada}
          baixar={baixar}
          onParar={parar}
          onTentar={enviar}
          onEntendi={() => {
            setInterrompida(null);
            setGuardada(false);
          }}
        />
      )}
      {children}
    </Contexto.Provider>
  );
}

function PainelGravacao(p: {
  estado: Estado;
  segundos: number;
  telaAcesa: boolean;
  alerta: string | null;
  interrompida: string | null;
  guardada: boolean;
  baixar: string | null;
  onParar: () => void;
  onTentar: () => void;
  onEntendi: () => void;
}) {
  return (
    <div className="sticky top-0 z-[25] -mx-4 -mt-4 mb-4 flex flex-col gap-2 border-b-2 border-danger bg-card p-3 shadow-lg sm:-mx-6 sm:-mt-6" aria-live="assertive">
      {p.estado === "gravando" && (
        <>
          <p className="flex items-center justify-center gap-2 text-lg font-semibold text-danger">
            <span className="h-3 w-3 animate-pulse rounded-full bg-danger" aria-hidden />
            Gravando {relogioTexto(p.segundos)}
          </p>
          <p className="text-center text-2xl font-bold leading-tight text-ink">Não feche nem bloqueie o celular</p>
          {!p.telaAcesa && (
            <p className="rounded-lg bg-warn/15 p-2 text-center text-base font-medium text-warn">
              Não consegui manter a tela acesa. Toque na tela de vez em quando.
            </p>
          )}
          {p.alerta && (
            <p className="rounded-lg bg-warn/15 p-2 text-center text-base font-medium text-warn" role="alert">{p.alerta}</p>
          )}
          <button type="button" onClick={p.onParar} className="min-h-14 rounded-xl bg-danger text-lg font-bold text-white">
            Parar e guardar
          </button>
        </>
      )}

      {p.interrompida && (
        <div className="rounded-xl border-2 border-danger bg-danger/10 p-3" role="alert">
          <p className="text-xl font-bold text-danger">A gravação foi interrompida</p>
          <p className="text-base text-ink">{p.interrompida}. O que veio depois não foi gravado.</p>
        </div>
      )}

      {p.estado === "guardando" && <p className="text-center text-lg font-semibold text-ink">Guardando o áudio. Não feche o aplicativo.</p>}

      {p.estado === "falhou" && (
        <div className="flex flex-col gap-2" role="alert">
          <p className="text-lg font-bold text-danger">O áudio ainda não foi guardado</p>
          <p className="text-base text-ink">Não feche o aplicativo. Confira a internet e tente de novo.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={p.onTentar} className="h-12 text-base">Tentar de novo</Button>
            {p.baixar && (
              <a href={p.baixar} download="consulta.webm" className="inline-flex h-12 items-center rounded-lg border border-line px-4 text-base text-ink">
                Salvar no celular
              </a>
            )}
          </div>
        </div>
      )}

      {p.estado === "parado" && p.guardada && <p className="text-center text-lg font-semibold text-success">✓ Áudio guardado</p>}

      {p.estado === "parado" && (p.interrompida || p.guardada) && (
        <Button onClick={p.onEntendi} className="h-12 text-base">{p.interrompida ? "Entendi" : "Fechar"}</Button>
      )}
    </div>
  );
}
