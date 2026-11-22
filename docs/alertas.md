# Alertas e fechamento do bloco P2

O bloco P2 (IA, documentos e visão 360) termina com os alertas: a parte que transforma
registros em avisos para quem precisa agir. Este documento registra as regras, onde
cada uma é garantida e como foi testado.

## O que gera um alerta

| Gatilho | Quando dispara | Quem recebe |
|---------|----------------|-------------|
| Exame fora da faixa | ao confirmar um exame, para cada resultado fora da faixa do laudo | titular e familiares |
| Alergia nova | ao cadastrar uma alergia | titular, familiares e cuidador |
| Mudança de medicação | ao cadastrar, alterar ou encerrar um remédio | titular, familiares e cuidador |
| Silêncio de registro | dias sem registro de medicação | primeiro a cuidadora; se persistir por 5 dias, os administradores |

A linha divisória segue o que está em `docs/modelagem.md` (seção 3.12): o cuidador
recebe o que muda o que a pessoa faz amanhã (operacional), não a leitura clínica.
O titular recebe os avisos sobre os próprios dados por padrão, porque os dados são dele.

## Regras que valem no banco

- **Estado de leitura por pessoa.** Cada destinatário tem a sua própria marca de
  "lido". Ler um alerta não o apaga para os outros.
- **Texto guardado na criação.** O texto de cada destinatário é gravado quando o alerta
  nasce e não é reescrito depois. O titular recebe uma formulação sem susto e sem jargão;
  quem age sobre o dado recebe o valor e a faixa.
- **Só o sistema cria alertas.** Usuários não têm permissão de inserir nem alterar
  alertas; a única alteração permitida é marcar o próprio como lido.
- **Sem duplicidade.** Cada alerta tem uma chave única, então o mesmo fato não gera dois
  avisos mesmo se a verificação rodar de novo.
- **Exame fora da faixa sempre alerta.** Não há configuração para silenciar.

Tudo isso está em `supabase/migrations/20261122090000_alertas.sql`.

## O que o alerta não faz

- Não diagnostica nem recomenda tratamento. Avisa que há um valor fora da faixa do laudo
  e sugere conversar com o médico.
- O alerta de silêncio indica ausência de registro, não ausência de cuidado: a pessoa
  pode ter cuidado e só não ter registrado.

## Verificação

Com dados fictícios no ambiente de desenvolvimento, o alerta de silêncio escalado
aparece no sino e no painel ("Faz 62 dias sem registro de medicação"), com contagem de
não lidos por pessoa. As demais regras (exame fora da faixa, alergia nova, mudança de
medicação e bloqueio de inserção direta) estão implementadas na migração acima.

## Fechamento do P2

Entregues no bloco: consultas com resumo, receitas, exames com conversão de unidade,
tendências, observações, diretivas antecipadas, visão 360 e alertas. Decisões e
limitações da parte de IA estão em [`ia-p2.md`](ia-p2.md); o que cada papel acessa está
em [`permissoes.md`](permissoes.md).

Limitações conhecidas que ficam para o hardening (P4): a leitura das tabelas clínicas
ainda permite a qualquer membro do idoso, e a entrega por e-mail dos alertas não foi
implementada (hoje o aviso é dentro do aplicativo).
