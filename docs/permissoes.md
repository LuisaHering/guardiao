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

## Limitações conhecidas

- O interruptor de participação do idoso como contribuidor (`pode_contribuir` no
  vínculo) existe no modelo de dados, mas ainda não é aplicado nas políticas de escrita.
- Conversas e mensagens são visíveis a qualquer membro do vínculo; não há conversa
  privada.
- Não há limite de chamadas por pessoa nas rotas de IA, além do limite do provedor.
