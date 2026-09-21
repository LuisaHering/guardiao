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
| 4 | 12/10 | 9-11 (P2) | a fazer | - |
| 5 | ~09/11 | 12-14 (P3) | a fazer | - |
| 6 | 23/11 | 15-16 (P3) | a fazer | - |
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
