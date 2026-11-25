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
| Exames: valores e laudos | não (menu) | sim | sim, **só para ver** |
| Pedidos de exame | não (menu) | sim | sim |
| Tendências, observações | não | sim | **não** |
| Visão 360 | não | sim | **não** |
| Preferências e história, folha de cuidado | sim (preferências) | sim | sim |
| Diretivas | sim | sim | **não** |
| Documentos | sim | sim | só os marcados "levar nas consultas" e o que enviou |
| Emergência | não | sim | sim |
| Rede e acessos | não | só admin | não |

Quem cuida vê os exames, os valores e os laudos (decisão de 25/11/2026, que substitui a
restrição anterior). Continuam com a família a leitura interpretada (tendências, observações e
visão 360) e as diretivas. As **notificações** seguem a regra da modelagem (seção 3.12): quem
cuida recebe o operacional, e não os alertas clínicos.

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
| Cuidador ler observações, visão 360 e diretivas | não | **banco** (leitura só para familiar e titular) |
| Cuidador abrir a tela de tendências | não | **só na interface** (os valores que ela usa já são visíveis) |
| Criar pasta e enviar documento | só o administrador | **banco** |
| Quem cuida ver pasta, ou documento não marcado que não enviou | não | **banco** (inclui o arquivo no Storage) |
| Cuidador ler alertas clínicos ou o texto de alerta de outra pessoa | não | **banco** |

## Verificação no banco

A migração `20261124090000_hardening_leitura_por_papel.sql` leva um teste embutido: cria
um idoso e três pessoas (familiar, cuidador e alguém de fora), simula cada uma chamando
como usuário logado e confere o que o banco devolve. O esperado é que o familiar leia
tudo, o cuidador veja só o alerta operacional e só o próprio texto, e quem é de fora não
leia nada. A leitura de exames por quem cuida foi aberta depois, e é conferida (junto com o
bloqueio a quem é de fora) em `20261125140000_exames_visiveis_e_remedios_esperando.sql`. Tudo é desfeito no fim, e se alguma conferência
falhar a migração inteira é recusada.

A migração `20261124100000_testes_regras_do_banco.sql` repete o método para as demais
regras do banco: o alerta de alergia e o de medicação chegam à cuidadora, usuário logado
não cria nem reescreve alerta (só marca o próprio como lido), uma diretiva gerada não se
altera e não é inserida por usuário, mensagem de chat não se edita nem se escreve em nome
de outra pessoa, e quem é de fora não lê nem escreve no cuidado de um idoso alheio.

## Documentos

O administrador guarda certidões, carteirinha do plano e outros arquivos em pastas. A permissão
de quem cuida é **por documento**: ela não vê pastas, só o que estiver marcado como "levar nas
consultas" e o que ela mesma enviou. Os arquivos ficam em um bucket privado, abertos por link
temporário. Não há exclusão física: "remover" esconde. As pastas automáticas (exames, receitas,
consultas, diretivas e folha de cuidado) são montadas a partir do que já existe, sem copiar
arquivo.

**Envio de um papel.** Quem cuida (ou qualquer membro) envia a foto de uma receita, pedido de
exame, atestado ou outro papel. Ela chega ao administrador numa caixa própria, com aviso. Quem
enviou não consegue marcar o próprio envio para consultas nem colocá-lo em uma pasta. Um
registro nunca pode apontar para o arquivo de outro (caminho único e imutável): sem isso, criar
um registro apontando para um arquivo escondido daria acesso a ele. Os documentos não são
enviados à IA, com duas exceções: a foto de receita ou de pedido de exame enviada por esse
caminho (seção abaixo) e o "Ler como receita", quando a família escolhe.

Regras testadas nas migrações `20261124130000_documentos.sql` e
`20261125100000_consulta_e_documentos.sql`.

## Ida ao médico (quem cuida)

Dois botões principais: **Gravar a consulta** (começa na hora) e **Contar sobre a consulta**
(texto, que a pessoa pode ditar pelo teclado). Gravar e contar no mesmo dia ficam no mesmo
registro; uma segunda gravação vira outro registro, para nada ser sobrescrito. O áudio **não é
transformado em texto** e não é enviado à IA. Se a volta for marcada, o banco cria a tarefa
"Consulta de volta" e avisa o administrador (quem cuida não cria tarefas diretamente).

O aplicativo **não pede nem registra autorização para gravar** (decisão de produto): essa
responsabilidade fica com quem grava.

Entre os apoios da tela, "Mostrar ao médico" reúne alergias, doenças, remédios em uso e as
queixas dos últimos 60 dias, e "O que perguntar" fica em vermelho enquanto houver pergunta em
aberto.

Proteções da gravação: a tela é mantida acesa quando o navegador permite; há o aviso "Não
feche nem bloqueie o celular"; o áudio é guardado em pedaços; interrupções (microfone
desligado, tela bloqueada, erro) são anunciadas e o que foi gravado até ali é salvo; se o envio
falhar, dá para tentar de novo ou salvar no celular. A gravação continua ao trocar de tela
dentro do aplicativo. **Limite:** nenhuma dessas proteções impede o navegador do celular de
parar de gravar; elas reduzem o risco e avisam. Recarregar ou fechar a página perde o áudio que
ainda não foi guardado.

## Remédios: agenda e confirmação

Cada remédio tem frequência (todo dia, dias da semana, a cada tantos dias ou só quando
precisar), momento do dia (por período: manhã, tarde, noite; ou em horário específico) e
duração (sem data para acabar, por alguns dias ou até uma data). Cada dose é um registro
próprio. A dose por período aparece como atrasada quando o período acaba (manhã às 12:00,
tarde às 18:00, noite às 23:00); a de horário específico, 30 minutos depois da hora.

| Ação | Administrador | Demais membros | Garantido no |
|------|---------------|----------------|--------------|
| Adicionar remédio | vale na hora | vale na hora e vai para revisão | **banco** |
| Mudar dose, horário ou suspender | direto | vale na hora e vai para revisão | **banco** (função que guarda o estado anterior) |
| Aprovar ou negar uma revisão | sim | não | **banco** |
| Registrar dose | sim | sim | **banco** |

**Tudo o que quem não administra faz vale na hora**, e o administrador revisa: um pop-up
aparece ao abrir o aplicativo (e é conferido a cada 30 segundos enquanto ele está aberto),
além do aviso no sino. Aprovar não muda nada. Negar desfaz: um remédio novo sai da lista,
uma mudança volta ao estado anterior e um remédio suspenso volta; quem cuida é avisado.

- Há no máximo uma revisão aberta por remédio. Mudanças seguidas se somam, e negar volta ao
  último estado que o administrador conhecia.
- Se o administrador editar o remédio com revisão aberta, a revisão se encerra, para que um
  "negar" posterior não desfaça a edição dele.
- Quem não administra não escreve direto em um remédio já revisado nem cria revisão: as duas
  coisas passam pela função do banco, que guarda o estado anterior de verdade.

Esta foi uma escolha de produto: o cuidado não pode esperar a revisão. O custo é que um erro
de nome, dose ou suspensão fica em uso até alguém revisar. O aplicativo não envia
notificação para o celular fechado, então a revisão depende de o administrador abrir o
aplicativo.

Na lista de hoje, "Dei todos" marca apenas as doses cuja hora já chegou, depois de a pessoa
conferir a lista, e não altera o que outra pessoa tenha marcado.

Duas proteções contra erro de dose:

- Se o horário de um remédio muda depois de uma dose registrada, o registro continua valendo
  para a dose mais próxima. Sem isso, uma dose já dada voltaria a aparecer como pendente.
- Uma dose registrada a partir de uma conversa nunca sobrescreve um registro existente.

O alerta de silêncio conta só os dias em que havia dose prevista, então um remédio semanal
não gera alarme falso. O sistema não envia notificação no horário da dose: o horário
organiza a lista e marca o atraso.

As regras de agenda e dose ficam em `src/lib/medicacao.ts`, com testes (`npm test`). As
regras do banco são testadas dentro da migração
`20261124150000_remedios_agenda_e_confirmacao.sql` `20261124170000_remedio_vale_na_hora.sql` e `20261124180000_mudanca_vale_na_hora.sql`.

## Tela Hoje de quem cuida e tarefas

Quem cuida não vê o painel do familiar: vê uma tela pensada para o celular, com a lista do dia
(remédios, contar como foi o dia e as tarefas) e botões grandes para quando precisar. No
celular, três botões fixos (Hoje, Avisos, Mais) substituem o menu longo.

| Ação | Quem pode | Garantido no |
|------|-----------|--------------|
| Criar, editar e remover tarefa | só o administrador | **banco** |
| Responder "fiz" ou "não consegui" | membros, sempre em nome próprio | **banco** |
| Ver tarefas e respostas | membros do vínculo | **banco** (RLS) |

Na lista, "feito" quer dizer **registrado**: um remédio não dado ou um "não consegui" conta
como respondido, mas aparece em amarelo, para ninguém marcar o que não fez só para completar.
Dia sem resposta é "sem registro", não "não feito". Uma tarefa de uma vez só continua como
atrasada até ser respondida. "Não consegui" avisa o administrador.

As regras do dia ficam em `src/lib/tarefas.ts`, com testes (`npm test`); as do banco são
testadas na migração `20261125090000_tarefas.sql`.

## Foto do dia

Quem cuida tem na tela Hoje o botão "Tirar foto de ‹nome›". Ele fica fora do checklist, porque
foto não é obrigação. A foto entra no diário com uma legenda opcional e aparece no painel da
família, sem aviso a cada uma. O armazenamento é privado, com acesso por link temporário, e as
regras de quem vê são as do diário: os membros do vínculo.

- Uma entrada só com foto **não conta** como "Contar como foi o dia".
- As fotos e legendas **não são enviadas à IA**; as telas de IA leem só entradas com texto
  sobre alimentação, sono ou ocorrências.
- Antes de subir, o navegador redesenha a foto em um JPEG menor, o que descarta os metadados
  do arquivo da câmera, como o local onde foi tirada.
- Se uma preferência em "O que incomoda" mencionar foto, ela aparece como lembrete acima do
  botão.
- No diário, as fotos já guardadas no dia aparecem junto do campo de foto, para ninguém enviar
  a mesma de novo.
- "Remover" no diário esconde a foto no aplicativo; o arquivo não é apagado do armazenamento.

Em "Quando precisar", o atalho "Exame ou receita nova" leva ao envio da foto de uma receita ou de um
pedido de exame, o mesmo envio descrito em Documentos.

## Receita e pedido de exame lidos da foto

Quem envia a foto de uma receita ou de um pedido de exame **confere o que a IA leu**, um item
por vez, com "Está igual" ou "Não está igual", sem digitar. O confirmado **vale na hora** e o
administrador recebe um pop-up **com a foto usada** para aceitar ou negar o conjunto. Negar
desfaz: o remédio novo sai, a dose ou o horário voltam, o pedido de exame é cancelado, e quem
cuida é avisado. Até a revisão, o remédio aparece na lista de hoje com "Lido da foto, confira
no papel".

Como o confirmado vale na hora, em qualquer dúvida o item **não entra sozinho** e vai para a
família ler a foto:

| Situação | O que acontece |
|----------|----------------|
| Remédio novo com dose legível | entra (horário só quando o papel diz; "por N dias" vira data final) |
| Já está na lista com a mesma dose e horário | não duplica |
| Já está na lista com outra dose ou horário claro | muda, depois de quem enviou conferir |
| Nome parecido ou outra fórmula (ex: associação, liberação prolongada) | não entra |
| Semanal ou a cada tantos dias | entra, depois de um segundo "Você tem certeza?" (com a escolha do dia da semana), e o administrador recebe um aviso **urgente** |
| Sem dose, mensal, dose única ou tratamento contado em meses | não entra |
| O papel manda parar um remédio | nada é suspenso; aviso para falar com a família |

**O que não entra não some.** Fica "esperando a família" na tela de remédios de quem cuida, com
um destaque na tela Hoje e o botão "Pedir para a família aprovar", que manda um aviso urgente
(no máximo um por hora para cada item). Só o administrador resolve: coloca na lista ou decide
não colocar. Aceitar a foto no pop-up não resolve esses itens.

Essas regras são código, não decisão da IA (`classificarRemedio` em `src/lib/medicacao.ts`,
com testes). A gravação e a decisão do administrador são funções do banco, testadas na
migração `20261125120000_conferencia_de_papel.sql`: só quem enviou confere, cada foto é
conferida uma vez, e ninguém escreve direto nas tabelas.

**Privacidade:** nesse caminho a foto vai automaticamente para o provedor de IA, junto com os
nomes e doses dos remédios em uso, para a comparação. A foto de uma receita costuma trazer o
nome da pessoa e do médico. No plano gratuito do Google o conteúdo pode ser usado pelo
provedor: para uso real, o caminho é um plano pago. Se a IA falhar ou a cota acabar, a foto
chega à família como documento e nada é mudado.

**Limite:** a leitura pode errar (letra de médico, dose trocada). As proteções são a
conferência de quem enviou, o aviso na lista e a revisão com a foto; nenhuma delas garante
que um erro seja percebido.

## Pedido de exame

O pedido nasce da foto conferida (ou anotado à mão pelo administrador) e passa por: falta
marcar, marcado, feito, resultado enviado e concluído.

| Passo | Como funciona |
|-------|----------------|
| Falta marcar | fica em vermelho no painel da família, na tela Hoje e na aba Exames; não há lembrete com prazo |
| Já está marcado | sem preencher nada; sem o dia não há tarefa nem lembrete, e o administrador é avisado para completar |
| Dizer o dia | hora e laboratório são opcionais; vira tarefa na tela Hoje com o que levar e o preparo |
| Véspera | aviso dentro do aplicativo, com o preparo |
| No dia | "Fiz" marca o exame como feito; "Não consegui" volta para falta marcar |
| Resultado | foto ou PDF, enviado por quem cuida ou pela família; a família lê os valores na tela de Exames, e o pedido é concluído |
| Cancelar | só o administrador; a tarefa e o aviso da véspera saem |

O preparo é só o que está escrito no papel. Sem isso, a tela pede para confirmar com o
laboratório. As mudanças de situação são funções do banco (ninguém escreve direto na tabela),
testadas nas migrações `20261125130000` a `20261125160000`.

**Limite:** o aviso da véspera é gerado quando alguém abre o aplicativo naquele dia e não chega
como notificação com o celular fechado.

## Limitações conhecidas

- O interruptor de participação do idoso como contribuidor (`pode_contribuir` no
  vínculo) existe no modelo de dados, mas ainda não é aplicado nas políticas de escrita.
- Conversas e mensagens são visíveis a qualquer membro do vínculo; não há conversa
  privada.
- Não há limite de chamadas por pessoa nas rotas de IA, além do limite do provedor.
