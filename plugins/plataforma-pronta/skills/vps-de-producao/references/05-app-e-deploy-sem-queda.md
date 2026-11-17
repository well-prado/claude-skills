# 05 · O app em contêiner e o deploy sem queda

## A imagem

Regras do Dockerfile (um por serviço, em `docker/<serviço>/Dockerfile`, ou o `Dockerfile` da raiz se há um só):

- **Base com versão exata** (`node:22.23.4-bookworm-slim`, não `node:22`): tag flutuante deixa a produção numa versão
  que depende do cache do servidor, e o rollback não volta de verdade.
- **Multi-stage**: dependências e build num estágio, só o necessário no final.
- **Usuário sem root** no estágio final (`USER node`), com só a pasta de escrita (uploads) dele.
- **`HEALTHCHECK`** que bate na rota de saúde do próprio app (o `start-first` depende dele para saber quando trocar).
- **Nada de segredo no build** (`ARG`/`ENV` com chave ficam no histórico da imagem). O build só recebe `GIT_COMMIT`.
- **Só o commitado entra**: o `ci-deploy` recebe `git archive` do commit, então `.env`, dumps e planilhas soltas na
  pasta nunca chegam ao servidor. Mesmo assim, mantenha um `.dockerignore`.

Exemplo para Next.js (saída `standalone`):

```dockerfile
FROM node:22.23.4-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build          # next.config: output: "standalone"

FROM node:22.23.4-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
```

## A mesma imagem nos dois ambientes

A imagem não pode ter nada do ambiente embutido. É isso que deixa a imagem do staging ir para a produção.

- **Next.js:** `NEXT_PUBLIC_*` é **embutido no build**. Saídas: (a) ler a configuração no servidor (Server Component
  ou rota) e passar ao cliente por props/contexto; (b) um `/env.js` gerado ao subir o contêiner a partir das variáveis
  (o cliente lê `window.__ENV`); (c) só o que é igual nos dois ambientes fica em `NEXT_PUBLIC_*`. Construir uma imagem
  por ambiente funciona, mas aí a produção roda uma imagem que ninguém testou: escolha consciente, escrita no ADR.
- **SPA estática (Vite, Expo web):** o mesmo `/env.js` gerado no `entrypoint` do nginx.
- **Endereços do provedor que saiu:** procure `vercel.app`, `supabase.co`, `herokuapp.com`, `x-vercel-*`,
  `@vercel/analytics`, `VERCEL_URL` no código e no banco (URLs absolutas guardadas).

## A rota de saúde

`GET /health` responde rápido, sem login, e devolve o que o deploy confere:

```json
{ "status": "ok", "versao": "1.4.0", "commit": "a1b2c3d" }
```

`versao` e `commit` vêm das variáveis `APP_VERSAO` e `APP_COMMIT` que o `ci-deploy` põe na stack. Confira o banco com
um `select 1` com timeout curto (e devolva 503 se falhar). Nada de dado pessoal, contagem de usuários ou versão de
dependência.

## Trocar sem derrubar ninguém

O `stack.yml` do molde junta quatro peças. Sem qualquer uma delas, há erro durante o deploy:

1. **`order: start-first`**: a nova instância sobe e só depois de saudável (HEALTHCHECK) a antiga recebe o SIGTERM.
2. **`traefik.swarm.lbswarm=true`**: o Traefik manda para o endereço virtual do serviço; quem tira a antiga da rota é
   o Swarm, na hora. Sem isso, o Traefik ainda manda tráfego para a antiga por até 15 s depois de ela sair: 502.
3. **Middleware `retry`** (3 tentativas, 100 ms): a requisição que cai no instante da troca é refeita na nova.
4. **Saída suave no app + `stop_grace_period` maior que ela**: ao receber SIGTERM o processo para de aceitar conexões
   novas, termina as em andamento e sai. Em Node:

```js
const server = app.listen(PORT);
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));             // termina as requisições em andamento
  setTimeout(() => process.exit(0), 30_000).unref(); // e nunca passa do stop_grace_period (45 s)
});
```

E `failure_action: rollback` com `monitor: 60s`: se a nova cair no primeiro minuto, o Swarm volta sozinho à anterior
e o `ci-deploy` falha com a mensagem do rollback.

Medido no projeto de origem: zero respostas 5xx no Traefik durante a troca da produção (941 respostas) e 615/615 numa
sonda batendo a cada segundo. No ensaio destes moldes (um Swarm descartável, sonda a cada 0,2 s do começo ao fim do
`ci-deploy`): troca boa com 410/410 respostas 200; versão quebrada (saúde 500) recusada, volta sozinha e 433/433
respostas 200 da versão anterior. Meça o seu (06, "Sonda de fora").

## Jobs de fundo e crons: nunca dois ao mesmo tempo

Durante o start-first, duas instâncias convivem por segundos. Job que manda webhook, cobra cartão ou sincroniza
pedido rodaria duas vezes. Saída: **lock de líder no Postgres**.

- Cada processo tenta `pg_try_advisory_lock(<chave fixa>)` numa **conexão dedicada** (não a do pool), a cada 5 s.
  Quem pega roda os jobs; o lock é da sessão, então se a conexão cai o Postgres o solta e o dono para os jobs.
- No SIGTERM, o líder para os jobs, espera o que está em andamento e solta o lock; a instância nova assume.
- Na primeira publicação com o lock, a versão antiga roda jobs sem ele: só comece os jobs depois de ~90 s no ar.

Os crons que o PaaS chamava (`vercel.json` → `crons`, Heroku Scheduler) viram um destes, nunca os dois:
- um agendador **dentro do app**, sob o mesmo lock de líder; ou
- `pg_cron` + `pg_net` chamando uma rota com segredo (no Supabase, o padrão), com a rota tolerando chamada repetida.

## Memória

`resources.limits.memory` em cada serviço (acima, o contêiner reinicia) e, em Node, `--max-old-space-size` um pouco
abaixo (o Node coleta lixo antes de o Swarm matar). Meça com `docker stats` em uso real e deixe folga para as duas
instâncias do deploy. Valores por ambiente em `infra/stacks/*.env`.

## Mais de um serviço

`api` + `web`: dois blocos na `stack.yml` (`${API_IMAGE}`, `${WEB_IMAGE}`), `SERVICOS="api web"` no `ci-deploy`. Ele
troca a API, espera ficar saudável, e só então o web: um web novo nunca chama uma API velha que não tem a rota nova.
Um `worker` sem HTTP: sem labels do Traefik, com HEALTHCHECK próprio (ex.: um arquivo tocado a cada ciclo).
