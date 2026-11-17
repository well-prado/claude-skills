# 06 · O caminho do código: dev → staging, main → produção

## O fluxo

```
branch de trabalho ──PR──► dev ──(push)──► Action deploy-staging ──► stack meuapp-dev  (dev.seudominio)
                                 │
                                 └──PR dev→main──► main ──(merge)──► Action deploy-prod ──► stack meuapp (app.seudominio)
                                                                    (mesma imagem do staging, sem build)
```

- Todo trabalho sai da `dev` e volta para ela por PR. A `main` só recebe o PR `dev → main`.
- Push na `dev` publica o staging. Merge na `main` publica a produção. **Mesclar na main é a decisão de publicar.**
- O `deploy-prod.yml` é a trava: não publica um commit que não seja merge da dev, cujo código difira do da dev, ou
  cujo commit da dev não tenha passado pelo staging com sucesso. Também exige versão nova no `package.json` e cria a
  tag `vX.Y.Z` no fim.
- Urgência: *Run workflow* com `hotfix` publica o commit da main como está; depois, merge da main na dev.

## Preparar uma vez

**1. Um par de chaves por ambiente** (no computador da pessoa ou no seu, nunca no servidor). Cada chave fica presa ao
seu ambiente no servidor: a do staging não publica na produção, mesmo que alguém edite o workflow da `dev` para pedir.

```bash
ssh-keygen -t ed25519 -N '' -C deploy-staging  -f ~/.ssh/meuapp-deploy-dev
ssh-keygen -t ed25519 -N '' -C deploy-producao -f ~/.ssh/meuapp-deploy-prod
```

**2. O usuário `deploy` no servidor**, com a chave presa ao `ci-deploy` e a infra confiável instalada. Os arquivos vão
como estão no **HEAD**, então commite a pasta `infra/` antes:

```bash
SSH_OPTS="-o IdentitiesOnly=yes -i ~/.ssh/id_ed25519" infra/setup-deploy-user.sh root@SERVIDOR ~/.ssh/meuapp-deploy-dev.pub ~/.ssh/meuapp-deploy-prod.pub
```

Prove que a chave só faz o deploy (cada um destes tem de ser **recusado**):

```bash
ssh -o IdentitiesOnly=yes -i ~/.ssh/meuapp-deploy-dev deploy@SERVIDOR id
ssh -o IdentitiesOnly=yes -i ~/.ssh/meuapp-deploy-dev deploy@SERVIDOR "deploy prod 1234567"   # chave do staging pedindo produção
ssh -o IdentitiesOnly=yes -i ~/.ssh/meuapp-deploy-prod -t deploy@SERVIDOR    # sem shell: cai no ci-deploy e sai com "uso:"
```

Os três são recusados (`uso: …`, `esta chave só publica em dev`); nenhum roda o comando pedido. Túnel (`-L`) abre a
conexão, mas cada canal é recusado (`administratively prohibited`), pelo `no-port-forwarding` da chave.

**3. Os segredos de cada ambiente** num arquivo local (600, fora do repositório), mandados pela entrada. Um
`NOME=valor` por linha, **sem aspas e sem `export`**: o `ci-deploy` lê linha a linha sem passar pelo shell, então um
`$`, `&` ou espaço no valor chega ao app exatamente como foi escrito.

```bash
# ~/.config/meuapp/prod.env  →  DATABASE_URL=..., chaves de API, etc. (um NOME=valor por linha)
infra/setup-deploy-user.sh root@SERVIDOR --segredos prod < ~/.config/meuapp/prod.env
infra/setup-deploy-user.sh root@SERVIDOR --segredos dev  < ~/.config/meuapp/dev.env
```

Liste no repositório (README da infra ou `docs/SEGREDOS.md`) **só os nomes** de cada segredo e de onde ele vem.
Staging e produção usam chaves **diferentes** sempre que o provedor deixa (pares VAPID, webhooks, chaves de teste do
gateway de pagamento no staging).

**4. O GitHub**: dois Environments, `staging` (liberado só para a branch `dev`) e `production` (só para a `main`), em
*Settings → Environments → Deployment branches*, e os secrets **dentro deles**. Secret do repositório inteiro é lido
por qualquer workflow que qualquer pessoa com escrita suba em qualquer branch. (Environments com regra de branch
exigem repositório público ou um plano pago do GitHub em repositório privado; sem eles, dê escrita só a quem você
confiaria a chave.) Com o `gh` logado na conta que administra o repo:

```bash
ssh-keyscan -t ed25519 SERVIDOR 2>/dev/null > /tmp/kh && ssh-keygen -lf /tmp/kh   # CONFIRA com a impressão anotada em 02
gh secret set DEPLOY_SSH_KEY --env staging    < ~/.ssh/meuapp-deploy-dev
gh secret set DEPLOY_SSH_KEY --env production < ~/.ssh/meuapp-deploy-prod
for e in staging production; do
  gh secret set DEPLOY_KNOWN_HOSTS --env $e < /tmp/kh
  gh variable set DEPLOY_HOST --env $e --body SERVIDOR
done
rm /tmp/kh
gh variable set STAGING_URL --env staging --body https://dev.seudominio.com.br
gh variable set PROD_URL --env production --body https://app.seudominio.com.br
```

**5. Os workflows** em `.github/workflows/` e o `pre-push` em `.githooks/` (`git config core.hooksPath .githooks`,
ou no `prepare` do `package.json`), com um script `pre-push` no `package.json` que roda as checagens do projeto e o
`node --test infra/infra.test.mjs`.

## O que o `ci-deploy` faz (no servidor, a cada deploy)

1. Aceita só `deploy <ambiente da chave> <commit> [<commit da imagem>]`; recusa o resto, inclusive outro ambiente.
   Um deploy por vez (`flock`).
2. Recebe o `git archive` do commit pela entrada (no máximo 300 MB) e extrai numa pasta temporária. **Do pacote, só
   o contexto do build é usado**; nada dele roda no servidor.
3. Compara `infra/stack.yml`, `infra/stacks/<ambiente>.env`, `smoke.sh` e `prune-images.sh` do commit com as cópias
   que o root instalou em `/opt/deploy/infra`. Diferente: **para**, e pede a um admin que revise e rode
   `infra/setup-deploy-user.sh root@SERVIDOR --infra` num checkout desse commit (a `dev`, para o staging), e refaça o
   deploy. Mudar a infra é decisão de quem tem o root, não de quem tem push. A cópia instalada vale para os dois
   ambientes: depois de instalar pela `dev`, a produção recusa deploy até a `main` receber a mesma infra, então leve a
   mudança à `main` logo em seguida.
4. Na produção, se a imagem do commit da dev ainda está no servidor **e foi construída do mesmo código** (rótulo
   `deploy.conteudo` com a impressão dos arquivos recebidos), **só põe a tag nova nela**; senão constrói.
5. Opcional: `smoke.sh <tag>` roda a imagem nova antes de trocar (ex.: confere uma dependência nativa). Falhou, nada
   muda no ar.
6. Para cada serviço de `SERVICOS`, na ordem: `docker stack deploy` com os valores de `stacks/<ambiente>.env` e os
   segredos de `/opt/deploy/segredos/<ambiente>.env` (os dois lidos linha a linha, sem shell), a imagem nova desse
   serviço e a atual dos seguintes; e espera o serviço rodar a imagem nova com todas as réplicas de pé. Se o Swarm fez
   rollback, falha dizendo isso.
7. Limpa as imagens antigas, menos as que um serviço usa ou usaria num rollback.

O primeiro deploy cria a stack sozinho (`docker stack deploy` cria o que não existe). Os logs ficam em
`/opt/deploy/var/logs/`.

## Construir no servidor ou num registry?

O molde constrói **no servidor**, sem registry: zero custo, zero credencial de registry, e a imagem do staging já está
lá para a produção. O preço: o build usa a CPU do servidor por alguns minutos (em 6 vCPU, imperceptível para quem
usa). Se o build for pesado ou houver mais de um servidor, construa no Actions e publique no GHCR (imagem
`ghcr.io/dono/meuapp-app:<commit>`), com `docker login` do usuário `deploy` usando um token só de leitura de pacotes;
o resto do fluxo (tags por commit, a imagem do staging promovida, a espera) não muda.

## Sonda de fora (prova do "sem queda")

Num terminal, durante um deploy de verdade na produção (ou no staging):

```bash
URL=https://dev.seudominio.com.br/health; ok=0; erro=0
while :; do c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$URL"); \
  [ "$c" = 200 ] && ok=$((ok+1)) || { erro=$((erro+1)); echo "$(date +%T) $c"; }; printf '\r%s ok, %s erro' $ok $erro; sleep 1; done
```

E depois, no servidor, as respostas 5xx no log do Traefik durante a janela:

```bash
$SSH root@SERVIDOR "docker service logs --since 15m traefik_traefik 2>&1 | grep -c '\"DownstreamStatus\":5'"
```

**Pronto quando** a sonda não registrou erro e o Traefik mostra 0 respostas 5xx na janela do deploy.

## No dia a dia

- PR para a `dev` com CI (ou o `pre-push`) verde; merge; o staging publica sozinho; QA no staging.
- PR `dev → main` quando o staging está bom; o merge publica a produção (alguém decide, nunca o auto-merge).
- A Action de produção confere `/health` com o commit e a versão novos. Vermelha = **não está no ar**: veja o log do
  `ci-deploy` no próprio job e `docker service ps meuapp_app` no servidor.
- Voltar uma versão: reverta o commit na dev e publique (o caminho normal), ou, numa emergência, no servidor,
  `docker service rollback meuapp_app` (volta para a especificação anterior).
