// PDF da folha "como cuidar de mim". Reaproveita o layout do PDF das diretivas.
//
// Os FATOS de segurança (alergias, condições, medicação, contatos) vêm do banco e
// são impressos como estão; a IA só redige as preferências. Assim ela não tem como
// errar nem inventar um remédio ou uma alergia.

import { COR, Folha } from "@/lib/diretivas/pdf";

export type ConteudoFolha = {
  nome: string;
  comoChamar: string | null;
  ia: { apresentacao: string; secoes: { titulo: string; itens: string[] }[] };
  fatos: {
    alergias: { substancia: string; reacao: string | null; gravidade: string | null }[];
    condicoes: string[];
    medicacoes: { nome: string; dosagem: string | null; instrucoes: string | null }[];
    contatos: { nome: string; telefone: string | null; relacao: string | null }[];
  };
  fontes: string[];
};

function dataHora(d: Date) {
  return d.toLocaleString("pt-BR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  });
}

export async function gerarPdfFolha(c: ConteudoFolha, geradaEm: Date): Promise<Uint8Array> {
  const f = await Folha.criar();
  f.doc.setTitle(`Como cuidar de ${c.nome}`);
  f.doc.setAuthor("Guardião");
  f.doc.setCreationDate(geradaEm);

  f.escrever(`Como cuidar de ${c.nome}`, { fonte: f.negrito, tam: 18 });
  f.escrever(`Folha prática de cuidado · gerada pelo Guardião em ${dataHora(geradaEm)}`, {
    tam: 9.5,
    cor: COR.suave,
    depois: 10,
  });

  f.caixa(
    [
      { texto: c.ia.apresentacao },
      ...(c.comoChamar ? [{ texto: `Gosta de ser chamado de: ${c.comoChamar}`, negrito: true }] : []),
    ],
    COR.destaque,
    COR.destaqueBorda,
  );

  // Saúde: logo no início, porque é o que mais pesa numa troca de turno.
  const atencao: { texto: string; negrito?: boolean; tam?: number }[] = [
    { texto: "Atenção: saúde", negrito: true, tam: 11 },
  ];
  atencao.push({
    texto: c.fatos.alergias.length
      ? `Alergias: ${c.fatos.alergias
          .map(
            (a) =>
              `${a.substancia}${a.reacao ? ` (${a.reacao})` : ""}${a.gravidade ? `, gravidade ${a.gravidade}` : ""}`,
          )
          .join("; ")}.`
      : "Alergias: nenhuma registrada.",
  });
  atencao.push({
    texto: c.fatos.condicoes.length
      ? `Condições: ${c.fatos.condicoes.join("; ")}.`
      : "Condições: nenhuma registrada.",
  });
  atencao.push({
    texto: c.fatos.medicacoes.length
      ? `Medicação em uso: ${c.fatos.medicacoes
          .map((m) => `${m.nome}${m.dosagem ? ` ${m.dosagem}` : ""}${m.instrucoes ? ` (${m.instrucoes})` : ""}`)
          .join("; ")}.`
      : "Medicação em uso: nenhuma registrada.",
  });
  f.caixa(atencao, COR.aviso, COR.avisoBorda);

  for (const s of c.ia.secoes) {
    if (s.itens.length === 0) continue;
    f.garantir(60);
    f.espaco(6);
    f.escrever(s.titulo, { fonte: f.negrito, tam: 12.5 });
    f.linha();
    for (const item of s.itens) {
      f.escrever(`•  ${item}`, { recuo: 6 });
    }
  }

  if (c.fatos.contatos.length > 0) {
    f.garantir(60);
    f.espaco(10);
    f.escrever("Quem chamar", { fonte: f.negrito, tam: 12.5 });
    f.linha();
    for (const ct of c.fatos.contatos) {
      f.escrever(
        `•  ${ct.nome}${ct.relacao ? ` (${ct.relacao})` : ""}${ct.telefone ? `: ${ct.telefone}` : ""}`,
        { recuo: 6 },
      );
    }
  }

  f.espaco(14);
  f.caixa(
    [
      { texto: "De onde vêm estas informações", negrito: true, tam: 10 },
      {
        texto: `Preferências registradas${c.fontes.length ? ` por ${c.fontes.join(", ")}` : ""} no Guardião e organizadas por IA. As informações de saúde vêm do cadastro, sem alteração. A folha pode estar incompleta ou desatualizada: na dúvida, confirme com a família.`,
        tam: 9,
      },
    ],
    COR.destaque,
    COR.linha,
  );

  f.rodapes(`Guardião · Como cuidar de ${c.nome}`);
  return f.doc.save();
}
