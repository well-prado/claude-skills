#!/usr/bin/env bash
# Tranca no kernel as portas do Dokploy para quem vem de fora, ANTES de instalá-lo. Uso, como root:
#   bash trancar-portas.sh --instalacao   # antes de instalar: 80, 443 e 3000 fechadas para fora
#   bash trancar-portas.sh --painel       # depois do admin e do painel-restrito.yml: só a 3000 continua fechada
#   bash trancar-portas.sh --remover      # tira tudo (não recomendado)
# Por quê: logo depois de instalar, o painel responde na 3000 E na 80 (o Dokploy cria uma rota para o nome
# dokploy.docker.localhost), e o primeiro que chegar cria o admin, que é root no servidor. Porta publicada pelo Docker
# passa por fora do ufw, então o ufw não protege. As regras ficam na cadeia DOCKER-USER (que o Docker consulta antes de
# encaminhar para um contêiner), só para o que entra pelas interfaces de fora e só no sentido de quem abre a conexão
# (--ctdir ORIGINAL: a resposta de uma conexão que um app abre para outro servidor na porta 3000 passa). No próprio
# servidor, e pelo túnel SSH, as portas continuam respondendo. Um serviço do systemd reaplica a cada início do Docker.
set -euo pipefail
UNIDADE=/etc/systemd/system/trancar-portas.service
modo=${1:-}
case "$modo" in
  --instalacao) portas="80 443 3000" ;;
  --painel) portas="3000" ;;
  --remover)
    systemctl disable --now trancar-portas.service 2>/dev/null || true
    /usr/local/sbin/trancar-portas --limpar 2>/dev/null || true
    rm -f "$UNIDADE" /usr/local/sbin/trancar-portas
    systemctl daemon-reload
    echo "portas destrancadas no kernel"; exit 0 ;;
  *) echo "uso: trancar-portas.sh --instalacao | --painel | --remover" >&2; exit 1 ;;
esac
# As interfaces de fora: todas menos loopback e as do Docker. Interface criada depois não entra: rode de novo.
fora=$(ip -o link show | awk -F': ' '{print $2}' | sed 's/@.*//' | grep -vE '^(lo|docker0|docker_gwbridge|br-.*|veth.*)$' | tr '\n' ' ')
[ -n "$fora" ] || { echo "não achei interface de fora (ip -o link show)" >&2; exit 1; }
cat > /usr/local/sbin/trancar-portas <<SCRIPT
#!/bin/sh
# Gerado por trancar-portas.sh $modo: derruba o que chega por [$fora] para as portas [$portas] do Dokploy.
iptables -N DOCKER-USER 2>/dev/null || true
for r in \$(iptables -S DOCKER-USER | grep -- '-m comment --comment trancar-portas' | sed 's/^-A /-D /' | tr ' ' '#'); do
  iptables \$(echo "\$r" | tr '#' ' ')
done
[ "\${1:-}" = --limpar ] && exit 0
for i in $fora; do
  for p in $portas; do
    iptables -I DOCKER-USER -i "\$i" -p tcp -m conntrack --ctorigdstport "\$p" --ctdir ORIGINAL -m comment --comment trancar-portas -j DROP
  done
done
SCRIPT
chmod 755 /usr/local/sbin/trancar-portas
cat > "$UNIDADE" <<UNIT
[Unit]
Description=Tranca as portas do Dokploy para quem vem de fora ($modo)
After=docker.service
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/trancar-portas

[Install]
WantedBy=docker.service multi-user.target
UNIT
systemctl daemon-reload
systemctl enable trancar-portas.service >/dev/null 2>&1
systemctl restart trancar-portas.service
iptables -S DOCKER-USER | grep -c 'trancar-portas' | xargs echo "regras ativas:"
echo "fechadas para quem entra por [$fora]: [$portas]"
