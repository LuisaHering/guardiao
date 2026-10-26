# Diretivas antecipadas de vontade: documentação do bloco

Este documento descreve o gerador de diretivas do Guardião (cards 23 e 24): o que
ele faz, as regras que o sistema garante e as decisões que tomei. A base conceitual
está em `docs/modelagem.md`, seção 3.13.

## O que o bloco entrega

- Um **questionário estruturado** sobre preferências de cuidado e de fim de vida,
  em quatro seções: quem fala pela pessoa, tratamentos em situação grave, conforto
  e lugar de cuidado, e o que importa para ela em palavras próprias.
- Um **PDF legível**, guardado e baixável, que declara como o registro foi
  preenchido.
- **Vigência e histórico**: cada diretiva gerada é imutável; uma mudança gera uma
  nova, e a anterior continua guardada.

## Regras que o sistema garante

**O PDF sempre declara quem preencheu.** O bloco "Como este registro foi
preenchido" abre o documento. Se foi o próprio titular, diz isso. Se foi outra
pessoa, diz quem, com qual papel, e que o registro "não é uma declaração autônoma
do titular". Um documento que afirma "preenchido por X com apoio de Y" é mais
sólido que um ambíguo: o que enfraquece uma diretiva é a dúvida sobre quem falou.

**"Titular presente" é declaração, não verificação.** Gerar exige marcar que o
titular estava presente durante o preenchimento. Ninguém verifica isso; a marcação
é um ato consciente de quem digita, fica registrada com data e aparece no PDF como
declaração dessa pessoa.

**Imutabilidade garantida no banco, não só na tela.** Usuários logados não têm
permissão de INSERT nem de UPDATE na tabela de diretivas. A única porta de entrada
é uma função (`gerar_diretiva`) que faz todas as checagens: vínculo, papel,
consentimento ativo, presença declarada, e que a diretiva que o PDF diz substituir
é de fato a vigente. Um gatilho no banco ainda bloqueia qualquer alteração de uma
linha existente, exceto a vigência passar de verdadeira para falsa. Os arquivos PDF
também não podem ser sobrescritos nem apagados.

**O servidor decide o que vira documento.** As respostas são revalidadas contra o
questionário no servidor, o modo de preenchimento sai do vínculo de quem gera (o
navegador não escolhe) e a data é a do servidor.

**Quem pode gerar.** O titular e os administradores. O cuidador contribui com os
registros do dia a dia, mas não redige a vontade do titular.

**O documento é autoexplicativo.** Cada diretiva guarda uma cópia das perguntas
junto com as respostas, então mudar o questionário no futuro não altera nenhuma
diretiva já gerada. A versão do questionário fica registrada.

## O que o PDF não afirma

O PDF é o artefato final, mas não declara validade jurídica. O rodapé explica que a
validade depende de registro em cartório (declaração de vontade) ou no prontuário
médico, conforme a Resolução CFM nº 1.995/2012, e que, na dúvida, o caminho é um
advogado ou a Defensoria Pública. A formalização é responsabilidade de quem quiser
levar o documento adiante.

## Decisões de projeto

- **Sem rascunho no banco.** Como a diretiva é imutável, só existem no banco as
  diretivas prontas. O progresso do preenchimento fica no próprio navegador até a
  geração. A consequência é que o rascunho não acompanha a pessoa entre aparelhos.
- **Fontes padrão do PDF.** O PDF usa fontes que acompanham o formato, o que cobre
  português completo, mas não emoji e símbolos raros: o que não couber vira "?" em
  vez de derrubar a geração.
- **Sem opção de doação de órgãos.** No Brasil, a doação depende do consentimento
  da família, então registrar uma preferência aqui poderia sugerir um efeito que ela
  não tem.

## Verificação já feita

- Build de produção e TypeScript sem erros.
- PDFs de exemplo gerados e conferidos pelo texto extraído: acentuação, o bloco de
  declaração do modo de preenchimento, a menção à diretiva substituída, a quebra
  de texto longo e o tratamento de caractere fora da fonte.

## Limitações e pendências

- A imutabilidade e as permissões dependem de a migration estar aplicada no banco.
- Um registro é gerado por uma só pessoa; não há fluxo de co-assinatura nem de
  verificação independente da presença do titular.
- O texto do questionário é uma proposta minha e merece revisão de quem conhece o
  titular e, idealmente, de um profissional de saúde ou jurídico antes de uso real.
