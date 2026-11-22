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
| Cuidador acessar exames, tendências, observações e Visão 360 | não | **interface** |
| Cuidador acessar diretivas | não | **interface** (a geração é do banco) |

## Limitação conhecida

As linhas marcadas como **interface** só escondem a tela: um membro com o papel de
cuidador ainda conseguiria ler essas tabelas chamando a API diretamente, porque a
regra de leitura do banco é "qualquer membro do idoso". Endurecer isso (políticas de
leitura por papel) é trabalho do card de hardening, e não afeta a regra principal do
sistema, que é nenhuma pessoa de fora do vínculo conseguir ler nada.

O interruptor de participação do idoso como contribuidor (`pode_contribuir` no
vínculo) existe no modelo de dados, mas ainda não é aplicado nas políticas de
escrita.
