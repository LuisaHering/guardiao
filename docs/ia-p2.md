# IA e documentos (P2, parte 1): documentação do bloco

Este documento cobre o primeiro bloco da fase de IA (semanas 9 a 11): consultas,
receitas, exames, analitos, gráfico de tendência e observações. Registra o que foi
construído, as decisões de projeto, a verificação feita e as limitações.

## O que o bloco entrega

| Card | Entrega |
|------|---------|
| 17 | Consultas: cadastro, gravação de áudio pelo navegador ou envio de arquivo, guardado em Storage privado e ligado ao idoso |
| 18 | Resumo estruturado da consulta (resumo, o que fazer, remédios, exames pedidos, dúvidas em aberto, retorno) a partir do texto da consulta |
| 19 | Receita: foto ou PDF vira sugestão de remédios que eu confiro antes de cadastrar; o documento de origem fica guardado e ligado a cada remédio |
| 20 | Exames: foto ou PDF vira uma tela de conferência com todos os valores de uma vez; só o que for confirmado entra no sistema |
| 43 | Analitos: casamento com os que já existem, conversão de unidade explícita na confirmação e tela de fusão manual de duplicados |
| 21 | Gráfico de tendência por analito, com a faixa de referência de cada laudo |
| 22 | Observações: a IA aponta recorrências nos sintomas, no diário e na medicação, com a evidência de cada uma |

## Decisões de projeto

**A IA organiza, não decide.** Todo prompt parte da mesma base: resumir e
estruturar, nunca diagnosticar nem orientar tratamento, usar só o que está no
material e devolver nulo quando não sabe. O conteúdo enviado é tratado como dado:
instruções que apareçam dentro de um documento são ignoradas.

**Nada entra sem confirmação humana.** Receita e exame passam por uma tela de
conferência antes de virar dado. A sugestão da IA não é gravada em lugar nenhum
enquanto eu não confirmo.

**Exame confirmado é etapa do envio, não estado do exame.** Um exame não
confirmado não existe no sistema: não aparece na timeline, não entra no gráfico e
não fica pendente. Na prática isso é garantido por construção: nada é salvo (nem o
arquivo, nem os valores) até a confirmação, e a gravação é uma única transação no
banco (`confirmar_exame`). Como não há staging, não existe arquivo abandonado para
limpar depois.

**A conversão de unidade não é feita pela IA.** Valor de exame é dado clínico, então
só converto onde existe fator conhecido (glicose, colesterol, triglicerídeos,
creatinina, ácido úrico, hemoglobina, vitamina D). Sem fator, a linha fica
bloqueada até eu corrigir ou remover. A conversão aparece explícita na tela de
confirmação e o valor original é guardado junto do convertido.

**A faixa de referência pertence ao resultado, não ao analito.** Cada ponto do
gráfico carrega a faixa impressa no seu próprio laudo, então a banda muda de
altura quando o laboratório muda, e resultado sem faixa impressa fica sem banda.
Ponto fora da faixa é um losango com texto, nunca só cor.

**Observações exigem evidência.** Abaixo de 8 registros no período a IA nem é
chamada. Cada observação precisa citar datas, e o servidor descarta qualquer uma
cuja evidência não aponte para uma data que existe nos registros enviados. A
detecção de movimento dentro da faixa de referência em exames ficou fora do MVP:
exige histórico que não existirá até dezembro, e a variação entre laboratórios
sozinha produz falso positivo.

**A chave da IA fica só no servidor.** A chamada acontece nas rotas `/api/ia/*`,
que exigem login e vínculo com o idoso antes de gastar qualquer token. O vínculo é
checado pelo próprio RLS do banco, sem uma segunda regra de permissão.

**O provedor de IA é intercambiável.** As rotas chamam uma única função
(`extrair`), e uma variável de ambiente escolhe o provedor: Google (Gemini) ou
Anthropic (Claude). Hoje está ativo o Google, por não exigir cartão enquanto só
eu uso o sistema; a implementação da Anthropic permanece pronta em standby. O
formato das respostas é o mesmo nos dois (schemas em zod) e, no servidor, a
resposta é sempre validada contra o schema antes de ser usada. As telas mostram
qual provedor recebe o conteúdo, lendo a mesma variável.

### Desvio de escopo no card 18

O card previa "áudio vira transcrição". Quando o card foi construído, o provedor
era a Anthropic, cuja API lê texto, imagem e PDF mas não transcreve áudio.
Decidi manter o áudio guardado no Storage e colar o texto da consulta (a IA
resume a partir dele). Motivos: não depender de um serviço de transcrição extra,
não enviar áudio de saúde a mais um terceiro e não adicionar custo. A
consequência é que a transcrição não é automática, e continua assim mesmo com o
provedor atual, porque enviar o áudio exigiria outro tratamento de privacidade.

## Verificação já feita

- Build de produção e TypeScript sem erros, com as rotas novas geradas.
- Rota de IA sem login: não revela nem confirma a existência de consulta
  (resposta 404 para qualquer identificador).
- Conversão de unidade conferida contra valores conhecidos (glicose 100 mg/dL
  para 5,55 mmol/L, colesterol 200 mg/dL para 5,17 mmol/L, creatinina 1 mg/dL
  para 88,4 µmol/L, hemoglobina 13,5 g/dL para 135 g/L), incluindo o caso sem
  fator conhecido.
- Gráfico renderizado com dados de exemplo (faixa mudando de laboratório, ponto
  sem faixa, ponto acima da faixa) e o tooltip conferido por hover.

## Limitações e pendências

- **Sem suíte automatizada.** A verificação cobre guarda de acesso, tipos, build e
  a lógica determinística (conversão de unidade); a leitura de documentos pela IA
  é conferida à mão com documentos reais.
- **Texto do consentimento LGPD** ainda não menciona que o conteúdo é enviado a
  um provedor de IA externo. Precisa ser revisado e, se mudar, versionado.
- **Limite de 4 MB por arquivo** (limite da função na Vercel). Foto é reduzida no
  navegador antes de enviar; PDF acima disso é recusado com mensagem.
- **Plano gratuito do Google.** O Google informa que, nesse plano, o conteúdo
  enviado pode ser usado para melhorar os produtos dele (no plano pago, não). Por
  isso, enquanto o provedor ativo estiver no plano gratuito, só devem ser usados
  documentos sem dados reais. As telas exibem esse aviso. Para usar dados reais, o
  caminho é um plano pago do Google ou o provedor Anthropic.
- **Limite do plano gratuito.** O plano gratuito tem limite de requisições por
  minuto e por dia; ao estourar, a tela mostra uma mensagem e basta tentar de novo.
- **Tempo de resposta.** Uma leitura pode levar de alguns segundos a cerca de um
  minuto, conforme o "raciocínio" do modelo (medido: de 5 s com raciocínio baixo a
  59 s no padrão). As telas mostram um indicador com cronômetro e as rotas
  aceitam até 60 s. O nível de raciocínio é ajustável por variável de ambiente.
- **Disponibilidade de modelos.** Modelos gratuitos variam por conta: nos testes,
  o modelo mais novo estourou a cota na primeira chamada e a geração 2.5 já não
  aceita contas novas. O modelo padrão é o `gemini-3.6-flash` e pode ser trocado
  por variável de ambiente.
- **Sem limite de uso por pessoa** nas rotas de IA: o controle hoje é só estar
  logado e ser membro do idoso.
- **Recusa da IA** (stop reason `refusal`) é tratada com mensagem clara, mas sem
  rota de fallback para outro modelo.
- **Navegação** ficou longa com as telas novas; o agrupamento fica para o
  polimento de UX do P3.
