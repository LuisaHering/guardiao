# Permissões por papel

Este documento registra quem vê e quem edita o quê no Guardião, e **onde cada regra
é garantida**: no banco (vale mesmo se alguém contornar a tela) ou só na interface.
Essa distinção importa para o hardening.

## Papéis

- **Idoso (titular):** a pessoa a quem os dados pertencem.
- **Familiar:** quem acompanha. Pode ser **administrador** (cria o perfil, convida e
  remove pessoas, gerencia acessos) ou não.
- **Cuidador:** quem registra o dia a dia.

Papel e administração são eixos separados: um familiar administrador não é um papel
à parte, é um familiar com a marca de admin.

## O que cada papel enxerga no menu

| Área | Idoso | Familiar | Cuidador |
|------|:-----:|:--------:|:--------:|
| Painel, alertas, perfil | sim | sim | sim |
| Medicação, diário, sintomas, timeline | não | sim | sim |
| Consultas, pauta médica, receitas | não | sim | sim |
| Exames, tendências, observações | não | sim | **não** |
| Visão 360 | não | sim | **não** |
| Preferências e história, folha de cuidado | sim (preferências) | sim | sim |
| Diretivas | sim | sim | **não** |
| Documentos (pastas e arquivos) | sim | sim | só as pastas marcadas como visíveis |
| Emergência | não | sim | sim |
| Rede e acessos | não | só admin | não |

O cuidador não vê a leitura clínica interpretada porque a regra de notificação do
projeto é que ele recebe o que muda o que a pessoa faz amanhã (operacional), e não o
clínico (docs/modelagem.md, seção 3.12).

## Quem pode escrever, e onde a regra é garantida

| Ação | Quem pode | Garantido no |
|------|-----------|--------------|
| Gerar uma diretiva | titular ou administrador | **banco** (função `gerar_diretiva`) |
| Alterar uma diretiva já gerada | ninguém | **banco** (gatilho de imutabilidade) |
| Criar um alerta | só o sistema | **banco** (sem INSERT para usuários) |
| Alterar o texto de um alerta | ninguém; cada pessoa só marca o seu como lido | **banco** |
| Editar o perfil do idoso | administrador | **banco** (RLS) |
| Convidar ou gerenciar vínculos | administrador | **banco** (RLS) |
| Registrar medicação, diário, sintomas, consultas, exames, preferências | qualquer membro | **banco** (RLS por vínculo) |
| Ver ou mexer nos dados de outro idoso | ninguém | **banco** (RLS por vínculo) |
| Cuidador ler exames, tendências, observações, visão 360 e diretivas | não | **banco** (leitura só para familiar e titular) |
| Criar pasta e enviar documento | só o administrador | **banco** |
| Cuidador ver pasta ou documento não marcado como visível | não | **banco** (inclui o arquivo no Storage) |
| Cuidador ler alertas clínicos ou o texto de alerta de outra pessoa | não | **banco** |

## Verificação no banco

A migração `20261124090000_hardening_leitura_por_papel.sql` leva um teste embutido: cria
um idoso e três pessoas (familiar, cuidador e alguém de fora), simula cada uma chamando
como usuário logado e confere o que o banco devolve. O esperado é que o familiar leia
tudo, o cuidador não leia nenhum exame, veja só o alerta operacional e só o próprio
texto, e quem é de fora não leia nada. Tudo é desfeito no fim, e se alguma conferência
falhar a migração inteira é recusada.

A migração `20261124100000_testes_regras_do_banco.sql` repete o método para as demais
regras do banco: o alerta de alergia e o de medicação chegam à cuidadora, usuário logado
não cria nem reescreve alerta (só marca o próprio como lido), uma diretiva gerada não se
altera e não é inserida por usuário, mensagem de chat não se edita nem se escreve em nome
de outra pessoa, e quem é de fora não lê nem escreve no cuidado de um idoso alheio.

## Documentos

A tela de Documentos guarda certidões, carteirinha do plano e outros arquivos em pastas que o
administrador cria. O cuidador só vê as pastas marcadas como "visíveis para quem cuida" (e cujas
pastas-mãe também estejam); arquivo solto na raiz não é visível a ele. Os arquivos ficam em um
bucket privado, abertos por link temporário de 5 minutos, e **nunca são enviados à IA**. Não há
exclusão física: "remover" esconde o documento. As pastas automáticas (exames, receitas,
consultas, diretivas e folha de cuidado) são montadas a partir do que já existe, sem copiar
arquivo, e seguem a regra de cada origem (o cuidador não vê exames nem diretivas).
A migração `20261124130000_documentos.sql` leva o seu próprio teste dessas regras.

## Remédios: agenda e confirmação

Cada remédio tem frequência (todo dia, dias da semana, a cada tantos dias ou só quando
precisar), momento do dia (por período: manhã, tarde, noite; ou em horário específico) e
duração (sem data para acabar, por alguns dias ou até uma data). Cada dose é um registro
próprio. A dose por período aparece como atrasada quando o período acaba (manhã às 12:00,
tarde às 18:00, noite às 23:00); a de horário específico, 30 minutos depois da hora.

| Ação | Administrador | Demais membros | Garantido no |
|------|---------------|----------------|--------------|
| Adicionar remédio | entra confirmado | fica aguardando confirmação | **banco** |
| Registrar dose, inclusive de remédio aguardando | sim | sim | **banco** |
| Confirmar ou recusar | sim | não | **banco** |
| Mudar ou suspender remédio confirmado | direto | só por pedido, que o administrador decide | **banco** |
| Corrigir ou cancelar o próprio envio ainda não confirmado | sim | sim | **banco** |

Enquanto aguarda, o remédio aparece com esse aviso na lista de doses, no QR de emergência e
na folha de cuidado: um socorrista precisa saber que a pessoa pode estar tomando.

Duas proteções contra erro de dose:

- Se o horário de um remédio muda depois de uma dose registrada, o registro continua valendo
  para a dose mais próxima. Sem isso, uma dose já dada voltaria a aparecer como pendente.
- Uma dose registrada a partir de uma conversa nunca sobrescreve um registro existente.

O alerta de silêncio conta só os dias em que havia dose prevista, então um remédio semanal
não gera alarme falso. O sistema não envia notificação no horário da dose: o horário
organiza a lista e marca o atraso.

As regras de agenda e dose ficam em `src/lib/medicacao.ts`, com testes (`npm test`). As
regras do banco são testadas dentro da migração
`20261124150000_remedios_agenda_e_confirmacao.sql`.

## Limitações conhecidas

- O interruptor de participação do idoso como contribuidor (`pode_contribuir` no
  vínculo) existe no modelo de dados, mas ainda não é aplicado nas políticas de escrita.
- Conversas e mensagens são visíveis a qualquer membro do vínculo; não há conversa
  privada.
- Não há limite de chamadas por pessoa nas rotas de IA, além do limite do provedor.
