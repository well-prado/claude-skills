# 02 · Apps que trocam de versão sem queda

## O que o padrão do Dokploy faz, e o que falta

O Dokploy cria cada aplicação como um serviço do Swarm com `start-first` e `rollback` na atualização, e o Traefik
manda para o nome do serviço (o endereço virtual do Swarm). Mas **sem verificação de saúde**: para o Swarm, a versão
nova está pronta assim que o contêiner inicia.

Medido no ensaio, com uma sonda 5 vezes por segundo:

| Caso | Padrão do Dokploy | Com `swarm-settings.json` |
|---|---|---|
| Troca para uma versão boa | 0 erros | 0 erros (135 respostas) |
| Versão que sobe mas não responde | **fica no ar: 502 em todas as respostas** | volta sozinha para a anterior, 0 erros (124 respostas) |
| O que o Dokploy mostra | "done" | **"done"** também |

Ou seja: sem a verificação de saúde, uma versão quebrada derruba o site; com ela, o Swarm volta sozinho, **mas o
Dokploy diz que deu certo**. Por isso as duas peças abaixo.

## 1. Verificação de saúde e troca em cada app

Em cada aplicação: Advanced → Cluster Settings → **Swarm Settings**, com os valores de `assets/swarm-settings.json`
(Health Check, Update Config e Rollback Config). Os tempos são em **nanossegundos**. Troque o `Test` pela rota de
saúde e pela porta do app. A imagem precisa ter o que o teste chama: as Alpine têm `wget` (do busybox), mas as
`-slim` do Debian (inclusive `node:*-slim`) **não têm nem `wget` nem `curl`**; nelas use o próprio binário
(`["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]`).
Um teste que nunca passa faz todo deploy voltar para a versão anterior (e o Dokploy ainda diz "done"). Pela API:

```bash
curl -s -H "x-api-key: $CHAVE" -H 'content-type: application/json' https://painel.../api/application.update \
  -d '{"applicationId":"…","healthCheckSwarm":{…},"updateConfigSwarm":{…},"rollbackConfigSwarm":{…}}'
```

E no app, as mesmas regras da skill `vps-de-producao` (referência 05): rota `/health` rápida que confere o banco,
saída suave no SIGTERM, jobs de fundo sob lock de líder no Postgres (num deploy start-first duas instâncias convivem
por segundos), e configuração lida ao subir, não embutida no build.

**Pronto quando**: com a sonda ligada (abaixo), uma troca de versão e uma versão de propósito quebrada (por exemplo,
`/health` devolvendo 500 numa branch de teste) passam sem nenhum erro, e a quebrada volta sozinha.

## 2. Conferir de fora (o "done" não basta)

`assets/github/workflows/conferir-deploy.yml`: a cada push na `dev` ou na `main`, espera até 20 minutos o `/health`
do ambiente responder com o commit do push, e fica **vermelha** se isso não acontecer. O app precisa devolver o
commit no `/health`. O Dokploy não passa o commit para o build, mas o clone que ele faz deixa a pasta `.git`; um jeito
num Dockerfile (não ensaiado aqui: a própria Action prova no primeiro deploy):

```dockerfile
# no estágio de build, antes de qualquer .dockerignore que tire a .git:
RUN ref=$(sed -n 's/^ref: //p' .git/HEAD); \
    (cat ".git/$ref" 2>/dev/null || cat .git/HEAD) | cut -c1-40 > /app-commit
# no app: o /health lê /app-commit e devolve {"status":"ok","commit":"<conteúdo>"}
```

Se o projeto exclui `.git` no `.dockerignore`, use um passo de CI que constrói a imagem (abaixo) e passe o commit como
build arg.

## Sonda

```bash
URL=https://app.seudominio.com.br/health; ok=0; erro=0
while :; do c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$URL"); \
  [ "$c" = 200 ] && ok=$((ok+1)) || { erro=$((erro+1)); echo "$(date +%T) $c"; }; printf '\r%s ok, %s erro' $ok $erro; sleep 0.2; done
```

## A imagem testada no staging é a que vai para a produção?

Não por padrão: o app de staging (branch `dev`) e o de produção (branch `main`) constroem cada um a sua imagem. Com
build reproduzível (lockfile, imagem base com versão exata) o risco é pequeno, mas não é zero. Para ter a garantia:

1. Uma Action constrói a imagem uma vez e a publica num registry (GHCR) com a tag do commit.
2. Os dois apps no Dokploy usam a fonte **Docker** (imagem do registry) em vez de Git.
3. O staging recebe a tag nova pela API (`application.saveDockerProvider` + `application.deploy`); a produção recebe a
   **mesma tag** depois do merge, só se ela passou pelo staging (a lógica do `deploy-prod.yml` da skill
   `vps-de-producao`).

O mesmo registry habilita o botão **Rollbacks** do Dokploy (ele exige registry para guardar as versões).

## Build no próprio servidor

O build do Dokploy roda no servidor e disputa CPU e memória com a produção. Num servidor pequeno, limite a memória de
cada app (Advanced → Resources) e deixe folga para duas instâncias durante a troca. Build pesado ou vários apps: um
servidor de build separado (Remote Servers → build server), que exige registry.
