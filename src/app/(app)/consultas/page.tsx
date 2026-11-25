"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Badge, Button, Card, Field, Input } from "@/components/ui";
import type { ResumoConsulta } from "@/lib/ai/schemas";
import { AVISO_PLANO_GRATIS, NOME_PROVEDOR } from "@/lib/ai/nome-provedor";
import { IACarregando } from "@/components/ia-carregando";
import { ConsultaCuidadora } from "@/components/consulta-cuidadora";

type Consulta = {
  id: string;
  data: string | null;
  medico: string | null;
  especialidade: string | null;
  audio_url: string | null;
  status_processamento: string | null;
  transcricao: string | null;
  resumo_json: ResumoConsulta | null;
  retorno_em: string | null;
};

const MUDANCA: Record<string, string> = {
  iniciar: "iniciar",
  suspender: "suspender",
  ajustar: "ajustar",
  manter: "manter",
  mencionado: "citado",
};

function ConsultaItem({
  c,
  audioUrl,
  onRemover,
  onAtualizar,
}: {
  c: Consulta;
  audioUrl?: string;
  onRemover: () => void;
  onAtualizar: () => Promise<void>;
}) {
  const supabase = createClient();
  const [texto, setTexto] = useState(c.transcricao ?? "");
  const [aberto, setAberto] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const r = c.resumo_json;

  async function gerar() {
    setErro(null);
    setGerando(true);
    const { error } = await supabase
      .from("consulta")
      .update({ transcricao: texto.trim() })
      .eq("id", c.id);
    if (error) {
      setErro(error.message);
      setGerando(false);
      return;
    }
    try {
      const resp = await fetch("/api/ia/consulta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consultaId: c.id }),
      });
      const json = await resp.json();
      if (!resp.ok) setErro(json.erro ?? "Não consegui gerar o resumo.");
    } catch {
      setErro("Sem conexão com o servidor. Tente de novo.");
    }
    setGerando(false);
    await onAtualizar();
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-ink">
            {[c.medico, c.especialidade].filter(Boolean).join(" · ") || "Consulta"}
          </p>
          <p className="text-xs text-subtle">{dataLegivel(c.data)}</p>
          {c.retorno_em && <p className="text-xs text-ink">Volta marcada: {c.retorno_em.split("-").reverse().join("/")}</p>}
        </div>
        <div className="flex items-center gap-2">
          {c.status_processamento === "concluido" && <Badge tone="success">resumida</Badge>}
          {c.status_processamento === "falhou" && <Badge tone="warn">falhou</Badge>}
          <Button variant="ghost" onClick={onRemover} className="h-7 px-2 text-xs">
            Remover
          </Button>
        </div>
      </div>

      {audioUrl ? (
        <audio controls src={audioUrl} className="w-full" />
      ) : (
        <p className="text-xs text-subtle">Sem áudio.</p>
      )}

      {r && (
        <div className="flex flex-col gap-3 rounded-lg bg-panel p-4">
          <p className="text-sm text-ink">{r.resumo}</p>
          {r.acoes.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
                O que fazer
              </p>
              <ul className="mt-1 list-disc pl-5 text-sm text-ink">
                {r.acoes.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}
          {r.remedios.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
                Remédios
              </p>
              <ul className="mt-1 flex flex-col gap-1 text-sm text-ink">
                {r.remedios.map((m, i) => (
                  <li key={i}>
                    <span className="font-medium">{m.nome}</span>
                    {m.dosagem && <span className="text-subtle"> · {m.dosagem}</span>}
                    <span className="text-subtle"> · {MUDANCA[m.mudanca] ?? m.mudanca}</span>
                    {m.detalhe && <span className="text-subtle"> · {m.detalhe}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {r.exames.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
                Exames pedidos
              </p>
              <ul className="mt-1 list-disc pl-5 text-sm text-ink">
                {r.exames.map((x, i) => (
                  <li key={i}>
                    {x.nome}
                    {x.motivo && <span className="text-subtle"> · {x.motivo}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {r.duvidas.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
                Ficou em aberto
              </p>
              <ul className="mt-1 list-disc pl-5 text-sm text-ink">
                {r.duvidas.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          )}
          {r.retorno && <p className="text-sm text-ink">Retorno: {r.retorno}</p>}
          <p className="text-xs text-subtle">
            Resumo feito por IA a partir do texto abaixo. Confira com o que foi dito
            na consulta antes de agir.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setAberto(!aberto)}
          className="self-start text-xs text-primary hover:underline"
        >
          {aberto ? "Esconder texto da consulta" : r ? "Ver ou editar o texto da consulta" : "Colar o texto da consulta e gerar resumo"}
        </button>
        {aberto && (
          <>
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={8}
              placeholder="Cole aqui o que foi dito na consulta (transcrição ou anotações)."
              className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            />
            {erro && <p className="text-sm text-danger">{erro}</p>}
            <Button
              variant="primary"
              onClick={gerar}
              disabled={gerando || texto.trim().length < 40}
              className="self-start"
            >
              {gerando ? "Gerando resumo..." : r ? "Gerar resumo de novo" : "Gerar resumo"}
            </Button>
            {gerando && <IACarregando rotulo="Gerando o resumo..." />}
            <p className="text-xs text-subtle">
              O texto é enviado à {NOME_PROVEDOR} para gerar o resumo.
              {AVISO_PLANO_GRATIS}
            </p>
          </>
        )}
      </div>
    </Card>
  );
}

// Limite de arquivo do plano gratuito do Storage.
const LIMITE_AUDIO = 50 * 1024 * 1024;

function agoraLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function dataLegivel(iso: string | null) {
  if (!iso) return "Sem data";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function extensaoDe(tipo: string, nome?: string) {
  if (nome && nome.includes(".")) return nome.split(".").pop()!.toLowerCase();
  if (tipo.includes("mp4")) return "m4a";
  if (tipo.includes("ogg")) return "ogg";
  if (tipo.includes("mpeg")) return "mp3";
  return "webm";
}

/** Quem cuida tem uma tela própria, com dois botões; a família vê o histórico completo. */
export default function ConsultasPage() {
  const membership = useRole();
  return membership?.role === "cuidador" ? <ConsultaCuidadora /> : <ConsultasFamilia />;
}

function ConsultasFamilia() {
  const supabase = createClient();
  const membership = useRole();
  const idosoId = membership?.idosoId;

  const [carregando, setCarregando] = useState(true);
  const [consultas, setConsultas] = useState<Consulta[]>([]);
  const [audios, setAudios] = useState<Record<string, string>>({});

  const [data, setData] = useState(agoraLocal());
  const [medico, setMedico] = useState("");
  const [especialidade, setEspecialidade] = useState("");
  const [audio, setAudio] = useState<Blob | null>(null);
  const [audioNome, setAudioNome] = useState<string | undefined>();
  const [gravando, setGravando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const gravador = useRef<MediaRecorder | null>(null);
  const pedacos = useRef<Blob[]>([]);
  const relogio = useRef<ReturnType<typeof setInterval> | null>(null);

  const carregar = useCallback(async () => {
    if (!idosoId) {
      setCarregando(false);
      return;
    }
    setCarregando(true);
    const { data: lista } = await supabase
      .from("consulta")
      .select(
        "id, data, medico, especialidade, audio_url, status_processamento, transcricao, resumo_json, retorno_em",
      )
      .eq("idoso_id", idosoId)
      .is("deleted_at", null)
      .order("data", { ascending: false })
      .limit(40);
    const cs = (lista ?? []) as Consulta[];
    setConsultas(cs);

    const mapa: Record<string, string> = {};
    await Promise.all(
      cs
        .filter((c) => c.audio_url)
        .map(async (c) => {
          const { data: assinada } = await supabase.storage
            .from("consultas")
            .createSignedUrl(c.audio_url as string, 3600);
          if (assinada?.signedUrl) mapa[c.id] = assinada.signedUrl;
        }),
    );
    setAudios(mapa);
    setCarregando(false);
  }, [supabase, idosoId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(
    () => () => {
      if (relogio.current) clearInterval(relogio.current);
      gravador.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  async function iniciarGravacao() {
    setErro(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setErro("Este navegador não grava áudio. Envie um arquivo de áudio no lugar.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      pedacos.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) pedacos.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(pedacos.current, { type: rec.mimeType || "audio/webm" });
        setAudio(blob);
        setAudioNome(undefined);
        stream.getTracks().forEach((t) => t.stop());
      };
      rec.start();
      gravador.current = rec;
      setSegundos(0);
      setGravando(true);
      relogio.current = setInterval(() => setSegundos((s) => s + 1), 1000);
    } catch {
      setErro("Não consegui acessar o microfone. Libere a permissão no navegador.");
    }
  }

  function pararGravacao() {
    gravador.current?.stop();
    if (relogio.current) clearInterval(relogio.current);
    setGravando(false);
  }

  function escolherArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setAudio(f);
    setAudioNome(f.name);
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!idosoId) return;
    setErro(null);
    if (audio && audio.size > LIMITE_AUDIO) {
      setErro("O áudio passa de 50 MB. Grave em partes ou comprima o arquivo.");
      return;
    }
    setSalvando(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let caminho: string | null = null;
    if (audio) {
      caminho = `${idosoId}/${crypto.randomUUID()}.${extensaoDe(audio.type, audioNome)}`;
      const { error: upErro } = await supabase.storage
        .from("consultas")
        .upload(caminho, audio, { upsert: false, contentType: audio.type || undefined });
      if (upErro) {
        setErro(`Não consegui subir o áudio: ${upErro.message}`);
        setSalvando(false);
        return;
      }
    }

    const { error } = await supabase.from("consulta").insert({
      idoso_id: idosoId,
      autor_id: user!.id,
      data: new Date(data).toISOString(),
      medico: medico.trim() || null,
      especialidade: especialidade.trim() || null,
      audio_url: caminho,
      status_processamento: "pendente",
    });
    if (error) {
      setErro(error.message);
      setSalvando(false);
      return;
    }
    setMedico("");
    setEspecialidade("");
    setData(agoraLocal());
    setAudio(null);
    setAudioNome(undefined);
    setSalvando(false);
    await carregar();
  }

  async function remover(id: string) {
    await supabase
      .from("consulta")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    await carregar();
  }

  if (!membership) {
    return (
      <p className="text-sm text-subtle">
        Crie o perfil do idoso primeiro para registrar consultas.
      </p>
    );
  }

  const mmss = `${String(Math.floor(segundos / 60)).padStart(2, "0")}:${String(segundos % 60).padStart(2, "0")}`;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Consultas</h1>
        <p className="text-sm text-subtle">
          Registre as consultas de {membership.idosoNome} e guarde o áudio para ouvir
          depois.
        </p>
      </div>

      <Card className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-ink">Nova consulta</h2>
        <form onSubmit={salvar} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Data e hora">
              <Input
                type="datetime-local"
                value={data}
                onChange={(e) => setData(e.target.value)}
                required
              />
            </Field>
            <Field label="Médico">
              <Input
                value={medico}
                onChange={(e) => setMedico(e.target.value)}
                placeholder="Nome"
              />
            </Field>
            <Field label="Especialidade">
              <Input
                value={especialidade}
                onChange={(e) => setEspecialidade(e.target.value)}
                placeholder="Ex: cardiologia"
              />
            </Field>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm text-subtle">Áudio (opcional)</p>
            <div className="flex flex-wrap items-center gap-2">
              {!gravando ? (
                <Button type="button" onClick={iniciarGravacao}>
                  Gravar agora
                </Button>
              ) : (
                <Button type="button" variant="primary" onClick={pararGravacao}>
                  Parar ({mmss})
                </Button>
              )}
              <span className="text-xs text-subtle">ou</span>
              <input
                type="file"
                accept="audio/*"
                onChange={escolherArquivo}
                className="text-sm text-subtle file:mr-3 file:rounded-lg file:border file:border-line file:bg-panel file:px-3 file:py-2 file:text-sm file:text-ink"
              />
            </div>
            {audio && !gravando && (
              <p className="text-xs text-subtle">
                Áudio pronto: {audioNome ?? "gravação"} (
                {(audio.size / 1024 / 1024).toFixed(1)} MB).
              </p>
            )}
          </div>

          {erro && <p className="text-sm text-danger">{erro}</p>}
          <Button variant="primary" type="submit" disabled={salvando || gravando}>
            {salvando ? "Salvando..." : "Salvar consulta"}
          </Button>
        </form>
      </Card>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-ink">Consultas registradas</h2>
        {carregando && <p className="text-sm text-subtle">Carregando...</p>}
        {!carregando && consultas.length === 0 && (
          <p className="text-sm text-subtle">Nenhuma consulta ainda.</p>
        )}
        {consultas.map((c) => (
          <ConsultaItem
            key={c.id}
            c={c}
            audioUrl={audios[c.id]}
            onRemover={() => remover(c.id)}
            onAtualizar={carregar}
          />
        ))}
      </div>
    </div>
  );
}
