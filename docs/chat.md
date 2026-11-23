# Chat de cuidado e check-in diário

Bloco que fecha a fase P3: uma conversa com a IA sobre a pessoa cuidada, a extração de
registros a partir do que foi dito e o check-in diário conversacional.

## O que o bloco entrega

| Card | Entrega |
|------|---------|
| 37 | Conversa com a IA em fluxo (a resposta aparece enquanto é escrita), com o contexto do idoso. Cada fala fica salva e vinculada ao perfil, com autoria. |
| 38 | A IA propõe registros a partir da conversa (preferências, memórias, humor, diário, sintomas). Nada entra sem confirmação, e cada registro guarda quem disse e a fala de origem. |
| 39 | Check-in diário conduzido pela IA. Roteiro: como a pessoa está, sono e alimentação, dor ou desconforto, medicação do dia e algo a levar ao médico. A não adesão vira item da pauta médica. |

## Decisões de projeto

- **A IA conversa; quem registra é a pessoa.** A extração só propõe. O que for confirmado
  passa por uma camada única de ingestão (`src/lib/ingestao.ts`), que marca a origem
  (`conversa`), o autor e a fala de origem. Uma fonte futura (um sensor, por exemplo)
  usaria a mesma camada.
- **"Confirmado" quer dizer fiel à fala, não verdadeiro.** A tela mostra a fala ao lado de
  cada proposta. Corrigir a proposta antes de registrar é permitido.
- **Quem afirmou fica registrado.** O autor da fala vira o autor do registro. Se a
  cuidadora diz algo e a familiar confirma, o registro é da cuidadora.
- **A IA não é fonte de nada.** Só falas de pessoas sustentam um registro. Cada proposta
  precisa citar um trecho literal de uma fala, e o servidor descarta o que não bate:
  uma extração sem rastro de origem não chega à tela.
- **Não adesão sem pressão.** Se um remédio do dia não foi tomado, a IA pergunta o motivo
  (esqueceu, recusou, passou mal, acabou) para entender e registrar, e não para insistir.
  O motivo vira item da pauta médica, visível à cuidadora e à família, ligado à fala.
- **Urgência primeiro.** O comando da IA manda orientar o SAMU (192) diante de sinais de
  urgência antes de qualquer outra coisa. A IA não diagnostica nem muda tratamento.
- **Mensagens não se editam.** No banco, a mensagem não aceita alteração depois de enviada,
  e a mensagem de um usuário só pode ser escrita com o próprio id como autor.

- **Velocidade.** O chat usa um modelo leve (`gemini-3.5-flash-lite`) com pouco raciocínio,
  que começa a responder em menos de 1 segundo na medição feita. A extração de registros
  continua no modelo mais forte, porque ali precisão pesa mais que rapidez. Modelo e
  raciocínio do chat se trocam por `GEMINI_CHAT_MODEL` e `GEMINI_CHAT_THINKING`.

- **A IA conhece a pessoa e é proativa.** Antes de cada resposta o servidor monta o
  contexto a partir do banco: cadastro (condições, alergias, idade, como prefere ser
  chamado), medicação e doses não tomadas na semana, sintomas, humor e diário recentes,
  consultas com o que ficou a fazer, pauta médica em aberto, alertas recentes,
  preferências, memórias e o que foi dito nas conversas anteriores. O comando da IA manda
  usar isso para dar seguimento ("ontem relatou dor no joelho, como está hoje?") em vez de
  perguntar de forma genérica, sem diagnosticar.
- **Gênero e interlocutor.** O cadastro tem o campo "como se referir" (ele ou ela); sem
  ele, a IA usa só o nome. Quando quem escreve é o próprio idoso, a IA fala diretamente
  com ele; quando é alguém da rede, fala com essa pessoa sobre ele.

## Onde cada regra é garantida

| Regra | Garantida no |
|-------|--------------|
| Mensagem imutável | banco (sem permissão de UPDATE) |
| Autor da mensagem é quem a enviou | banco (política de INSERT) |
| Registro aponta para a mensagem de origem | banco (chave estrangeira) |
| Proposta só existe com trecho que bate com a fala | servidor |
| Nada é registrado sem confirmação | interface e fluxo |

Migração: `supabase/migrations/20261123090000_chat.sql`.

## Limitações conhecidas

- No plano gratuito do Google o conteúdo enviado pode ser usado pelo provedor, então a
  conversa só deve ter dados fictícios até a troca de plano (ver `docs/ia-p2.md`).
- A conversa é do idoso e visível a qualquer membro do vínculo; não há conversa privada.
- O chat é por texto. Voz fica fora do escopo.
