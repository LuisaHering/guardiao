# Núcleo do cuidado (P1) — documentação do bloco

Este documento fecha o bloco P1 do Guardião (semanas 3 a 8). Ele registra o que
foi construído, como as peças se conectam e um roteiro de teste de integração que
eu consigo repetir a cada deploy para ter certeza de que o núcleo continua de pé.

## O que o bloco entrega

O P1 é o núcleo do cuidado: a partir daqui uma família real consegue usar o
sistema no dia a dia, sem nenhuma parte de IA ainda.

- **Autenticação e sessão** (cards 5): cadastro, login, logout e sessão
  persistida via Supabase Auth, com refresh no middleware.
- **Papéis e permissões** (card 6): idoso, cuidador e familiar; o familiar que
  cria o idoso vira administrador. O controle de acesso é por linha no banco
  (RLS), com as funções `is_member` e `is_admin` como base de tudo.
- **Perfil do idoso** (cards 7, 41, 42): dados, condições, alergias e contatos de
  emergência como entidades estruturadas, mais o consentimento LGPD do titular.
- **Vínculo e convites** (card 8): o administrador convida cuidadores e familiares
  por link, com aceite.
- **Medicação** (cards 9, 10): cadastro de remédios e registro diário de adesão,
  com motivo de não-adesão e alerta de silêncio. Modelo sob demanda: a linha de
  registro só existe quando alguém registra de verdade.
- **Diário do cuidador** (cards 11, 12): entradas diárias de alimentação e
  ocorrências, com foto do dia opcional guardada em Storage privado.
- **Sintomas** (card 13): registro com gravidade de 1 a 5 e duração declarada,
  mais o histórico.
- **Emergência** (card 14): QR code com token revogável que mostra os dados
  críticos sem login, servido por função `SECURITY DEFINER` exposta ao papel anon.
- **Timeline** (card 15): tudo que aconteceu com o idoso em um só lugar, em ordem
  cronológica, unindo diário, sintomas e medicação.

## Como as peças se conectam

Todo dado de domínio pendura em `idoso`. O acesso é sempre mediado por `vinculo`:
uma pessoa só enxerga um idoso se tiver um vínculo ativo com ele. As telas leem o
vínculo pelo `RoleProvider`, que entrega `idosoId`, papel e se a pessoa é admin.

O Storage do diário segue a mesma regra do banco: o caminho do arquivo é
`{idoso_id}/{arquivo}`, e as políticas de `storage.objects` checam `is_member`
sobre a primeira pasta do caminho. Bucket privado; as fotos só aparecem por URL
assinada de curta duração.

A emergência é a única exceção deliberada ao RLS: o perfil precisa ser lido por um
socorrista sem conta. Em vez de abrir a tabela, uma função `SECURITY DEFINER`
recebe o token, valida que ele está ativo e monta só os seis campos críticos.
Revogar o token invalida o acesso na hora.

## Roteiro de teste de integração (manual)

Rodo este roteiro no deploy de produção, logado como a familiar administradora,
depois de cada bloco de mudanças. Cada passo tem um resultado esperado; se algum
falhar, o núcleo regrediu.

1. **Sessão.** Fazer login. Esperado: cai no painel, a barra lateral mostra as
   seções do papel familiar.
2. **Perfil.** Abrir Perfil do idoso, conferir dados, condições, alergias e
   contatos. Adicionar uma alergia. Esperado: aparece na lista na hora.
3. **Medicação.** Cadastrar um remédio, marcar "Deu" hoje e depois "Não deu" com
   motivo em outro. Esperado: os dois estados persistem ao recarregar.
4. **Diário.** Criar uma entrada com texto e uma foto. Esperado: a entrada aparece
   no topo com a foto renderizada (URL assinada).
5. **Sintomas.** Registrar um sintoma com gravidade 4. Esperado: entra no histórico
   com o círculo vermelho de gravidade alta.
6. **Timeline.** Abrir a Timeline. Esperado: o remédio, a entrada do diário e o
   sintoma dos passos anteriores aparecem juntos, em ordem, agrupados por dia.
7. **Emergência (admin).** Gerar o QR, copiar o link. Esperado: o QR renderiza e o
   link abre.
8. **Emergência (anônima).** Abrir o link da emergência numa janela anônima (sem
   login). Esperado: mostra nome, alergias, condições, medicações e contatos, com
   botão de ligar. Nenhum outro dado do idoso vaza.
9. **Revogação.** Voltar como admin e revogar o QR. Recarregar o link anônimo.
   Esperado: "perfil não disponível". A revogação é imediata.
10. **Isolamento.** Confirmar que uma conta sem vínculo com o idoso não vê nenhum
    desses dados (RLS). Esperado: telas vazias ou bloqueadas para quem não é membro.

## Hardening e deploy

- Dependências auditadas: `npm audit` em zero vulnerabilidades. O Next foi elevado
  para 16.3.5 para fechar um aviso crítico de RCE que existia na 16.3.0.
- Build de produção limpo (`next build`), TypeScript sem erros, todas as rotas do
  núcleo geradas.
- Deploy contínuo na Vercel a cada push na `main`.

## Pendências conhecidas

- O convite ainda não dispara email automático; o link é enviado à mão.
- O aviso de deprecação `middleware` para `proxy` do Next 16 é cosmético e fica
  para uma limpeza futura.
- Testes automatizados não fazem parte deste bloco; a verificação do núcleo é o
  roteiro manual acima. Uma suíte automatizada pode entrar no hardening final (P4).
