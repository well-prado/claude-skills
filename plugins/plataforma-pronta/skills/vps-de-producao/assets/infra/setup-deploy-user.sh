#!/usr/bin/env bash
# Prepara no servidor o usuário das Actions de deploy. Roda do seu computador, na raiz do repositório, com a pasta
# infra/ COMMITADA (os arquivos vão como estão no HEAD: uma cópia meio editada nunca chega ao servidor).
#
# Uma vez (e de novo para trocar as chaves):
#   infra/setup-deploy-user.sh root@SERVIDOR CHAVE_DEV.pub CHAVE_PROD.pub
# Um par por ambiente; a privada de cada um vai no secret DEPLOY_SSH_KEY do Environment dele no GitHub:
#   ssh-keygen -t ed25519 -N '' -C deploy-staging -f ~/.ssh/meuapp-deploy-dev
#   ssh-keygen -t ed25519 -N '' -C deploy-producao -f ~/.ssh/meuapp-deploy-prod
# Cada chave fica presa ao próprio ambiente no command=: a do staging não publica na produção.
#
# A infra confiável (de novo a cada mudança em ci-deploy.sh, stack.yml, stacks/*.env, smoke.sh ou prune-images.sh,
# depois de revisá-la, num checkout do commit que vai publicar; o ci-deploy recusa um commit cuja infra difere):
#   infra/setup-deploy-user.sh root@SERVIDOR --infra
#
# Os segredos de cada ambiente (DATABASE_URL, chaves de API...), pela entrada, nunca pela linha de comando.
# Um NOME=valor por linha, sem aspas e sem "export"; o valor vai ao app exatamente como está escrito:
#   infra/setup-deploy-user.sh root@SERVIDOR --segredos prod < ~/.config/meuapp/prod.env
#   infra/setup-deploy-user.sh root@SERVIDOR --segredos dev  < ~/.config/meuapp/dev.env
#
# No servidor:
#  - usuário deploy, sem senha (entra só por chave), no grupo docker;
#  - /opt/deploy/ci-deploy e /opt/deploy/infra (do root, só leitura para o deploy) e /opt/deploy/var (trabalho, logs,
#    lock, do deploy);
#  - authorized_keys do deploy com as duas chaves presas ao ci-deploy, cada uma com o seu ambiente: command=, sem
#    shell, túnel, agente nem pty;
#  - /opt/deploy/segredos/<ambiente>.env, legível só pelo deploy.
# SSH_OPTS (opcional): ex. "-o IdentitiesOnly=yes -i ~/.ssh/id_ed25519".
set -euo pipefail
INFRA_ARQUIVOS="stack.yml stacks/dev.env stacks/prod.env prune-images.sh smoke.sh"

instalar_infra() { # roda no servidor, na pasta com os arquivos
  install -d -o root -g root -m 755 /opt/deploy /opt/deploy/infra /opt/deploy/infra/stacks
  install -o root -g root -m 755 ci-deploy.sh /opt/deploy/ci-deploy
  for f in $INFRA_ARQUIVOS; do
    if [ -f "infra/$f" ]; then install -o root -g root -m 644 "infra/$f" "/opt/deploy/infra/$f"; else rm -f "/opt/deploy/infra/$f"; fi
  done
  echo "infra confiável instalada em /opt/deploy/infra: $(cd /opt/deploy/infra && find . -type f | sort | tr '\n' ' ')"
}

if [ "${1:-}" = --on-server ]; then
  instalar_infra
  if [ "${2:-}" != --so-infra ]; then
    id deploy > /dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
    usermod -aG docker deploy
    passwd -l deploy > /dev/null
    install -d -o deploy -g deploy -m 700 /opt/deploy/var /opt/deploy/segredos ~deploy/.ssh
    for e in dev prod; do
      printf 'command="/opt/deploy/ci-deploy %s",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty %s\n' "$e" "$(cat "key-$e.pub")"
    done > ~deploy/.ssh/authorized_keys
    chown deploy:deploy ~deploy/.ssh/authorized_keys
    chmod 600 ~deploy/.ssh/authorized_keys
    echo "usuário deploy pronto: $(id deploy)"
  fi
  exit 0
fi

HOST=${1:?"uso: infra/setup-deploy-user.sh root@SERVIDOR CHAVE_DEV.pub CHAVE_PROD.pub | --infra | --segredos <dev|prod> < ARQUIVO"}
# shellcheck disable=SC2206 # SSH_OPTS é uma lista de opções, dividida de propósito
SSH=(ssh ${SSH_OPTS:-})

if [ "${2:-}" = --segredos ]; then
  env=${3:-}
  [[ $env =~ ^(dev|prod)$ ]] || { echo "ambiente: dev ou prod" >&2; exit 1; }
  [ ! -t 0 ] || { echo "mande o arquivo pela entrada: ... --segredos $env < ARQUIVO" >&2; exit 1; }
  "${SSH[@]}" "$HOST" "install -d -o deploy -g deploy -m 700 /opt/deploy/segredos \
    && umask 077 && cat > /opt/deploy/segredos/$env.env.novo \
    && chown deploy:deploy /opt/deploy/segredos/$env.env.novo \
    && mv /opt/deploy/segredos/$env.env.novo /opt/deploy/segredos/$env.env"
  echo "segredos de $env gravados em /opt/deploy/segredos/$env.env (valem no próximo deploy)"
  exit 0
fi

modo=--so-infra
if [ "${2:-}" != --infra ]; then
  PUB_DEV=${2:?"uso: infra/setup-deploy-user.sh root@SERVIDOR CHAVE_DEV.pub CHAVE_PROD.pub | --infra"}
  PUB_PROD=${3:?"uso: infra/setup-deploy-user.sh root@SERVIDOR CHAVE_DEV.pub CHAVE_PROD.pub | --infra"}
  for p in "$PUB_DEV" "$PUB_PROD"; do
    grep -qE '^ssh-ed25519 [A-Za-z0-9+/=]+( [^ ]+)?$' "$p" || { echo "$p não é uma chave pública ed25519" >&2; exit 1; }
  done
  [ "$(cut -d' ' -f2 "$PUB_DEV")" != "$(cut -d' ' -f2 "$PUB_PROD")" ] || { echo "use um par de chaves diferente para cada ambiente" >&2; exit 1; }
  modo=
fi
cd "$(git rev-parse --show-toplevel)"
git cat-file -e HEAD:infra/ci-deploy.sh 2>/dev/null || { echo "infra/ci-deploy.sh não está no HEAD: commite a pasta infra/ antes" >&2; exit 1; }
dir=/root/deploy-setup
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/infra/stacks"
git show HEAD:infra/ci-deploy.sh > "$tmp/ci-deploy.sh"
git show HEAD:infra/setup-deploy-user.sh > "$tmp/setup-deploy-user.sh"
for f in $INFRA_ARQUIVOS; do
  if git cat-file -e "HEAD:infra/$f" 2>/dev/null; then git show "HEAD:infra/$f" > "$tmp/infra/$f"; fi
done
[ -n "$modo" ] || { cp "$PUB_DEV" "$tmp/key-dev.pub"; cp "$PUB_PROD" "$tmp/key-prod.pub"; }
COPYFILE_DISABLE=1 tar -cf - -C "$tmp" . \
  | "${SSH[@]}" "$HOST" "rm -rf $dir && install -d -m 700 $dir && tar -xf - -C $dir --no-same-owner"
"${SSH[@]}" "$HOST" "cd $dir && bash setup-deploy-user.sh --on-server $modo; status=\$?; rm -rf $dir; exit \$status"
