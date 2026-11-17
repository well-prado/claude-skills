#!/usr/bin/env bash
# O deploy no servidor, chamado pelas Actions (.github/workflows/deploy-staging.yml e deploy-prod.yml). É o ÚNICO
# comando que as chaves SSH do GitHub rodam aqui: o "command=" delas no authorized_keys do usuário deploy
# (infra/setup-deploy-user.sh). Uma chave por ambiente, com o ambiente FIXO no command= ("/opt/deploy/ci-deploy dev" ou
# "... prod"): a chave do staging não publica na produção, mesmo que o workflow peça. O runner só manda o código; o build, a troca da stack e a espera são daqui, e os
# segredos ficam neste servidor (/opt/deploy/segredos/<ambiente>.env), nunca no GitHub.
#
#   git archive --format=tar.gz <commit> | ssh deploy@SERVIDOR "deploy <dev|prod> <tag> [<tag da imagem>]"
#
# <tag>: o commit curto, que vira a tag das imagens. <tag da imagem>, na produção: o commit da dev que o merge trouxe,
# já construído e testado no staging. Se essa imagem ainda está aqui, ela ganha a tag nova sem novo build: vai para a
# produção exatamente o que foi testado. Sem ela, constrói.
#
# Do pacote recebido, só o CONTEXTO DO BUILD é usado (o Dockerfile constrói dentro de um contêiner). Nada dele roda
# aqui: a stack.yml, os valores por ambiente, o smoke.sh e o prune-images.sh são as cópias que o root instalou em
# /opt/deploy/infra (setup-deploy-user.sh --infra). Se o commit traz uma infra diferente da instalada, o deploy para e
# pede a um admin que a instale: quem só tem push (ou só a chave do deploy) publica código, mas não muda a infra nem
# lê os segredos da produção por ela.
#
# Troca os serviços na ordem de SERVICOS (ex.: a API antes do web), esperando cada um ficar saudável; se um não fica,
# o Swarm volta sozinho para a versão anterior e o deploy falha. Um deploy por vez no servidor (flock).
set -euo pipefail
umask 077

# ── Ajuste ao projeto ────────────────────────────────────────────────────────────────────────────────────────────────
APP=meuapp            # prefixo das imagens (meuapp-<serviço>:<tag>); stacks "meuapp" (produção) e "meuapp-dev" (staging)
SERVICOS="app"        # serviços da infra/stack.yml com imagem própria, na ordem da troca (ex.: "api web")
ESPERA=420            # segundos que cada serviço tem para ficar saudável
# Imagem de cada serviço: docker/<serviço>/Dockerfile, ou o Dockerfile da raiz quando só há um serviço.
# Na stack.yml, a imagem do serviço "api" é ${API_IMAGE}; a do "app", ${APP_IMAGE}; e assim por diante.
# ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
INFRA=${CI_DEPLOY_INFRA:-/opt/deploy/infra}

fail() { echo "ci-deploy: $*" >&2; exit 1; }
chave_env=${1:-}
[[ $chave_env =~ ^(dev|prod)$ ]] || fail 'a chave não tem ambiente fixo (command="/opt/deploy/ci-deploy dev|prod")'
read -r action env tag image_tag extra <<< "${SSH_ORIGINAL_COMMAND:-}"
[ "${action:-}" = deploy ] && [ -z "${extra:-}" ] || fail 'uso: deploy <dev|prod> <tag> [<tag da imagem>]'
[ "${env:-}" = "$chave_env" ] || fail "esta chave só publica em $chave_env (pedido: ${env:-})"
case "${env:-}" in
  dev) stack=$APP-dev ;;
  prod) stack=$APP ;;
  *) fail "ambiente desconhecido: ${env:-} (dev ou prod)" ;;
esac
tag_re='^[0-9a-f]{7,40}$'
[[ ${tag:-} =~ $tag_re ]] || fail "tag inválida: ${tag:-}"
image_tag=${image_tag:-$tag}
[[ $image_tag =~ $tag_re ]] || fail "tag da imagem inválida: $image_tag"
segredos=/opt/deploy/segredos/$env.env
[ -r "$segredos" ] || fail "faltam os segredos do ambiente em $segredos (infra/setup-deploy-user.sh --segredos $env)"
[ -r "$INFRA/stack.yml" ] && [ -r "$INFRA/stacks/$env.env" ] || fail "falta a infra instalada em $INFRA (infra/setup-deploy-user.sh --infra)"

base=${CI_DEPLOY_DIR:-/opt/deploy/var}
mkdir -p "$base/logs"
exec 9> "$base/lock"
flock -w 1200 9 || fail 'outro deploy não terminou em 20 min'
work=$(mktemp -d "$base/work.XXXXXX")
trap 'rm -rf "$work"' EXIT

# O código, da entrada (no máximo 300 MB): só o contexto do build.
head -c 314572800 > "$work/ctx.tar.gz"
mkdir "$work/src"
tar -xzf "$work/ctx.tar.gz" -C "$work/src" --no-same-owner
src=$work/src

# A infra do commit tem de ser a instalada. Diferente = um admin revisa e instala; o deploy não segue com nenhuma das duas.
for f in stack.yml "stacks/$env.env" prune-images.sh smoke.sh; do
  if [ -e "$src/infra/$f" ] || [ -e "$INFRA/$f" ]; then
    cmp -s "$src/infra/$f" "$INFRA/$f" \
      || fail "infra/$f deste commit difere da instalada no servidor: um admin revisa a mudança, roda infra/setup-deploy-user.sh root@SERVIDOR --infra num checkout deste commit, e o deploy é refeito"
  fi
done

version=$(python3 -I -c 'import json, sys; print(json.load(open(sys.argv[1])).get("version", ""))' "$src/package.json" 2>/dev/null || true)
[[ $version =~ ^[0-9A-Za-z.+-]{1,40}$ ]] || version=$tag
echo "ci-deploy: $env ($stack), imagens $tag, versão $version"

# Impressão do código recebido (os arquivos e o conteúdo, não o commit): o merge dev→main tem a mesma árvore da dev,
# então a mesma impressão. Vai num rótulo da imagem; uma imagem só é reaproveitada se o rótulo bate. Assim ninguém
# promove para a produção uma imagem que alguém pôs aqui com a tag de um commit, mas construída de outro código.
conteudo=$(cd "$src" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -c1-64)
imagem() { echo "$APP-$1:$2"; }
has() {
  [ "$(docker image inspect -f '{{index .Config.Labels "deploy.conteudo"}}' "$(imagem "$1" "$2")" 2>/dev/null)" = "$conteudo" ]
}
todas() { local s; for s in $SERVICOS; do has "$s" "$1" || return 1; done; }
dockerfile() { if [ -f "$src/docker/$1/Dockerfile" ]; then echo "docker/$1/Dockerfile"; else echo Dockerfile; fi; }

if [ "$image_tag" != "$tag" ] && todas "$image_tag"; then
  echo "ci-deploy: a imagem testada no staging ($image_tag) vai para a produção como $tag, sem novo build"
  for s in $SERVICOS; do docker tag "$(imagem "$s" "$image_tag")" "$(imagem "$s" "$tag")"; done
elif todas "$tag"; then
  echo "ci-deploy: as imagens $tag já existem aqui, do mesmo código"
else
  for s in $SERVICOS; do
    f=$(dockerfile "$s")
    [ -f "$src/$f" ] || fail "sem Dockerfile para $s (docker/$s/Dockerfile ou Dockerfile)"
    echo "ci-deploy: build de $(imagem "$s" "$tag") ($f)"
    docker build --progress=plain --build-arg "GIT_COMMIT=$tag" --label "deploy.conteudo=$conteudo" -t "$(imagem "$s" "$tag")" -f "$f" - < "$work/ctx.tar.gz" \
      > "$base/logs/build-$s-$tag.log" 2>&1 \
      || { tail -n 40 "$base/logs/build-$s-$tag.log" >&2; fail "build de $s falhou (log: $base/logs/build-$s-$tag.log)"; }
  done
fi

# Prova da imagem antes de trocar (opcional): smoke.sh <tag> roda a imagem nova e sai com erro se ela não serve (ex.:
# uma dependência nativa que faltou no build). Falhou aqui, nada muda no ar.
if [ -f "$INFRA/smoke.sh" ]; then
  APP="$APP" SERVICOS="$SERVICOS" bash "$INFRA/smoke.sh" "$tag" || fail "o smoke.sh reprovou as imagens $tag"
fi

# Lê NOME=valor linha a linha, sem passar pelo shell: um "$", "&" ou espaço no valor chega ao app como foi escrito,
# e nada no arquivo é executado. Linhas vazias e começadas por # são ignoradas; valores sem aspas.
carregar() {
  local linha n=0
  while IFS= read -r linha || [ -n "$linha" ]; do
    n=$((n + 1))
    linha=${linha%$'\r'}
    case "$linha" in '' | '#'*) continue ;; esac
    [[ $linha =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] || fail "$1:$n não é NOME=valor"
    export "${linha?}"
  done < "$1"
}
var_imagem() { echo "$(echo "$1" | tr '[:lower:]-' '[:upper:]_')_IMAGE"; }
atual() { docker service inspect -f '{{.Spec.TaskTemplate.ContainerSpec.Image}}' "${stack}_$1" 2>/dev/null | sed 's/@.*//'; }

# Espera o serviço rodar a imagem pedida, com todas as réplicas de pé; falha se o Swarm voltou à anterior.
esperar() {
  local svc="${stack}_$1" quer=$2 t=0 spec estado desejadas rodando
  while :; do
    spec=$(atual "$1")
    estado=$(docker service inspect -f '{{if .UpdateStatus}}{{.UpdateStatus.State}}{{end}}' "$svc")
    case "$estado" in rollback_*) fail "$svc voltou para a versão anterior ($estado): a nova não ficou saudável" ;; esac
    if [ "$spec" = "$quer" ] && { [ -z "$estado" ] || [ "$estado" = completed ]; }; then
      desejadas=$(docker service inspect -f '{{if .Spec.Mode.Replicated}}{{.Spec.Mode.Replicated.Replicas}}{{else}}1{{end}}' "$svc")
      rodando=$(docker service ps -f desired-state=running --format '{{.CurrentState}}' "$svc" | grep -c '^Running' || true)
      [ "$rodando" -ge "$desejadas" ] && { echo "ci-deploy: $svc no ar com $quer"; return 0; }
    fi
    t=$((t + 5))
    [ "$t" -lt "$ESPERA" ] || fail "$svc não ficou saudável em ${ESPERA}s (docker service ps $svc)"
    sleep 5
  done
}

# Troca um serviço por vez: no passo N, os N primeiros de SERVICOS com a imagem nova e os outros com a que já está no
# ar (ou a nova, no primeiro deploy). No passo 1 os outros serviços também reiniciam (a versão e o commit mudaram),
# com a imagem antiga e sem queda (start-first). A stack.yml é o molde: ${NOME} é preenchido pelo docker stack deploy.
trocados=""
for s in $SERVICOS; do
  trocados="$trocados $s"
  (
    carregar "$INFRA/stacks/$env.env"
    carregar "$segredos"
    for o in $SERVICOS; do
      case " $trocados " in
        *" $o "*) img=$(imagem "$o" "$tag") ;;
        *) img=$(atual "$o"); img=${img:-$(imagem "$o" "$tag")} ;;
      esac
      export "$(var_imagem "$o")=$img"
    done
    export APP_VERSAO="$version" APP_COMMIT="$tag"
    echo "ci-deploy: trocando $s"
    docker stack deploy --detach=false --with-registry-auth -c "$INFRA/stack.yml" "$stack" > "$base/logs/deploy-$s-$tag.log" 2>&1 \
      || { tail -n 30 "$base/logs/deploy-$s-$tag.log" >&2; exit 1; }
  ) || fail "o docker stack deploy de $s falhou (log: $base/logs/deploy-$s-$tag.log)"
  esperar "$s" "$(imagem "$s" "$tag")"
done

APP="$APP" SERVICOS="$SERVICOS" bash "$INFRA/prune-images.sh" "$tag" || echo 'ci-deploy: aviso: a limpeza das imagens antigas falhou' >&2
echo "ci-deploy: $stack no ar com $tag (versão $version)"
