# 01 · O que é o Brain

A ideia veio do [laravel-brain](https://github.com/laramint/laravel-brain) e foi refeita para projetos TypeScript:
um mapa navegável da aplicação, **gerado do código a cada arquivo salvo**, para responder em segundos perguntas que
normalmente custam uma tarde de grep:

- Quem pode chamar `POST /api/pedidos/cancelar`? Qual guarda confere antes de gravar? Que tabelas ela toca?
- Que server actions gravam sem conferir permissão de escrita?
- Que tabelas estão sem RLS, ou com política que não filtra pela conta?
- Que agendamento chama esta rota, e ela se protege contra rodar duas vezes no mesmo minuto?
- Que contratos de negócio esta tela segue, e quais testes os provam?
- Quem importa este arquivo? Existe ciclo de import entre estas pastas?

## O desenho

```
código do projeto ──► generator/ (ts-morph, sem type checker)
   rotas, telas, ações,      │  coletores plugáveis: Next App Router, Hono/Express, migrações SQL, contratos...
   migrações, contratos      ▼
                         brain.json (formato em generator/types.ts; na memória, ou em .brain/ fora do git)
                             │
                ┌────────────┴─────────────┐
                ▼                          ▼
     interface local (127.0.0.1:4319)   cli: gerar · checar (CI) · achados (gera ACHADOS.md)
     busca ⌘K, arquivo:linha clicável,
     recarrega sozinha a cada arquivo salvo
```

- **ts-morph sem o type checker**: só a árvore de sintaxe e os imports. É rápido (segundos num projeto de milhares de
  arquivos) e não depende de o projeto compilar.
- **"Alcança" é estático**: o Brain segue chamadas até N níveis (guardas, `service_role`, tabelas tocadas). Um ramo
  que nunca roda também conta; a profundidade ajuda a separar o que importa. Não é um trace.
- **O banco** vem das migrações, na ordem: tabelas, colunas, RLS ligado, políticas. Num projeto com ensaio de
  migrações em Postgres de verdade (PGlite, um contêiner), dá para ir além e ler o catálogo depois de aplicar tudo
  (as funções com a definição que vale hoje, os gatilhos, os agendamentos do `pg_cron`): foi o que o projeto
  Next + Supabase de origem fez.
- **O config** (`brain.config.ts`) é a única parte específica do repositório: onde mora cada parte, quais funções são
  guarda/segredo/limite, quais arquivos são de regra de negócio, quais catálogos (constantes) valem uma página.

## O que ele mostra (seções)

| Seção | O que tem |
|---|---|
| Visão geral | contagens, avisos, achados por gravidade |
| Rotas / Endpoints | método e caminho, quem pode chamar (público, login, segredo, assinatura de webhook, cron), sinais encontrados, respostas e erros, o que toca |
| Telas | logada ou pública, a guarda que confere, as ações da pasta |
| Ações (server actions) | a guarda antes de agir, se grava, o que toca |
| Banco | tabelas, colunas, RLS, políticas, quem usa no código |
| Contratos | por área: cada contrato, situação, onde mora, testes (citados e com o ID no nome), casos de borda |
| Achados | os escritos nos contratos + as checagens automáticas |
| Módulos | quem importa quem, ciclos |
| Avisos | o que o config aponta e não existe mais, contrato com caminho sumido, ID repetido |

## Checagens automáticas (as que vêm no inicial)

| Regra | Acusa |
|---|---|
| `catch-vazio` | `catch {}` sem tratamento nem comentário que justifique |
| `rota-sem-guarda` | rota de API que grava sem nenhum sinal de guarda (login, segredo, assinatura) |
| `acao-sem-guarda` | server action sem nenhuma guarda |
| `tabela-sem-rls` | tabela criada nas migrações sem `enable row level security` |
| as do config | sinais que o projeto declara (ex.: "usa a chave de serviço e é pública") |

Os dois projetos de origem chegaram a ~15 regras próprias (ex.: entrada pública que grava sem limite de taxa nem
CAPTCHA; rota de cron sem trava contra rodar duas vezes; ação que grava conferindo só a permissão de leitura; função
`security definer` sem `search_path`). Cada regra nova nasce de um achado real: quando você corrige uma classe de bug,
pergunte se o Brain podia ter acusado; se sim, vira regra, com um caso que acusa e um que fica quieto na fixture.

## Por que local, e por que não um SaaS de documentação

O mapa expõe a estrutura de segurança (quais portas são públicas, onde a chave de serviço é usada). Gerado a cada
salvamento, nunca fica velho; não publicado, nunca vaza. O que vai para o repositório são os **contratos** (o que tem
de ser verdade), não o mapa (o que é verdade hoje, que o código já diz).
