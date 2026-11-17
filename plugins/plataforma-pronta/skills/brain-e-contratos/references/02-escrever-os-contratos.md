# 02 · Escrever os contratos

O formato (que o Brain lê, então mantenha) está em `assets/contratos/README.md`, com uma área de exemplo em
`assets/contratos/EXEMPLO.md`. Este é o **método** para preencher um projeto que ainda não tem nenhum.

## 1. Divida em áreas

5 a 10 áreas, cada uma com um código de 3 letras e um arquivo: `ACE` acesso e login, `PED` pedidos, `COB` cobrança,
`INT` integrações e rotinas, `BAN` banco (RLS, funções, migrações)… A divisão segue o negócio, não as pastas.
Escreva a tabela de áreas no `docs/contratos/README.md` (o que cada uma cobre e o que fica de fora).

## 2. Uma área por vez, lida do código

Para cada área (em projeto grande, **um subagente por área, em paralelo**, cada um com o brief abaixo):

> Leia a área X do código (pastas Y, Z; rotas, ações, tabelas e migrações que o Brain lista para ela). Escreva
> `docs/contratos/<area>.md` no formato de `docs/contratos/README.md`:
> - **Contratos**: o que tem de ser sempre verdade, em linguagem de negócio, cada um com Regra, Por quê (o que acontece
>   com quem usa se quebrar), Onde mora (arquivo:linha reais), Testes (os que existem, ou `nenhum`), Casos de borda
>   (cada um com o comportamento esperado e ✅/❌/❔ dizendo se o código trata) e Situação.
> - **Endpoints e ações**: uma linha para cada rota e cada server action da área, com autenticação, guarda, validação
>   de entrada, erros, limite/idempotência e os contratos que segue.
> - **Achados**: só com evidência (arquivo:linha + o cenário concreto que quebra), com gravidade.
> Não invente: regra que você acha que deveria existir mas não achou no código é `❔ não verificado`. Nunca segredo,
> e-mail, telefone ou nome real de cliente, nem em exemplo. Não mexa em código.

Depois de cada área: `checar` do Brain (caminhos existem, IDs únicos, toda situação preenchida) e uma leitura sua de
2 ou 3 contratos contra o código. Contrato errado é pior que nenhum.

## 3. O que vale um contrato

Bom contrato é uma regra que **alguém pode quebrar sem perceber** e que **dói em quem usa** quando quebra:

- isolamento entre contas ("toda leitura com a chave de serviço filtra pela conta da chave");
- dinheiro ("a cobrança é idempotente pela chave do pedido; o webhook repetido não cobra de novo");
- permissões ("visualizador não grava; quem confere é o servidor, não a tela");
- prazos e fusos ("a numeração do dia recomeça à meia-noite de Brasília");
- integrações ("webhook de saída é assinado e reenviado até 5 vezes com espera crescente");
- privacidade ("a chave da API é guardada só como hash; nunca aparece em log").

Não vale contrato: detalhe de implementação que pode mudar sem ninguém perceber a diferença (nome de função, ordem de
colunas), ou o que o framework já garante.

## 4. Casos de borda são o ouro

Para cada regra, pense no que quebra: duas pessoas ao mesmo tempo, a virada do dia, o valor vazio, a conta
suspensa, o webhook repetido, o arquivo de 0 byte, o usuário que perdeu a permissão no meio da sessão. Cada caso de
borda vira uma linha com o esperado e se o código trata. Os ❌ e ❔ dos casos de borda são a fila de testes a escrever.

## 5. Achados viram a fila

`npm run contratos:achados` junta os achados de todas as áreas em `docs/contratos/ACHADOS.md`, por gravidade
(bloqueante, alto, médio, baixo). É a fila de correções: cada PR que corrige cita o ID (`Corrige PED-A3`), tira a
linha da área, muda a situação do contrato para ✅ e regera o `ACHADOS.md`.

## Tamanho

No projeto maior de origem: ~370 contratos em 8 áreas, escritos em paralelo (um subagente por área) e revisados por
amostragem. Comece pelas áreas que mexem com dinheiro, acesso e dados de terceiros.
