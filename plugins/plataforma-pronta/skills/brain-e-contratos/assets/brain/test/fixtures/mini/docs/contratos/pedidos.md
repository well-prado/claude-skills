# Contratos · Pedidos

> Código: `PED`

## Contratos

### PED-001 · Pedido só nasce com total positivo

- **Regra:** o total é maior que zero.
- **Por quê:** pedido zerado vira cobrança errada.
- **Onde mora:** `supabase/migrations/0001_pedidos.sql:6`, `acoes.ts:5`
- **Testes:** `testes/pedidos.test.ts` › "cria pedido com total positivo"
- **Casos de borda:**
  - total negativo → recusado pelo banco (✅ `0001_pedidos.sql:6`)
- **Situação:** ✅ cumprido

### PED-002 · Apagar pedido exige login

- **Regra:** só quem está logado apaga.
- **Por quê:** qualquer um apagaria os pedidos.
- **Onde mora:** `src/lib/sumiu.ts:3`
- **Testes:** nenhum
- **Situação:** ❌ quebrado
- **Achado:** `apagarTudo` não confere nada (PED-A1).

### PED-003 · Contrato ainda sem situação

- **Regra:** escrita pela metade.

## Endpoints e ações

| Tipo | Caminho ou ação | Quem chama | Autenticação | Contratos | Situação |
|---|---|---|---|---|---|
| API | `POST /api/pedidos` | tela | sessão | PED-001 | ✅ |
| Ação | `acoes.ts › apagarTudo` | tela | nenhuma | PED-002 | ❌ |
| API | `GET /api/nao-existe` | ninguém | — | — | ❔ |

## Achados

| # | Gravidade | Contrato | O quê | Onde | Cenário que quebra |
|---|---|---|---|---|---|
| PED-A1 | alto | PED-002 | a ação apaga sem guarda | `src/app/pedidos/acoes.ts:10` | qualquer visitante chama a ação e apaga tudo |
| PED-A2 | baixo | PED-077 | cita contrato que não existe | — | — |
