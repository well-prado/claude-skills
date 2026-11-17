# 07 · Sair de um PaaS e a virada

## Inventário (antes de qualquer servidor)

Leia o projeto inteiro e preencha esta lista **com arquivo:linha**. Cada item vira uma tarefa de alguma fase. Em
projeto grande, divida a leitura por área entre subagentes e junte.

| Peça | Onde procurar | O que vira |
|---|---|---|
| Crons do PaaS | `vercel.json` → `crons`, Heroku Scheduler, Render cron jobs | agendador no app sob lock de líder, ou `pg_cron` (05) |
| Variáveis embutidas no build | `NEXT_PUBLIC_*`, `VITE_*`, `EXPO_PUBLIC_*` | configuração lida ao subir (05) |
| Coisas do provedor no código | `@vercel/analytics`, `@vercel/og`, `x-vercel-*`, `VERCEL_URL`, `VERCEL_ENV`, `geo`/`ip` do request, Image Optimization | substituto ou remoção, um por um |
| Middleware / Edge | `middleware.ts`/`proxy.ts`, `runtime = 'edge'` | roda no Node do contêiner (confira APIs só do Edge) |
| Auth | provedor (Supabase Auth, Clerk, NextAuth), MFA, provedores OAuth, URLs de retorno, templates de e-mail | o mesmo serviço apontado para o domínio novo, ou GoTrue auto-hospedado (04) |
| Arquivos | buckets, URLs **absolutas** salvas no banco, CDN | S3 (do provedor da VPS ou de outro) + `update` das URLs na virada |
| Realtime / filas / KV | Supabase Realtime, Pusher, Upstash, Vercel KV/Queues | serviço em contêiner ou a mesma API externa |
| Banco | extensões (`pg_cron`, `pg_net`, `vector`, `postgis`), RLS, funções `security definer`, Vault | imagem com as extensões; dump/restore (abaixo) |
| E-mail | remetente, SMTP/API, SPF/DKIM/DMARC | provedor (Resend, SES, Postmark) com os registros no DNS (03) |
| Webhooks de entrada | gateways de pagamento, WhatsApp, GitHub | URL nova cadastrada em cada provedor **na virada** (ou mantenha o domínio) |
| Observabilidade | Sentry, logs do PaaS | Sentry continua; logs do Traefik + `docker service logs` |
| Domínios | DNS hoje, TTLs, certificados | tabela da 03 |

## LGPD e quem usa

Trocar de onde os dados ficam é trocar de **suboperador de hospedagem**. Antes da virada: atualize a política de
privacidade e a lista de suboperadores, registre a operação, e avise os clientes com antecedência (o contrato
costuma pedir). O servidor novo vai para outro país? Diga.

## Fases (cada uma termina com prova)

1. **Servidor e base** (02, 03): sem app ainda.
2. **Staging completo no servidor** (04, 05, 06): o staging passa a ser o servidor; a produção segue no PaaS.
   O time usa o staging novo de verdade por alguns dias.
3. **Ensaio da virada** com uma cópia da produção (abaixo), cronometrado.
4. **Virada** numa hora de pouco uso, com o dono presente.
5. **Origem parada, não apagada**, por pelo menos duas semanas. Depois, o dono decide.

## Ensaio (obrigatório, e de novo se algo mudou)

- Dump da produção do PaaS (`pg_dump -Fc` do banco do app; no Supabase, também os esquemas `auth` e `storage`),
  restaurado num Postgres de ensaio no servidor; anote o tempo de dump, cópia e restauração.
- Compare **linha a linha**: contagem por tabela na origem e no destino (um `select count(*)` por tabela gerado do
  catálogo), e uma amostra de texto acentuado (encoding).
- Suba o app de staging contra o banco de ensaio e faça o caminho principal (login, a ação mais importante, um upload,
  um e-mail, um webhook de teste).
- Anote o único erro esperado de cada ferramenta (ex.: `role "postgres" already exists`) para não se assustar no dia.

## A virada (runbook)

Com antecedência de pelo menos o TTL atual (um dia, para garantir): **baixe o TTL** dos registros DNS para 300 s.
Confirme que o backup de fora funciona e que o staging está verde.

1. **Pare a escrita na origem**: modo manutenção ou o app parado no PaaS (escale para zero, pause o projeto, tire o
   domínio). Os crons e webhooks de lá param junto. **A partir daqui, a origem não grava nada.**
2. Dump final da origem; cópia para o servidor; restauração no Postgres da produção (com os papéis da 04 já criados;
   depois do restore, rode de novo o `postgres-app-role.sh` para os objetos voltarem ao papel do app).
3. Confira as contagens linha a linha contra a origem parada. Diferença = pare e entenda antes de seguir.
4. Atualize o que guarda endereço absoluto (URLs de arquivos, URL do app em configurações e no Vault).
5. Publique a produção no servidor (o caminho normal: merge dev→main, ou o deploy manual do `ci-deploy` se a Action
   ainda não está ligada à produção) e confira `/health` com o commit esperado.
6. **Troque o DNS** de `app` (e dos outros nomes) para o servidor. Com Traefik + HTTP-01, o certificado sai em
   segundos depois que o DNS responde; para nenhum erro de SSL na troca, copie antes o `acme.json` antigo (se já havia
   Traefik) ou aceite alguns segundos.
7. Recadastre os webhooks de entrada que mudaram de URL; mande um evento de teste de cada.
8. Caminho principal em produção (como no ensaio). Sonda de fora ligada (06).
9. Origem: **parada, não apagada**. Anote a hora de cada passo e o tempo fora.

**Plano de volta** (decidido antes, não no susto): até o passo 6, volte apenas religando a origem (nada foi gravado no
destino). Depois do passo 6, o destino já gravou dados: voltar exige levar essas linhas para a origem, então só volte
por um problema que impeça o uso, e com um dump do destino em mãos.

## Nunca em dois lugares

Se origem e destino ficam no ar ao mesmo tempo, jobs rodam em dobro (cobrança, webhooks de saída, e-mails), e cada
lado grava num banco diferente: os dados se separam e não se juntam mais. Por isso o passo 1 vem antes de tudo, e o
staging do servidor usa chaves de teste dos provedores, nunca as da produção.
