---
name: brain-e-contratos
description: 'Instala num projeto TypeScript/JavaScript o "Brain" — um mapa da aplicação lido do próprio código (rotas e endpoints com quem pode chamar, telas, server actions, tabelas com RLS e políticas, jobs, imports e ciclos, checagens automáticas de segurança) que abre local em 127.0.0.1 e se atualiza a cada arquivo salvo — e os "contratos" de regra de negócio (docs/contratos, com ID por regra, onde mora no código, testes que provam, casos de borda, situação e achados), checados no CI. Use quando a pessoa pedir o brain, um mapa do sistema, documentar as regras de negócio, auditar rotas/ações sem guarda, preparar o projeto para agentes de IA trabalharem com segurança, "as boas práticas de sempre", onboarding de um repositório grande, ou antes de uma refatoração/migração grande em que é preciso saber o que existe e o que tem de continuar verdade.'
---

# Brain e contratos

Dois instrumentos que se completam:

- **O Brain** responde *o que existe*: cada rota com quem pode chamá-la e qual guarda confere antes de gravar, cada
  tela, cada server action, cada tabela com o RLS e as políticas, quem importa quem, os ciclos, e as checagens que
  acusam sozinhas o que parece perigoso. É lido do código (análise estática), roda **só local** e nunca toca no banco
  de verdade nem na produção.
- **Os contratos** respondem *o que tem de continuar verdade*: cada regra de negócio com um ID (`PED-004`), onde mora,
  os testes que a provam, os casos de borda e a situação (✅ ⚠️ ❌ ❔). Correção cita o ID, teste novo leva o ID no
  nome, e o CI reprova contrato que aponta para código que sumiu.

Juntos, deixam qualquer pessoa (ou agente) mexer num sistema grande sabendo onde pisa. Nasceram em dois projetos reais
(um Hono + Drizzle, um Next.js App Router + Supabase com ~370 contratos) e viraram molde.

## Como usar esta skill

1. Leia [references/01-o-que-e-o-brain.md](references/01-o-que-e-o-brain.md) (o desenho e as regras de ouro).
2. **Instale o Brain inicial** de `assets/brain/` em `tools/brain/` do projeto (passo a passo abaixo) e faça-o
   funcionar com o `brain.config.ts` do projeto. Ele já entende Next.js App Router, Hono/Express e migrações SQL.
   Stack diferente: escreva um coletor ([references/construir-o-gerador.md](references/construir-o-gerador.md)).
3. **Escreva os contratos** com o método de [references/02-escrever-os-contratos.md](references/02-escrever-os-contratos.md):
   uma área por vez, lida do código, em paralelo por subagentes quando o projeto é grande.
4. **Ligue no dia a dia e no CI** ([references/03-dia-a-dia-e-ci.md](references/03-dia-a-dia-e-ci.md)).

## Instalar o Brain

```bash
mkdir -p tools && cp -R <esta skill>/assets/brain tools/brain
mkdir -p docs/contratos && cp <esta skill>/assets/contratos/README.md docs/contratos/   # se ainda não tem contratos
```

O `assets/contratos/EXEMPLO.md` é só para ler (uma área pronta, para copiar o jeito): não o copie para o projeto, porque
ele cita arquivos que não existem lá e o `checar` reprova.

No `package.json` da raiz:

```json
"brain": "cd tools/brain && (test -d node_modules || npm ci --no-audit --no-fund) && npm run dev",
"brain:gerar": "cd tools/brain && (test -d node_modules || npm ci --no-audit --no-fund) && npm run --silent gerar",
"brain:checar": "cd tools/brain && (test -d node_modules || npm ci --no-audit --no-fund) && npm run --silent checar",
"contratos:achados": "cd tools/brain && (test -d node_modules || npm ci --no-audit --no-fund) && npm run --silent achados"
```

Os nomes exatos dos scripts de `tools/brain` estão no `package.json` e no `README.md` dela; confira antes de colar.

Depois:

1. Ajuste `tools/brain/brain.config.ts`: as partes do projeto (pastas), a pasta do App Router ou o arquivo de entrada
   do router, as migrações, **as funções que são guarda** (ex.: `exigirLogin`, `requireAuth`, `podeEscreverEm`), as
   áreas de regra e os catálogos que valem a pena mostrar.
2. Tire `tools/brain` de tudo da raiz: `tsconfig` (`exclude`), ESLint (`ignores`), Vitest/Jest, o build e o
   `.dockerignore`. Ele tem `package.json` e lockfile próprios, fora dos workspaces.
3. Ponha `tools/brain/.brain/` no `.gitignore` (o mapa gerado nunca entra no git).
4. `npm run brain` abre em `http://127.0.0.1:4319`. **Pronto quando** a página **Avisos** está vazia (ou cada aviso
   é entendido e anotado) e as contagens batem com a realidade: compare o número de rotas, telas e tabelas com um
   `find`/`grep` simples e explique qualquer diferença.

## Regras de ouro

- **Só local.** Escuta em `127.0.0.1`, nada publicado, mapa fora do git. Mostra a estrutura de segurança do sistema:
  não é coisa para ficar exposta.
- **O config não descreve o código, só diz onde olhar.** Se o código mudar de forma (uma guarda trocou de nome, um
  arquivo de regra sumiu), o Brain avisa e o `checar` do CI falha: é a hora de atualizar o config.
- **Checagem é sinal, não sentença.** "Ação sem guarda" diz onde olhar; confirmar e escrever o achado no contrato
  (com o cenário que quebra) é trabalho de quem lê o código.
- **Cada checagem tem um caso que acusa e um que fica quieto** na fixture de teste, e foi vista falhar.
- **Contrato só com evidência lida no código** (arquivo:linha). Suspeita sem conferência é `❔`, não achado.
- **Nunca** segredo, token, telefone, e-mail ou nome real de cliente num contrato, nem em exemplo.
