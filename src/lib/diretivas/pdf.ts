// Gera o PDF de uma diretiva. Roda no servidor, com pdf-lib (JS puro).
//
// Regras do documento (ver docs/modelagem.md, seção 3.13):
//  - Sempre declara COMO foi preenchido. Se foi outra pessoa, o PDF diz isso em
//    destaque e nunca se apresenta como declaração autônoma do titular.
//  - "Titular presente" aparece como DECLARAÇÃO de quem digitou, não como fato.
//  - Não afirma validade jurídica: é o artefato final, e a formalização
//    (cartório ou prontuário) fica por conta de quem quiser levar adiante.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Item } from "@/lib/diretivas/questionario";

export type DadosPdf = {
  id: string;
  geradaEm: Date;
  titular: { nome: string; dataNascimento: string | null };
  modo: "titular" | "assistido";
  assistente: { nome: string; papel: "familiar" | "cuidador" | "idoso"; admin: boolean } | null;
  versaoQuestionario: string;
  secoes: { titulo: string; intro?: string }[];
  itens: Item[];
  substitui: { geradaEm: Date } | null;
};

export const A4 = { w: 595.28, h: 841.89 };
export const MARGEM = 56;
const RODAPE = 48;
export const LARGURA = A4.w - MARGEM * 2;

export const COR = {
  texto: rgb(0.1, 0.1, 0.12),
  suave: rgb(0.4, 0.42, 0.46),
  linha: rgb(0.82, 0.84, 0.86),
  destaque: rgb(0.93, 0.96, 0.95),
  destaqueBorda: rgb(0.12, 0.48, 0.45),
  aviso: rgb(0.98, 0.95, 0.88),
  avisoBorda: rgb(0.72, 0.5, 0.1),
};

function dataHora(d: Date) {
  return d.toLocaleString("pt-BR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  });
}

function dataCurta(iso: string) {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

function papelTexto(a: NonNullable<DadosPdf["assistente"]>) {
  if (a.papel === "familiar") return a.admin ? "familiar, administrador do cuidado" : "familiar";
  if (a.papel === "cuidador") return a.admin ? "cuidador, administrador do cuidado" : "cuidador";
  return "titular";
}

export class Folha {
  doc: PDFDocument;
  normal!: PDFFont;
  negrito!: PDFFont;
  italico!: PDFFont;
  pagina!: PDFPage;
  y = 0;
  private aceitos!: Set<number>;

  private constructor(doc: PDFDocument) {
    this.doc = doc;
  }

  static async criar() {
    const f = new Folha(await PDFDocument.create());
    f.normal = await f.doc.embedFont(StandardFonts.Helvetica);
    f.negrito = await f.doc.embedFont(StandardFonts.HelveticaBold);
    f.italico = await f.doc.embedFont(StandardFonts.HelveticaOblique);
    f.aceitos = new Set(f.normal.getCharacterSet());
    f.novaPagina();
    return f;
  }

  novaPagina() {
    this.pagina = this.doc.addPage([A4.w, A4.h]);
    this.y = A4.h - MARGEM;
  }

  /** Fontes padrão do PDF não aceitam tudo (ex: emoji). Troco o que não couber por "?". */
  limpar(texto: string) {
    let saida = "";
    for (const ch of texto.replace(/[\t\r]/g, " ")) {
      const cp = ch.codePointAt(0)!;
      saida += cp === 10 || this.aceitos.has(cp) ? ch : "?";
    }
    return saida;
  }

  quebrar(texto: string, fonte: PDFFont, tam: number, largura: number) {
    const linhas: string[] = [];
    for (const paragrafo of this.limpar(texto).split("\n")) {
      if (paragrafo.trim() === "") {
        linhas.push("");
        continue;
      }
      let atual = "";
      for (const palavra of paragrafo.split(/\s+/)) {
        const teste = atual ? `${atual} ${palavra}` : palavra;
        if (fonte.widthOfTextAtSize(teste, tam) <= largura) {
          atual = teste;
        } else {
          if (atual) linhas.push(atual);
          // palavra maior que a linha inteira: corta onde couber
          let resto = palavra;
          while (fonte.widthOfTextAtSize(resto, tam) > largura) {
            let n = resto.length;
            while (n > 1 && fonte.widthOfTextAtSize(resto.slice(0, n), tam) > largura) n--;
            linhas.push(resto.slice(0, n));
            resto = resto.slice(n);
          }
          atual = resto;
        }
      }
      linhas.push(atual);
    }
    return linhas;
  }

  garantir(altura: number) {
    if (this.y - altura < MARGEM + RODAPE) this.novaPagina();
  }

  espaco(n: number) {
    this.y -= n;
  }

  escrever(
    texto: string,
    o: { fonte?: PDFFont; tam?: number; cor?: ReturnType<typeof rgb>; recuo?: number; depois?: number } = {},
  ) {
    const fonte = o.fonte ?? this.normal;
    const tam = o.tam ?? 10.5;
    const recuo = o.recuo ?? 0;
    const entre = tam * 1.4;
    for (const linha of this.quebrar(texto, fonte, tam, LARGURA - recuo)) {
      this.garantir(entre);
      this.y -= entre;
      if (linha) {
        this.pagina.drawText(linha, {
          x: MARGEM + recuo,
          y: this.y,
          size: tam,
          font: fonte,
          color: o.cor ?? COR.texto,
        });
      }
    }
    this.y -= o.depois ?? 0;
  }

  linha() {
    this.garantir(10);
    this.y -= 6;
    this.pagina.drawLine({
      start: { x: MARGEM, y: this.y },
      end: { x: A4.w - MARGEM, y: this.y },
      thickness: 0.6,
      color: COR.linha,
    });
    this.y -= 6;
  }

  /** Caixa com fundo e borda. Cada linha da caixa pode ter seu próprio estilo. */
  caixa(
    linhas: { texto: string; negrito?: boolean; tam?: number }[],
    fundo: ReturnType<typeof rgb>,
    borda: ReturnType<typeof rgb>,
  ) {
    const pad = 12;
    const largura = LARGURA - pad * 2;
    const preparadas = linhas.map((l) => {
      const fonte = l.negrito ? this.negrito : this.normal;
      const tam = l.tam ?? 10.5;
      return { fonte, tam, partes: this.quebrar(l.texto, fonte, tam, largura) };
    });
    const altura =
      pad * 2 + preparadas.reduce((s, p) => s + p.partes.length * p.tam * 1.4 + 4, 0);
    this.garantir(altura);

    const topo = this.y;
    this.pagina.drawRectangle({
      x: MARGEM,
      y: topo - altura,
      width: LARGURA,
      height: altura,
      color: fundo,
      borderColor: borda,
      borderWidth: 0.9,
    });
    let cursor = topo - pad;
    for (const p of preparadas) {
      for (const parte of p.partes) {
        cursor -= p.tam * 1.4;
        if (parte) {
          this.pagina.drawText(parte, {
            x: MARGEM + pad,
            y: cursor,
            size: p.tam,
            font: p.fonte,
            color: COR.texto,
          });
        }
      }
      cursor -= 4;
    }
    this.y = topo - altura - 10;
  }

  rodapes(prefixo: string) {
    const paginas = this.doc.getPages();
    paginas.forEach((pg, i) => {
      const texto = `${prefixo} · página ${i + 1} de ${paginas.length}`;
      const larg = this.normal.widthOfTextAtSize(texto, 8);
      pg.drawText(this.limpar(texto), {
        x: (A4.w - larg) / 2,
        y: 28,
        size: 8,
        font: this.normal,
        color: COR.suave,
      });
    });
  }
}

export async function gerarPdfDiretiva(d: DadosPdf): Promise<Uint8Array> {
  const f = await Folha.criar();
  f.doc.setTitle("Registro de preferências de cuidado e de fim de vida");
  f.doc.setAuthor("Guardião");
  f.doc.setCreationDate(d.geradaEm);

  // Cabeçalho
  f.escrever("Registro de preferências de cuidado e de fim de vida", {
    fonte: f.negrito,
    tam: 17,
  });
  f.escrever("Diretivas antecipadas de vontade · gerado pelo Guardião", {
    tam: 10,
    cor: COR.suave,
    depois: 10,
  });

  f.escrever("Titular", { fonte: f.negrito, tam: 9, cor: COR.suave });
  f.escrever(d.titular.nome, { fonte: f.negrito, tam: 13 });
  if (d.titular.dataNascimento) {
    f.escrever(`Data de nascimento: ${dataCurta(d.titular.dataNascimento)}`, { tam: 10 });
  }
  f.espaco(8);

  // Como foi preenchido: a parte mais importante do documento
  const quem: { texto: string; negrito?: boolean; tam?: number }[] = [
    { texto: "Como este registro foi preenchido", negrito: true, tam: 11 },
  ];
  if (d.modo === "titular") {
    quem.push({ texto: `Preenchido pelo próprio titular, ${d.titular.nome}.` });
  } else if (d.assistente) {
    quem.push(
      {
        texto: `Preenchido por ${d.assistente.nome} (${papelTexto(d.assistente)}), com assistência ao titular.`,
      },
      {
        texto: `No momento de gerar este registro, ${d.assistente.nome} declarou que ${d.titular.nome} estava presente durante o preenchimento e que as respostas refletem o que a própria pessoa disse. Essa declaração é de quem digitou e não foi verificada por nenhum sistema.`,
      },
      {
        texto: "Este registro não é uma declaração autônoma do titular.",
        negrito: true,
      },
    );
  }
  quem.push({ texto: `Gerado em ${dataHora(d.geradaEm)}.`, tam: 9.5 });
  quem.push({ texto: `Código do registro: ${d.id}`, tam: 9.5 });
  quem.push({ texto: `Versão do questionário: ${d.versaoQuestionario}`, tam: 9.5 });
  if (d.substitui) {
    quem.push({
      texto: `Substitui o registro gerado em ${dataHora(d.substitui.geradaEm)}, que continua guardado.`,
      tam: 9.5,
    });
  }
  f.caixa(quem, COR.destaque, COR.destaqueBorda);

  // Seções
  for (const secao of d.secoes) {
    const itens = d.itens.filter((i) => i.secao === secao.titulo);
    if (itens.length === 0) continue;

    f.garantir(60);
    f.espaco(6);
    f.escrever(secao.titulo, { fonte: f.negrito, tam: 12.5 });
    f.linha();
    if (secao.intro) {
      f.escrever(secao.intro, { cor: COR.suave, tam: 10, depois: 4 });
    }

    for (const it of itens) {
      f.garantir(44);
      f.espaco(4);
      f.escrever(it.pergunta, { fonte: f.negrito, tam: 10.5 });
      if (it.ajuda) {
        f.escrever(it.ajuda, { cor: COR.suave, tam: 9, recuo: 0 });
      }
      if (it.texto === null) {
        f.escrever("Não respondido", { fonte: f.italico, cor: COR.suave, recuo: 12 });
      } else {
        f.escrever(it.texto, { recuo: 12 });
      }
    }
  }

  // Aviso final
  f.espaco(14);
  f.caixa(
    [
      { texto: "O que este documento é e o que não é", negrito: true, tam: 10.5 },
      {
        texto:
          "É um registro das preferências de cuidado e de fim de vida da pessoa, organizado para ser levado ao médico ou a um cartório. Não substitui a formalização: a validade jurídica depende de registro em cartório (declaração de vontade) ou no prontuário médico, conforme a Resolução CFM nº 1.995/2012. Em caso de dúvida, procure um advogado ou a Defensoria Pública.",
        tam: 9.5,
      },
    ],
    COR.aviso,
    COR.avisoBorda,
  );

  f.rodapes(`Guardião · registro ${d.id}`);
  return f.doc.save();
}
