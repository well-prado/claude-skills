# Contratos

> O que **tem de ser sempre verdade** no sistema, área por área, lido do código. É a base do trabalho de melhorias,
> testes e correções: cada correção cita o contrato que quebrava, cada teste novo cita o contrato que prova, e cada
> rota ou tela nova diz quais contratos segue.
>
> Onde o contrato e o código discordarem, **um dos dois está errado**: decida qual no PR e corrija os dois juntos.
> O brain (`npm run brain`) lê esta pasta e mostra cada contrato com o código, os testes e as rotas que ele toca.

## As áreas

| Código | Arquivo | Cobre |
|---|---|---|
| `PED` | `pedidos.md` | (troque pelas áreas do seu sistema: uma por assunto de negócio, 3 letras cada) |

`ACHADOS.md` junta os achados de todas as áreas, por gravidade: é a fila de correções. É **gerado**
(`npm run contratos:achados`): o achado se escreve e se apaga na área dele.

## O formato (o brain lê isto: mantenha)

Cada arquivo de área tem quatro partes, nesta ordem: o cabeçalho (com `> Código: \`ÁREA\``), `## Contratos`,
`## Endpoints e ações` e `## Achados`.

### Um contrato

```markdown
### PED-001 · Pedido só nasce com total positivo

- **Regra:** o que tem de ser sempre verdade, em linguagem de negócio, no presente.
- **Por quê:** o que acontece com quem usa se a regra quebrar.
- **Onde mora:** `src/lib/pedidos.ts:42`, `migrations/0007_pedidos.sql:18`
- **Testes:** `test/pedidos.test.ts` › "recusa total zero" (ou `nenhum`)
- **Casos de borda:**
  - dois cliques no botão de pagar → um pedido só (✅ `unique (carrinho_id)` em `0007_pedidos.sql:30`)
  - total com centavos negativos por desconto → recusado (❔ não verificado)
- **Situação:** ✅ cumprido
- **Achado:** só quando a situação é ⚠️ ou ❌: o que está errado, onde, e o cenário concreto que quebra.
```

- **ID**: `ÁREA-NNN`, nunca reaproveitado. Contrato que deixou de valer fica com `**Situação:** 🗑️ revogado` e o motivo.
- **Situação**: `✅ cumprido` (o código faz e, de preferência, um teste prova) · `⚠️ parcial` (faz em parte, ou só na
  tela e não no servidor) · `❌ quebrado` (o código viola a regra hoje) · `❔ não verificado` (a regra é a pretendida,
  mas ninguém conferiu o código ainda).
- **Onde mora** e **Testes** levam caminhos reais, entre crases, com a linha. O brain reprova o caminho que sumiu.
- Caso de borda sempre com o comportamento esperado e se o código trata (✅ / ❌ / ❔).

### Endpoints e ações

Uma linha para **cada** rota de API (cada método) e **cada** ação do servidor (server action, handler de fila,
comando). As telas comuns o brain confere sozinho. A coluna "Caminho ou ação" é o que liga a linha ao código:
`MÉTODO /caminho` para rota, `arquivo.ts › nomeDaFuncao` para ação.

```markdown
| Tipo | Caminho ou ação | Quem chama | Autenticação | Guarda | Valida entrada | Erros | Limite / idempotência | Contratos | Situação |
|---|---|---|---|---|---|---|---|---|---|
| API | `POST /api/pedidos` | app | sessão | `podeComprar` | corpo com Zod | 400, 401, 409 | chave de idempotência | PED-001 | ✅ |
| Ação | `pedidos/acoes.ts › cancelar` | tela | sessão | dono do pedido | id | `{ erro }` | — | PED-003 | ⚠️ |
```

### Achados

```markdown
| # | Gravidade | Contrato | O quê | Onde | Cenário que quebra |
|---|---|---|---|---|---|
| PED-A1 | alto | PED-003 | a ação confere o login mas não o dono | `src/app/pedidos/acoes.ts:120` | um cliente cancela o pedido de outro pelo console |
```

Gravidade: **bloqueante** (dado de um cliente aparece para outro, segredo exposto, perda de dado, cobrança errada) ·
**alto** (regra de negócio quebrada para quem usa, ação sem guarda) · **médio** (caso de borda sem tratamento, erro
genérico, sem teste numa regra crítica) · **baixo** (inconsistência, mensagem, dívida).

## Como usar no dia a dia

1. **Antes de mexer numa área**, leia os contratos dela (no brain: *Contratos*).
2. **Correção de bug** → o PR cita o contrato (`Corrige PED-003`) e o teste novo leva o ID no nome:
   `it("[PED-003] cliente não cancela pedido de outro", …)`. O brain liga o teste ao contrato pelo ID.
3. **Funcionalidade nova** → contrato novo na área, com o próximo número livre, no mesmo PR.
4. **Achado resolvido** → a linha sai de `## Achados` da área, a situação do contrato vira ✅, e
   `npm run contratos:achados` regera o `ACHADOS.md`.
5. **Regra mudou de propósito** → atualize o contrato no mesmo PR que muda o código.
6. **O CI cobra** (`npm run checar` do brain): reprova contrato que cita arquivo que sumiu, ID repetido, contrato sem
   situação, achado de contrato que não existe e `ACHADOS.md` desatualizado. Mudou um arquivo de lugar? Atualize o
   "Onde mora" no mesmo PR.

## Regras de escrita

- Frases curtas, para quem não estava na conversa.
- **Nunca** segredo, token, senha, telefone, e-mail ou nome real de cliente, nem em exemplo.
- Achado só com evidência lida no código (arquivo:linha e o cenário). Suspeita sem conferência é `❔`, não achado.
