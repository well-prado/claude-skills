# Brain

O mapa da aplicação, lido do próprio código: cada **rota**, **tela** e **ação do servidor**, com quem pode chamar e o
que toca no banco; as **tabelas** como ficam depois de todas as migrações (colunas, RLS, políticas); os **contratos** de
regra de negócio de `docs/contratos`, ligados ao código e aos testes que os provam; os **módulos** (quem importa quem e
os ciclos); e as **checagens automáticas**, que apontam onde olhar.

É uma ferramenta **só local**: o servidor escuta em `127.0.0.1`, nada é publicado e o mapa gerado (`.brain/`) não entra
no git. Nada roda contra o banco nem contra a produção: é leitura do código e das migrações.

Nasceu em dois projetos reais (um Hono + Drizzle e um Next.js App Router + Supabase) e foi refeito genérico: o que é do
seu repositório fica em `brain.config.ts`.

## Instalar

Copie esta pasta para `tools/brain` na raiz do projeto e, na raiz, acrescente ao `package.json`:

```json
{
  "scripts": {
    "brain": "cd tools/brain && (test -d node_modules || npm ci --no-audit --no-fund) && npm run dev",
    "brain:gerar": "cd tools/brain && (test -d node_modules || npm ci --no-audit --no-fund) && npm run --silent gerar",
    "brain:checar": "cd tools/brain && (test -d node_modules || npm ci --no-audit --no-fund) && npm run --silent checar",
    "contratos:achados": "cd tools/brain && (test -d node_modules || npm ci --no-audit --no-fund) && npm run --silent achados"
  }
}
```

`tools/brain` tem o próprio `package.json` e `package-lock.json`: fica fora dos workspaces, do `tsconfig`, do ESLint, do
Vitest e do build da raiz (exclua a pasta deles se eles varrem tudo). Precisa de Node 22 ou mais novo.

Depois, abra `brain.config.ts` e troque os nomes de `sinais` pelos das suas funções de guarda.

## Rodar

```bash
npm run brain
```

Abre <http://127.0.0.1:4319> (outra porta: `BRAIN_PORTA=4400`). Enquanto ele roda, salvar qualquer arquivo do projeto
gera o mapa de novo e a página se atualiza sozinha. `⌘K` (ou `Ctrl K`) busca em tudo. Cada item aponta o arquivo e a
linha; o link abre no editor escolhido no rodapé da barra lateral (VS Code, Cursor, Windsurf, Zed, ou copiar o caminho).

| Comando (em `tools/brain`) | Para quê |
|---|---|
| `npm run dev` | a página, com atualização a cada arquivo salvo |
| `npm run gerar` | grava `.brain/brain.json` e lista os avisos, sem abrir a página |
| `npm run checar` | o que o CI roda: sai 1 se houver problema (abaixo) |
| `npm run achados` | regera `docs/contratos/ACHADOS.md` a partir das áreas |
| `npm test` | os testes do próprio gerador |
| `npm run typecheck` | confere os tipos do gerador |

Todos aceitam `--config outro-arquivo.ts` (via `npx tsx generator/cli.ts gerar --config …`).

## O que mostra

- **Rotas**: Next.js (`route.ts`, um item por método exportado) e Hono/Express (`x.get("/caminho", …)`, com o prefixo
  de quem monta o router e os middlewares herdados). Quem chama (os sinais de guarda encontrados), se grava, as tabelas
  que alcança, os contratos que a citam e as checagens que a acusam.
- **Telas**: cada `page.tsx`, com a guarda dela e a dos `layout.tsx` das pastas acima.
- **Ações**: cada função exportada de arquivo `"use server"`.
- **Banco**: das migrações SQL (em ordem de nome) ou do schema do Drizzle: colunas, RLS, políticas e quem usa.
- **Contratos**: cada área de `docs/contratos`, com situação, onde mora, testes citados e testes que levam o ID no nome,
  casos de borda, e as linhas de "Endpoints e ações" ligadas à rota, tela ou ação do código.
- **Achados**: os escritos nos contratos e as checagens automáticas.
- **Módulos**: quem importa quem, quem é importado por quem, arquivos com mais de 400 linhas e ciclos de import.
- **Avisos**: os problemas (que reprovam o `checar`) e os avisos (que pedem um olhar).

### Checagens automáticas

| Regra | Acusa |
|---|---|
| `rota-sem-guarda` | rota que não está em `publicas` e não chega a nenhum sinal de guarda (alto quando grava) |
| `acao-sem-guarda` | ação do servidor sem guarda (alto quando grava) |
| `tela-sem-guarda` | tela numa pasta de `telasExigemGuarda` sem guarda nela nem no layout |
| `tabela-sem-rls` | tabela das migrações sem RLS (com `exigirRls`), fora de `tabelasSemRls` |
| `rls-sem-politica` | RLS ligado e nenhuma política (só o servidor lê) |
| `catch-vazio` | `catch {}` sem instrução nem comentário (um comentário dizendo por que ignora conta como decisão) |
| as suas | cada item de `regras` no config: "tem estes sinais e nenhum destes" |

São sinais estáticos, não um trace: o brain diz **onde olhar**. Confirmar e escrever o achado no contrato é trabalho de
quem lê o código.

### O que o `checar` reprova

- contrato que cita um caminho que não existe mais (em "Onde mora" ou "Testes");
- ID de contrato repetido;
- contrato sem situação;
- achado que cita um contrato que não existe;
- `ACHADOS.md` desatualizado;
- `brain.config.ts` apontando uma pasta que sumiu (o config ficou para trás do código).

Um sinal cujo nome não aparece em lugar nenhum vira **aviso**: quase sempre é um nome trocado no código.

No CI, um passo basta:

```yaml
- name: Brain (contratos e config em dia)
  run: cd tools/brain && npm ci --no-audit --no-fund && npm run checar && npm test
```

## Como funciona

```
código ──► coletores (generator/coletores) ──► brain.json (generator/types.ts) ──► ui/ (JS puro)
              ▲                                       ▲
       brain.config.ts                         servidor.ts (127.0.0.1, SSE)
```

- `generator/projeto.ts` lê os arquivos de cada parte com o [ts-morph](https://ts-morph.com), **sem o type checker**
  (só a árvore e os imports, para ser rápido), resolve os imports (relativos, `paths` do tsconfig e `aliases`) e acha os
  ciclos.
- `generator/sinais.ts` anda das chamadas de cada ponto de entrada até `profundidade` níveis, seguindo a função
  chamada até o corpo dela em outro arquivo, e junta os sinais, as tabelas (`.from("x")`, variável de tabela do
  Drizzle, SQL cru com nome conhecido) e se grava.
- Os coletores (`next-app-router.ts`, `hono-express.ts`, `sql-migracoes.ts`) acham os pontos de entrada e o banco.
- `generator/contratos.ts` lê o formato de `docs/contratos/README.md`.
- `generator/checagens.ts` aplica as regras; `generator/index.ts` junta tudo.

Num repositório real com ~1.000 arquivos, 500 ações e 240 migrações, gerar leva uns 20 s e ~600 MB de memória.

### Limites

- "Alcança" é referência estática: um ramo que nunca roda também conta, e uma chamada por variável calculada não conta.
- O SQL é lido por expressão regular: tabela criada por `execute format(...)` fora do laço `foreach … in array[...]`,
  ou por função, fica de fora. Para o banco exato, aplique as migrações num Postgres em memória (PGlite) e leia o
  catálogo; veja `references/construir-o-gerador.md` da skill.
- Hono/Express: router devolvido por função e caminho calculado ficam de fora (aparecem nos avisos).
- Ações: só arquivos com `"use server"` no topo; a diretiva dentro de uma função não entra.

## Acrescentar um coletor

1. Crie `generator/coletores/<stack>.ts` exportando uma função que recebe o `ContextoAlcance` e devolve
   `{ rotas, telas?, acoes?, avisos }` nos tipos de `generator/types.ts`. Para cada ponto de entrada, chame
   `alcancar(ctx, [noDoHandler])` e espalhe o resultado no item.
2. Ligue-o em `generator/index.ts` atrás de uma opção nova do `BrainConfig` (`generator/config.ts`).
3. Escreva o caso no `test/fixtures/mini` e um teste que **precisa acusar** e um que **precisa ficar quieto**. Quebre o
   coletor de propósito e veja o teste ficar vermelho antes de confiar nele.

Receitas para Fastify, NestJS, Express puro, Prisma, Supabase e tRPC estão em
`references/construir-o-gerador.md` da skill.
