#!/usr/bin/env bash
# Prepara um Ubuntu 24.04 zerado para receber as stacks do projeto:
#   Docker oficial + Swarm (1 nó) + redes "traefik-public", "painel" e "banco", firewall (ufw), fail2ban, SSH endurecido,
#   atualizações automáticas de segurança, ajustes de rede do kernel, swap, fuso e o cron do backup do Postgres.
# Pode rodar de novo sem estragar nada. Uso, como root, no servidor:
#   IPS_CONFIAVEIS="SEU_IP" bash /opt/infra/setup-server.sh
# Variáveis (opcionais):
#   IPS_CONFIAVEIS  IPs que o fail2ban nunca bloqueia, separados por espaço. Ponha o IP de casa: sem ele, um erro de
#                   chave tranca você fora por 1 h (aconteceu no projeto que deu origem a este arquivo).
#   FUSO            fuso do servidor (padrão America/Sao_Paulo). Os crons e os logs seguem este fuso.
#   SWAP_GB         tamanho do swap (padrão 4).
#   SWARM           "nao" pula o Swarm e as redes (para quem vai instalar um painel que cria o próprio Swarm, como o
#                   Dokploy, cujo instalador apaga qualquer Swarm existente). Padrão: sim.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
FUSO=${FUSO:-America/Sao_Paulo}
SWARM=${SWARM:-sim}
case "$SWARM" in sim | nao) ;; *) echo "SWARM tem de ser sim ou nao (veio: $SWARM)" >&2; exit 1 ;; esac
SWAP_GB=${SWAP_GB:-4}
log() { printf '\n== %s\n' "$*"; }

log "Atualizando o sistema"
apt-get update -q
apt-get -y -q -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold full-upgrade
apt-get install -y -q ca-certificates curl gnupg ufw fail2ban python3-systemd unattended-upgrades

log "Docker (repositório oficial)"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
if [ ! -f /etc/docker/daemon.json ]; then
  mkdir -p /etc/docker
  # Logs dos contêineres com rotação (sem isso eles crescem até encher o disco) e no-new-privileges em todo contêiner
  # (o docker stack deploy ignora security_opt, então o padrão do daemon é o único jeito de aplicar aos serviços).
  printf '{\n  "log-driver": "json-file",\n  "log-opts": { "max-size": "10m", "max-file": "3" },\n  "no-new-privileges": true\n}\n' > /etc/docker/daemon.json
  systemctl restart docker
fi
systemctl enable --now docker

log "Firewall: só SSH, HTTP e HTTPS"
# Liga antes do Swarm: na primeira rodada, as portas dele (2377, 7946, 4789) não ficam abertas nem por segundos.
# As portas do Swarm e a do Postgres ficam fechadas: é um nó só, e o banco não sai do servidor.
# ATENÇÃO: porta que um contêiner publica passa por fora do ufw (o Docker escreve no iptables antes dele).
# Por isso só o Traefik publica porta, e o teste infra.test.mjs reprova qualquer outra stack com "ports:".
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment ssh
ufw allow 80/tcp comment http
ufw allow 443/tcp comment https
ufw --force enable

if [ "$SWARM" = sim ]; then
  log "Swarm e redes"
  if [ "$(docker info -f '{{.Swarm.LocalNodeState}}')" != active ]; then
    ADDR=$(ip -4 route get 1.1.1.1 | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')
    docker swarm init --advertise-addr "$ADDR"
  fi
  # traefik-public: onde o Traefik encontra os apps. Attachable para um "docker run" de diagnóstico poder entrar.
  docker network inspect traefik-public >/dev/null 2>&1 || docker network create --driver overlay --attachable traefik-public
  # painel: só o Traefik e o Portainer. Sem attachable: nenhum contêiner avulso nem do app chega ao painel por dentro.
  docker network inspect painel >/dev/null 2>&1 || docker network create --driver overlay painel
  # banco: só o Postgres e os apps que usam o banco. Fora da traefik-public: o Traefik nunca enxerga o Postgres.
  docker network inspect banco >/dev/null 2>&1 || docker network create --driver overlay banco
fi

log "SSH"
cat > /etc/ssh/sshd_config.d/00-servidor.conf <<'EOF'
# Gerado por infra/setup-server.sh
MaxAuthTries 3
LoginGraceTime 30
PermitEmptyPasswords no
KbdInteractiveAuthentication no
X11Forwarding no
ClientAliveInterval 300
ClientAliveCountMax 2
EOF
# Senha desligada só quando o root já tem chave: desligar antes deixaria todo mundo fora (sobra o console VNC do
# provedor). No sshd vale o primeiro valor lido, e o 01- vem antes do 50-cloud-init.conf da imagem.
# Chave útil: o ssh-keygen lê o arquivo como o sshd (linhas com opções e chaves sk- inclusive), e pelo menos uma linha
# NÃO tem command=. Imagens com usuário "ubuntu" (OVH, AWS...) põem no root uma chave com
# command="echo 'Please login as the user ubuntu'; exit 142", que o ssh-keygen aceita mas não deixa ninguém entrar.
chave_root_util() {
  [ -s /root/.ssh/authorized_keys ] && ssh-keygen -lf /root/.ssh/authorized_keys >/dev/null 2>&1 \
    && grep -vE '^[[:space:]]*(#|$)' /root/.ssh/authorized_keys | grep -qv 'command='
}
if chave_root_util; then
  printf '# Gerado por infra/setup-server.sh: só chave\nPermitRootLogin prohibit-password\nPasswordAuthentication no\n' \
    > /etc/ssh/sshd_config.d/01-so-chave.conf
else
  rm -f /etc/ssh/sshd_config.d/01-so-chave.conf
  echo "AVISO: não achei chave válida em /root/.ssh/authorized_keys; a senha do root continua valendo no SSH. Ponha a chave e rode de novo."
fi
# No Ubuntu 24.04 com ssh.socket, /run/sshd só existe depois da primeira conexão; o sshd -t falha sem ele.
install -d -m 755 /run/sshd
sshd -t
systemctl restart ssh
# Confere o que o sshd de fato aplicou, não o que o arquivo diz. A saída vai para uma variável antes do grep: um
# "sshd -T | grep -q" com pipefail falha quando o grep sai cedo e o sshd toma SIGPIPE (aviso falso de senha ligada).
SSHD_EFETIVO=$(sshd -T 2>/dev/null || true)
if grep -qx 'passwordauthentication no' <<< "$SSHD_EFETIVO"; then
  echo "SSH: só por chave (a senha do root segue valendo no console VNC do provedor)."
else
  echo "SSH: a senha ainda vale no SSH."
  SENHA_NO_SSH=1
fi

log "fail2ban"
# 5 erros em 10 min = 1 h bloqueado; cada reincidência dobra o tempo (até 4 semanas).
# Quem for bloqueado 3 vezes em 1 dia fica 1 semana fora (recidive).
# Chave errada conta como erro: conecte sempre com -o IdentitiesOnly=yes -i <a chave>, e nunca teste login em laço.
cat > /etc/fail2ban/jail.local <<'EOF'
# Gerado por infra/setup-server.sh
[DEFAULT]
banaction = ufw
banaction_allports = ufw
findtime = 10m
maxretry = 5
bantime = 1h
bantime.increment = true
bantime.maxtime = 4w

[sshd]
enabled = true
backend = systemd
mode = aggressive

[recidive]
enabled = true
# O Ubuntu põe "backend = systemd" em jail.d/defaults-debian.conf; o recidive lê o arquivo de log do próprio fail2ban.
backend = auto
logpath = /var/log/fail2ban.log
findtime = 1d
maxretry = 3
bantime = 1w
EOF
if [ -n "${IPS_CONFIAVEIS:-}" ]; then
  printf '# Gerado por infra/setup-server.sh (IPS_CONFIAVEIS)\n[DEFAULT]\nignoreip = 127.0.0.1/8 ::1 %s\n' "$IPS_CONFIAVEIS" \
    > /etc/fail2ban/jail.d/99-ips-confiaveis.conf
fi
systemctl enable fail2ban
systemctl restart fail2ban

log "Atualizações automáticas de segurança"
# Só pacotes de segurança do Ubuntu; o Docker não é atualizado sozinho (não reinicia os serviços sem aviso).
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
systemctl enable --now unattended-upgrades
# O needrestart já não reinicia o docker; o containerd também fica para um reboot planejado (o Swarm cai junto).
mkdir -p /etc/needrestart/conf.d
echo '$nrconf{override_rc}{qr(^containerd)} = 0;' > /etc/needrestart/conf.d/50-servidor.conf

log "Fuso horário e usuário padrão"
timedatectl set-timezone "$FUSO"
systemctl restart cron
# O usuário "ubuntu" de algumas imagens tem sudo sem senha; o acesso passa a ser só pelo root, então ele fica sem
# login. MAS só quando o root já entra por chave útil e você não está rodando isto como ubuntu (senão ninguém entraria).
if id ubuntu >/dev/null 2>&1; then
  if chave_root_util && [ "${SUDO_USER:-}" != ubuntu ]; then
    usermod -L -s /usr/sbin/nologin ubuntu
    chage -E 0 ubuntu
  else
    echo "AVISO: o usuário ubuntu continua com login (o root ainda não entra por chave útil, ou você entrou como ubuntu)."
    echo "       Ponha a sua chave em /root/.ssh/authorized_keys, sem command=, teste o ssh como root e rode de novo."
  fi
fi

log "Rede do kernel"
cat > /etc/sysctl.d/90-servidor.conf <<'EOF'
# Gerado por infra/setup-server.sh
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0
net.ipv4.tcp_syncookies = 1
vm.swappiness = 10
EOF
sysctl --system >/dev/null

log "Swap de ${SWAP_GB} GB"
if ! swapon --show | grep -q .; then
  fallocate -l "${SWAP_GB}G" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab

log "Backup diário do Postgres (03:30)"
# Só agenda; o script vem junto com os outros arquivos em /opt/infra e não faz nada enquanto o Postgres não existir.
if [ -f /opt/infra/backup-postgres.sh ]; then
  printf '# Gerado por infra/setup-server.sh\n30 3 * * * root bash /opt/infra/backup-postgres.sh >> /var/log/backup-postgres.log 2>&1\n' \
    > /etc/cron.d/backup-postgres
fi
apt-get clean

log "Pronto"
docker version --format 'Docker {{.Server.Version}}'
[ "$SWARM" != sim ] || docker node ls
ufw status
fail2ban-client status
[ -n "${SENHA_NO_SSH:-}" ] && echo "ATENÇÃO: a senha do root ainda vale no SSH. Ponha a chave em /root/.ssh/authorized_keys e rode de novo." || true
[ -f /var/run/reboot-required ] && echo "Precisa reiniciar (kernel novo): reboot" || true
