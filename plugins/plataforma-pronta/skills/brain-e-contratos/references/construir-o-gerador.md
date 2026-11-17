# Construir o gerador do brain

O brain inicial (`assets/brain`) já funciona em projetos Next.js (App Router), Hono e Express, com migrações SQL ou
Drizzle. Este guia explica a arquitetura e como estendê-lo para outra stack sem perder o que o torna útil.

## A arquitetura em uma linha

```
código + migrações + docs/contratos ──► coletores ──► brain.json ──► interface
                    ▲                                     ▲
             brain.config.ts                       checar (CI) · testes
```

1. **O código é a fonte.** O brain nunca descreve o sistema à mão: lê os arquivos. O `brain.config.ts` diz só o que é
   próprio do repositório e não dá para inferir: onde mora cada parte, quais funções são guarda, quais rotas são
   públicas de propósito, quais regras valem.
2. **Os coletores acham os pontos de entrada** (rotas, telas, ações, handlers de fila, comandos) e o banco.
3. **O alcance liga cada ponto de entrada ao que ele toca**, seguindo as chamadas até N níveis: sinais (guarda,
   gravação, perigo), tabelas e se grava.
4. **O brain.json é o contrato** entre o gerador e a interface (`generator/types.ts`). A interface só lê o JSON; dá
   para trocá-la (o projeto original usava Vite + React + shadcn/ui) sem tocar no gerador.
5. **O `checar` é o que o CI cobra**: contratos que citam caminho que sumiu, ID repetido, contrato sem situação, achado
   de contrato inexistente, `ACHADOS.md` desatualizado e o próprio config apontando pasta que sumiu.
6. **Avisos quando o config fica para trás.** Um sinal cujo nome não aparece em nenhum ponto de entrada quase sempre é
   uma função renomeada: o brain avisa, em vez de acusar todas as rotas de "sem guarda" em silêncio.
7. **Dois tipos de teste.** O de *fixture* (`test/fixtures/mini`, um repositório pequeno escrito para o teste) prova
   cada coletor e cada checagem com um caso que acusa e um que fica quieto. O de *invariantes* roda no repositório de
   verdade com regras que valem em qualquer versão do código (todo `route.ts` vira rota, todo contrato acha seus
   caminhos, toda migração é lida).

## Princípios que não se negociam

- **Só local.** O servidor escuta em `127.0.0.1`. O mapa tem a estrutura inteira do sistema, inclusive onde faltam
  guardas: não publique, não suba para o git (`.brain/` no `.gitignore`).
- **Só leitura.** Nada roda contra o banco nem contra a produção. Para o banco exato, aplique as migrações num Postgres
  em memória (abaixo), nunca num banco real.
- **Sinais, não provas.** Checagem automática diz onde olhar. O achado só vai para o contrato depois que alguém lê o
  código e escreve o cenário que quebra.
- **Rápido o bastante para rodar a cada arquivo salvo.** Sem o type checker do TypeScript (só a árvore sintática), e
  com cache do que cada função faz diretamente.
- **Uma checagem que nunca acusa não protege nada.** Todo teste novo é visto vermelho antes de ser confiado: quebre o
  código de propósito, rode, desfaça.

## O contrato de um coletor

Um coletor é uma função que recebe o `ContextoAlcance` (o projeto carregado, os sinais e as tabelas conhecidas) e
devolve itens nos tipos de `generator/types.ts`:

```ts
import { alcancar, juntar, type ContextoAlcance } from '../sinais.js';
import type { Aviso, Rota } from '../types.js';

export function coletarMinhaStack(ctx: ContextoAlcance): { rotas: Rota[]; avisos: Aviso[] } {
  const rotas: Rota[] = [];
  for (const [file, sf] of ctx.p.arquivos) {
    // 1. ache o ponto de entrada na árvore do ts-morph (sf)
    // 2. calcule o alcance a partir do nó do handler (e dos middlewares herdados, com juntar)
    // 3. empurre o item, com id estável, ref { file, line } e o alcance espalhado
  }
  return { rotas, avisos: [] };
}
```

Regras do contrato:

- `id` estável e legível (`POST /api/pedidos`, `tela /pedidos/[id]`, `arquivo.ts › nomeDaFuncao`): é por ele que a
  linha de "Endpoints e ações" do contrato se liga ao código, e que a busca encontra o item.
- `ref.line` aponta o handler, não o topo do arquivo.
- O que o coletor **não consegue** ler (caminho calculado, router devolvido por função) vira **aviso**, nunca some.
- Ligue o coletor em `generator/index.ts` atrás de uma opção do `BrainConfig`, e acrescente o caminho que ele lê em
  `caminhosDoConfig` para o `checar` reprovar quando a pasta sumir.

## Receitas por stack

### Express puro

Já coberto por `hono-express.ts`: `const app = express()`, `const r = express.Router()`, `app.use("/api", r)`,
`r.get("/x", exigirLogin, handler)`. Middleware passado por nome conta como chamada. `app.use("/admin", exigirEquipe)`
vale só para o que fica abaixo de `/admin`.

### Fastify

- Rotas: `fastify.get("/x", { preHandler: [auth] }, handler)` e `fastify.route({ method, url, preHandler, handler })`.
  Leia o objeto de opções: `preHandler`/`onRequest` entram no alcance como os middlewares do Hono.
- Prefixo: `fastify.register(plugin, { prefix: "/v1" })`, onde `plugin` é uma função `async (app) => { app.get(…) }`.
  Ande do `register` até o corpo do plugin e some o prefixo, como `juntarCaminho` faz.
- Hooks globais: `fastify.addHook("onRequest", auth)` vale para todas as rotas daquele escopo (e dos filhos registrados
  depois dele).

### NestJS

- A rota é a soma de dois decoradores: `@Controller("pedidos")` na classe e `@Get(":id")`/`@Post()` no método.
  Com o ts-morph: `classe.getDecorator("Controller")` e `metodo.getDecorators()`.
- Guardas: `@UseGuards(AuthGuard)` na classe ou no método, e o guard global (`app.useGlobalGuards`). Trate o nome do
  guard como sinal (`funcoes: ["AuthGuard", "RolesGuard"]`), lendo os argumentos do decorador.
- Rota pública com `@Public()` (decorador próprio): marque `publica` quando o decorador estiver presente.

### tRPC

- O "caminho" é a cadeia de chaves dos `router({ … })` aninhados: `pedidos.criar`.
- O tipo do procedimento é o sinal: `protectedProcedure` é guarda; `publicProcedure`, pública. `.mutation()` grava;
  `.query()` lê.
- Middleware: `t.procedure.use(exigirLogin)` cria um procedimento base; siga a variável até o `.use`.

### Drizzle

Já coberto (`drizzle` no config): `pgTable("users", { … })` vira tabela com as colunas, e a variável (`users`) é
reconhecida no alcance (`db.select().from(users)`). Para RLS e políticas, use as migrações SQL que o drizzle-kit gera
(`migracoes: ["drizzle"]`).

### Prisma

- Tabelas: leia `prisma/schema.prisma` (`model Pedido { … @@map("pedidos") }`) por expressão regular: o nome da tabela é
  o `@@map` ou o nome do model.
- Uso: `prisma.pedido.create(…)` → tabela `pedido` (ou o `@@map`), e `create`/`update`/`upsert`/`delete`/`*Many`
  gravam. Acrescente ao alcance: quando a chamada é `prisma.<model>.<metodo>`, o `<model>` é a tabela.
- Migrações: `prisma/migrations/*/migration.sql` (uma pasta por migração): leia os `.sql` em ordem de pasta.

### Supabase (o banco exato)

O coletor `sql-migracoes.ts` lê por expressão regular e acerta o que é escrito de forma direta (`create table`,
`enable row level security`, `create policy`, e o laço `foreach t in array array[...]`). Para o banco **exato**:

1. Aplique todas as migrações num Postgres em memória, o [PGlite](https://pglite.dev), num processo à parte (ele pesa).
2. Antes, crie o que o Supabase traz e o PGlite não tem: os papéis `anon`, `authenticated` e `service_role`, o esquema
   `auth` com `auth.uid()` e `auth.jwt()`, e esquemas vazios das extensões que ele não carrega (`cron`, `vault`,
   `net`), com funções que não fazem nada.
3. Leia o catálogo: `pg_class.relrowsecurity` (RLS), `pg_policies` (políticas com o `using` e o `with check`),
   `pg_proc` (`prosecdef` para `security definer`, `proconfig` para o `search_path`), `information_schema` para as
   colunas, e a tabela `cron.job` se você recriou o `cron.schedule` como um insert.
4. Guarde o resultado em cache em `.brain/`, chaveado pelo nome e tamanho dos arquivos de migração: ele só muda quando
   uma migração muda.

Esse mesmo ensaio vira um teste de CI que vale ouro: "todas as migrações aplicam do zero" e "nenhuma tabela sem RLS".

## Checagens próprias do repositório

A maior parte do valor está em checagens que só fazem sentido no seu sistema. Comece pelo `regras` do config (sem
código):

```ts
regras: [
  { id: 'admin-sem-login', titulo: 'usa o cliente admin sem conferir quem chama', gravidade: 'alto',
    em: ['rota', 'acao'], tem: ['admin'], semNenhum: ['login', 'assinatura'] },
  { id: 'publica-sem-limite', titulo: 'entrada pública que grava sem limite de taxa', gravidade: 'medio',
    em: ['rota', 'acao'], semNenhum: ['login', 'limite', 'captcha'], soQuandoGrava: true },
],
```

Quando a regra precisa de mais (olhar o argumento de uma chamada, a ordem de duas chamadas), escreva-a em
`generator/checagens.ts`, com o caso que acusa e o que fica quieto na fixture.

Exemplos que pagaram o próprio custo nos projetos de origem:

- rota agendada (cron) sem a trava que impede duas execuções no mesmo minuto;
- tabela nova sem a coluna que separa um cliente do outro, ou com política que não filtra por ela;
- função `security definer` sem `search_path` fixo, ou executável pelo papel anônimo;
- ação que grava conferindo só "pode ver o módulo" em vez de "pode escrever nele";
- `select("*")` em tela nova, resposta 500 genérica, `catch` vazio.

## A interface

`ui/` é JS puro, sem build: `index.html`, `app.js` e `estilo.css`. O servidor (`servidor.ts`) gera ao subir, serve o
`/brain.json`, regera a cada arquivo salvo (`fs.watch` recursivo) e avisa a página por SSE (`/eventos`), que busca o
mapa novo sem perder o que estava aberto.

Quer uma interface mais rica (diagrama do banco, grafo de módulos)? Troque `ui/` por um app Vite que lê o mesmo
`/brain.json`: o formato está em `generator/types.ts`, e o gerador não muda.
