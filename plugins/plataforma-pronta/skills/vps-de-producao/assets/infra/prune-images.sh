#!/usr/bin/env bash
# Limpa no servidor o que cada build deixa para trás, no mesmo disco do Postgres e dos backups:
#  - as tags antigas de $APP-<serviço>, menos as passadas aqui (a recém-construída) e as que algum serviço usa ou
#    usaria num rollback (a configuração atual e a anterior de cada serviço);
#  - as imagens sem tag e o cache de build sem uso há 7 dias.
# Roda no fim do ci-deploy. À mão: ssh root@SERVIDOR 'APP=meuapp SERVICOS="app" bash -s TAG' < infra/prune-images.sh
set -euo pipefail
APP=${APP:?defina APP}
SERVICOS=${SERVICOS:?defina SERVICOS}
keep=$(printf '%s\n' "$@")
# Linha inteira numa lista separada por quebra de linha (um grep -q num pipe pode tropeçar no pipefail).
listed() { case $'\n'"$1"$'\n' in *$'\n'"$2"$'\n'*) return 0 ;; *) return 1 ;; esac; }
services=$(docker service ls -q)
in_use=
if [ -n "$services" ]; then
  # Sem registry, a spec guarda a tag como foi escrita; um digest, se houver, vem depois do @.
  # shellcheck disable=SC2086
  in_use=$(docker service inspect --format '{{.Spec.TaskTemplate.ContainerSpec.Image}} {{with .PreviousSpec}}{{.TaskTemplate.ContainerSpec.Image}}{{end}}' $services \
    | tr ' ' '\n' | sed -e 's/@.*//' -e 's#^docker\.io/library/##')
fi
removed=0
for app in $SERVICOS; do
  for ref in $(docker image ls --format '{{.Repository}}:{{.Tag}}' "$APP-$app"); do
    tag=${ref#*:}
    if [ "$tag" = '<none>' ] || listed "$keep" "$tag" || listed "$in_use" "$ref"; then continue; fi
    # Recusado enquanto uma task parada ainda usa a imagem (o Swarm guarda algumas); uma rodada depois a leva.
    if docker image rm "$ref" >/dev/null 2>&1; then removed=$((removed + 1)); fi
  done
done
docker image prune -f >/dev/null
docker builder prune -f --filter until=168h >/dev/null
echo "limpeza: $removed tag(s) antiga(s) removida(s); $(df -h / | awk 'NR == 2 { print $4 }') livres no disco"
