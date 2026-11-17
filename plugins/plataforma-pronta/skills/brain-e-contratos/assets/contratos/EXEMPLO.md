# Contratos · Pedidos

> Código: `PED` · Lido do código em AAAA-MM-DD (commit `abc1234`). Área de exemplo: troque pelo seu sistema.

## Resumo

Um parágrafo para quem chega agora: o que a área faz, o que está bem feito e os maiores riscos (com os IDs dos
achados). Ex.: o pedido nasce, é pago e pode ser cancelado; o total e a idempotência estão protegidos no banco; o
maior risco é o cancelamento, que confere o login mas não o dono (PED-A1).

## Contratos

### PED-001 · Pedido só nasce com total positivo

- **Regra:** todo pedido gravado tem total maior que zero, depois dos descontos.
- **Por quê:** um pedido zerado libera o produto sem cobrança.
- **Onde mora:** `src/lib/pedidos.ts:42`, `migrations/0007_pedidos.sql:18`
- **Testes:** `test/pedidos.test.ts` › "recusa total zero"
- **Casos de borda:**
  - cupom de 100% → recusado pelo servidor com mensagem clara (✅ `pedidos.ts:51`)
  - total com mais de duas casas decimais → arredondado antes de gravar (❔ não verificado)
- **Situação:** ✅ cumprido

### PED-002 · O mesmo carrinho gera um pedido só

- **Regra:** pagar duas vezes o mesmo carrinho (dois cliques, duas abas, reenvio da rede) devolve o mesmo pedido.
- **Por quê:** o cliente seria cobrado em dobro.
- **Onde mora:** `migrations/0007_pedidos.sql:30`, `src/app/api/pedidos/route.ts:20`
- **Testes:** nenhum
- **Casos de borda:**
  - dois pedidos ao mesmo tempo → o segundo recebe o primeiro (✅ `unique (carrinho_id)` e `on conflict`)
- **Situação:** ⚠️ parcial
- **Achado:** o banco garante, mas a rota devolve 500 no conflito em vez do pedido existente (PED-A2).

### PED-003 · Só o dono cancela o pedido

- **Regra:** cancelar exige ser o dono do pedido (ou da equipe, com papel de suporte).
- **Por quê:** um cliente cancelaria os pedidos de outro.
- **Onde mora:** `src/app/pedidos/acoes.ts:110`
- **Testes:** nenhum
- **Casos de borda:**
  - pedido já enviado → não cancela, explica o motivo (✅ `acoes.ts:118`)
- **Situação:** ❌ quebrado
- **Achado:** a ação confere o login mas não o dono do pedido (PED-A1).

## Endpoints e ações

| Tipo | Caminho ou ação | Quem chama | Autenticação | Guarda | Valida entrada | Erros | Limite / idempotência | Contratos | Situação |
|---|---|---|---|---|---|---|---|---|---|
| API | `POST /api/pedidos` | app | sessão | `exigirLogin` | corpo com Zod | 400, 401, 500 | `unique (carrinho_id)` | PED-001, PED-002 | ⚠️ |
| Ação | `pedidos/acoes.ts › cancelar` | tela | sessão | só o login | id do pedido | `{ erro }` | — | PED-003 | ❌ |

## Achados

| # | Gravidade | Contrato | O quê | Onde | Cenário que quebra |
|---|---|---|---|---|---|
| PED-A1 | alto | PED-003 | a ação confere o login mas não o dono | `src/app/pedidos/acoes.ts:110` | um cliente logado chama a ação com o id de outro pedido e o cancela |
| PED-A2 | médio | PED-002 | conflito de carrinho devolve 500 | `src/app/api/pedidos/route.ts:20` | o segundo clique mostra "erro inesperado" embora o pedido exista |
