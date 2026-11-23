# Check-ins com o professor

Registro dos check-ins de acompanhamento (de 3 em 3 semanas). Em cada um reporto as
horas feitas no periodo entre um check-in e o anterior, com os avancos, as
dificuldades e o plano para o proximo bloco. O detalhamento por card e as horas
ficam na timesheet do Notion; aqui guardo o texto de cada entrega.

## Calendario

| Check-in | Data | Semanas | Horas do periodo | Acumulado |
|----------|------|---------|------------------|-----------|
| 1 | 10/08 | 1-2 (P0) | 14h | 14h |
| 2 | 31/08 | 3-5 (P1) | 61h | 75h |
| 3 | 21/09 | 6-8 (P1) | 54h | 129h |
| 4 | 12/10 | 9-11 (P2) | 50h | 179h |
| 5 | 02/11 | 12-14 (P2/P3) | 45h | 224h |
| 6 | 23/11 | 15-16 (P3) | 30h | 254h |
| Entrega | 07/12 | 17-18 (P4) | a fazer | - |

## Check-in 1 — 10/08 (semanas 1-2, 14h)

Definicao do trabalho. Reportei o formato individual, o tema, a descricao do
projeto, o cliente (minha propria familia: meu avo como idoso, a cuidadora dele e
eu como familiar administradora), o beneficio a comunidade, a stack e a estimativa
de horas (~273h planejadas para 238h necessarias). Avancos do periodo: concepcao,
escopo e requisitos; modelagem de dados, wireframes das tres visoes, setup do
repositorio e primeiro deploy no ar.

## Check-in 2 — 31/08 (semanas 3-5, 61h)

Fundacao e inicio do nucleo. Avancos: schema completo no Supabase com RLS,
autenticacao (cadastro, login, sessao), papeis e permissoes (RBAC) com guardas de
rota, perfil do idoso (dados, condicoes, alergias e contatos), consentimento LGPD
e convites de cuidadores e familiares por link.

## Check-in 3 — 21/09 (semanas 6-8, 54h)

**Existem evidencias para comprovar estas horas?**

Sim. Todo o codigo esta versionado no GitHub, com commits frequentes (um por card
do meu board de planejamento), e o sistema esta em producao na Vercel. A
documentacao fica toda no proprio repositorio, na pasta `/docs`: concepcao,
modelagem de dados e, fechando este bloco, um documento do nucleo com a descricao
do que foi construido e um roteiro de teste de integracao. Cada card no meu quadro
aponta para o commit correspondente.

- Repositorio: https://github.com/LuisaHering/guardiao
- Documento do nucleo P1 (deste periodo): https://github.com/LuisaHering/guardiao/blob/main/docs/nucleo-p1.md
- Aplicacao no ar: https://guardiao-smoky.vercel.app

**Quais foram os principais avancos?**

Fechei todo o nucleo do cuidado (fase P1). Alem da medicacao (cadastro de
remedios, registro diario de adesao com motivo de nao-adesao e alerta de
silencio), entreguei: o diario do cuidador com foto do dia guardada em storage
privado, o diario de sintomas com gravidade e historico, o perfil de emergencia
com QR revogavel acessivel sem login, e a timeline que reune diario, sintomas e
medicacao em ordem cronologica. Tambem fiz um bloco de hardening: atualizei
dependencias ate zerar as vulnerabilidades e documentei o nucleo com um roteiro de
teste.

**Quais dificuldades voce encontrou?**

A parte mais delicada foi o perfil de emergencia: ele precisa ser lido por um
socorrista sem conta, mas sem abrir o resto dos dados do idoso. Resolvi com uma
funcao no banco que valida o token e devolve so os seis campos criticos, com o
token revogavel a qualquer momento. Tive tambem um contratempo de infraestrutura:
o projeto Supabase, por ser plano gratuito, pausa apos alguns dias sem uso, o que
travou a aplicacao de uma migracao ate eu reativa-lo pelo painel.

**O que planejam fazer ate o proximo check-in?**

Luisa - Iniciar a fase de IA (P2): consultas com upload/gravacao de audio e
transcricao + resumo pela API da Anthropic, e receitas por foto com extracao e
cadastro automatico do remedio.

**Voce precisa de orientacao?**

Nao.

## Check-in 4 - 12/10 (semanas 9-11, 50h)

**O que foi desenvolvido durante este período?**

Luísa (projeto individual):

- Consultas: cadastro com gravação ou envio de áudio em storage privado e resumo
  estruturado por IA (ações, remédios, exames pedidos, dúvidas e retorno) a
  partir do texto da consulta.
- Receitas: a foto ou o PDF é lido por IA e vira uma sugestão de remédios que eu
  confiro antes de cadastrar; o documento de origem fica guardado e ligado a cada
  remédio.
- Exames: leitura de laudos (foto ou PDF) com uma tela que mostra todos os valores
  de uma vez para conferência; só o que é confirmado entra no sistema, gravado
  numa única transação.
- Nomes de exames: casamento com os já existentes, conversão de unidade por regra
  conhecida (explícita na confirmação) e união manual de nomes duplicados.
- Gráfico de tendência por exame, com a faixa de referência de cada laudo.
- Observações: a IA aponta recorrências nos sintomas, no diário e na medicação,
  citando as datas que sustentam cada uma.
- Camada de IA trocável entre provedores (Google ativo, Anthropic em standby),
  indicador de carregamento, remoção de receitas e exames, consultas e exames na
  timeline, revisão dos textos e da acentuação das telas e documentação do bloco.

**Informe a quantidade de horas por componente do grupo.**

Luísa - 50 horas

**Existem evidências para comprovar estas horas?**

Sim. Todo o código está no GitHub, com um commit por card, e a aplicação está em
produção na Vercel. A documentação do bloco fica em `/docs`: o documento de IA
descreve o que foi construído, as decisões de projeto, a verificação feita e as
limitações.

- Repositório: https://github.com/LuisaHering/guardiao
- Documento do bloco de IA: https://github.com/LuisaHering/guardiao/blob/main/docs/ia-p2.md
- Histórico dos check-ins: https://github.com/LuisaHering/guardiao/blob/main/docs/checkins.md
- Aplicação no ar: https://guardiao-smoky.vercel.app

**Quais foram os principais avanços?**

Entrei na fase de IA com as funcionalidades que transformam documentos (consultas,
receitas e laudos) em informação organizada, sempre com conferência humana antes
de gravar. Validei com documentos fictícios: a leitura de uma receita, a de dois
laudos de laboratórios diferentes (a conversão de mg/dL para mmol/L funcionou e o
gráfico mostrou a faixa de cada laudo) e o resumo de uma consulta. Ainda estão em
validação o envio de áudio, a união de nomes duplicados e as observações com
volume suficiente de registros.

**Quais dificuldades você encontrou?**

A API da Anthropic, que eu tinha previsto, é pré-paga e exige cartão. Por isso
migrei a camada de IA para o Google (Gemini, plano gratuito) e mantive a da
Anthropic pronta em standby, trocável por uma variável de ambiente. No plano
gratuito o Google informa que o conteúdo enviado pode ser usado para melhorar os
produtos dele, então usei apenas documentos fictícios nos testes. Também lidei
com um modelo gratuito que estourou a cota na primeira chamada e com respostas
que levam de 5 segundos a quase 1 minuto, o que resolvi trocando de modelo e
adicionando um indicador de carregamento. Por fim, tratar dado clínico com IA
exigiu cuidado: nada entra sem confirmação, a conversão de unidade é feita por
regra conhecida e não pela IA, e cada observação precisa citar datas que existem
nos registros.

**O que planejam fazer até o próximo check-in?**

Luísa - Gerador de diretivas antecipadas (questionário estruturado e PDF com
versionamento), visão 360 do idoso sintetizada pela IA e alertas gerados pela IA,
e iniciar o dashboard do familiar.

**Você precisa de orientação?**

Não.

## Check-ins 5 e 6 combinados - 23/11 (semanas 12-16, 75h)

O professor autorizou entregar os dois check-ins no formulário de 23/11. Por isso este
registro cobre o dobro do período: o check-in 5 (semanas 12 a 14, 45h) e o check-in 6
(semanas 15 e 16, 30h).

**O que foi desenvolvido durante este período?**

Luísa (projeto individual):

- Diretivas antecipadas: questionário guiado, PDF com versionamento e vigência, e
  imutabilidade garantida no banco (um PDF gerado não pode ser alterado). O PDF sempre
  declara quem preencheu e se o titular estava presente.
- Visão 360: panorama do idoso montado pela IA a partir de tudo o que foi registrado.
  Quando duas pessoas relatam coisas diferentes, os dois relatos aparecem lado a lado,
  sem que o sistema decida quem tem razão. Também lista o que ainda não dá para saber.
- Alertas e notificações: estado de leitura por pessoa, texto guardado na criação,
  exame fora da faixa sempre avisa, alergia nova e mudança de medicação avisam, e o
  silêncio de registro avisa primeiro a cuidadora e depois, se persistir, os
  administradores. Titular e cuidador recebem textos diferentes.
- Painel do familiar: adesão dos últimos 7 dias, alertas não lidos, resumo, últimos
  registros e exames fora da faixa.
- Pauta médica: lista de dúvidas para a próxima consulta, com origem e data, referenciada
  pela visão 360 sem ser reescrita pela IA.
- Preferências e história de vida ("como quero ser tratado"), com registro de quem
  afirmou cada item, e score de completude do perfil com sugestão do que preencher.
- Folha "como cuidar de mim" em PDF, para quem começa a cuidar: fatos de segurança
  (alergias, condições, medicação e contatos) vêm direto do cadastro e a IA só redige
  as preferências.
- Permissões por papel e polimento de UX: menu em grupos, menu para celular, telas
  clínicas fechadas ao cuidador e documento de permissões.
- Documentação do bloco (diretivas, alertas e permissões) e atualização de
  dependências por avisos de segurança.

**Informe a quantidade de horas por componente do grupo.**

Luísa - 75 horas

**Existem evidências para comprovar estas horas?**

Sim. Todo o código está no GitHub, com um commit por card (ou por par de cards
relacionados), e a aplicação está em produção na Vercel. Cada card do meu quadro
aponta para o commit correspondente, e a timesheet do Notion detalha as horas por card.
A documentação fica em `/docs`.

- Repositório: https://github.com/LuisaHering/guardiao
- Diretivas (cards 23 e 24): https://github.com/LuisaHering/guardiao/commit/302643e
- Visão 360 (card 25): https://github.com/LuisaHering/guardiao/commit/2b1b38c
- Alertas e notificações (cards 26 e 28): https://github.com/LuisaHering/guardiao/commit/8137ea7
- Painel do familiar (card 27): https://github.com/LuisaHering/guardiao/commit/684840e
- Pauta médica (card 44): https://github.com/LuisaHering/guardiao/commit/bf4bb3c
- Identidade e score (cards 29 e 31): https://github.com/LuisaHering/guardiao/commit/e2b658e
- Folha de cuidado (card 30): https://github.com/LuisaHering/guardiao/commit/3fa309d
- Permissões e menu (card 32): https://github.com/LuisaHering/guardiao/commit/24f9947
- Documento das diretivas: https://github.com/LuisaHering/guardiao/blob/main/docs/diretivas.md
- Documento dos alertas e fechamento do P2: https://github.com/LuisaHering/guardiao/blob/main/docs/alertas.md
- Documento de permissões: https://github.com/LuisaHering/guardiao/blob/main/docs/permissoes.md
- Histórico dos check-ins: https://github.com/LuisaHering/guardiao/blob/main/docs/checkins.md
- Aplicação no ar: https://guardiao-smoky.vercel.app

**Quais foram os principais avanços?**

Fechei a fase de IA (P2) e avancei bastante na P3, que ficou só sem o chat. O sistema
agora não só guarda registros: ele os junta (visão 360), avisa a pessoa certa na hora
certa (alertas) e entrega ao familiar um painel único. Nas decisões de projeto, mantive
três regras: a IA organiza e nunca decide, quando há relatos diferentes o sistema mostra
os dois sem escolher um, e os fatos de segurança vêm do cadastro, não da IA. Na tela,
validei a visão 360 mostrando os "relatos que não coincidem", o alerta de silêncio
escalado, o painel, a folha em PDF, a pauta e o score de completude do perfil (87% no
perfil de teste), também no celular.

**Quais dificuldades você encontrou?**

A principal foi de modelagem: um alerta precisa ter leitura individual e texto diferente
para cada pessoa (o titular não deve receber o dado bruto, a cuidadora não deve receber
o que é clínico), e isso teve de ser garantido no banco, e não só na tela. Outra foi
a visão 360 com relatos divergentes: foi preciso fazer a IA apontar a diferença sem
arbitrar e conferir a resposta dela antes de exibir. Na folha em PDF, a fonte padrão
não aceita alguns caracteres, o que exigiu tratar o texto. Tive também contratempos de
infraestrutura: o projeto Supabase gratuito pausa por inatividade e travou a aplicação
de migrações até eu reativá-lo, o modelo gratuito do Google estourou a cota e foi
trocado, e atualizei o Next.js e outras dependências por avisos de segurança. Segue a
limitação do plano gratuito de IA, em que o conteúdo pode ser usado pelo provedor, então
só uso documentos fictícios até trocar de plano para o teste com dados reais.

**O que planejam fazer até o próximo check-in?**

Luísa - Fechar a P3 com o chat de cuidado (conversa com a IA, extração do perfil a
partir da conversa e check-in diário conversacional) e entrar na P4: endurecimento de
segurança (políticas de leitura por papel no banco), teste com usuário real, documentação
final do projeto e entrega (timesheet, vídeo de demonstração e Moodle) em 07/12.

**Você precisa de orientação?**

Não.
