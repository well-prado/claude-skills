# 02 · O servidor e a segurança

## Antes de tudo: o acesso

1. **A pessoa contrata** a VPS com Ubuntu 24.04 (qualquer provedor: Contabo, Hetzner, DigitalOcean, OVH, Vultr).
2. **A chave SSH dela vai pelo painel do provedor**, não por senha no chat. Na Contabo: *Reset credentials → SSH-Key*.
   Gere uma, se ela não tiver: `ssh-keygen -t ed25519 -C "nome-do-computador"`; ela cola o conteúdo do `.pub`.
   - **Cuidado:** em vários provedores esse "reset" **substitui o `authorized_keys` inteiro**. Se outra pessoa (ou o
     agente de outra pessoa) já entrava por chave, a chave dela some. Confira com quem mais tem acesso antes.
3. **Confira a impressão digital do servidor** antes do primeiro `yes`: a pessoa roda no console VNC do provedor
   `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` e compara com a que o seu `ssh` mostra. Anote a impressão
   (ela vai para o `DEPLOY_KNOWN_HOSTS` do GitHub depois).
4. Teste uma vez, sem laço:

```bash
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.ssh/id_ed25519 root@SERVIDOR hostname
```

`IdentitiesOnly` importa: com várias chaves no agente, o `ssh` tenta todas, e cada chave errada conta como uma falha
no fail2ban (5 falhas = 1 h trancado).

## Montar

```bash
SSH="ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.ssh/id_ed25519"
$SSH root@SERVIDOR mkdir -p /opt/infra
scp -o IdentitiesOnly=yes -i ~/.ssh/id_ed25519 infra/*.sh infra/*.yml root@SERVIDOR:/opt/infra/
$SSH root@SERVIDOR 'IPS_CONFIAVEIS="SEU_IP" bash /opt/infra/setup-server.sh'
$SSH root@SERVIDOR reboot   # só se o script disse "Precisa reiniciar"
```

No zsh, `$SSH root@…` não divide a variável em palavras: rode dentro de `bash -c '…'` ou use um array.

O `setup-server.sh` pode rodar de novo a qualquer momento (mudou o IP de casa, chegou uma regra nova). O que ele faz,
na ordem:

| Passo | Por quê |
|---|---|
| `apt full-upgrade` + Docker do repositório oficial | o `docker.io` do Ubuntu atrasa versões e correções |
| `daemon.json`: rotação de log 10 MB × 3 e `no-new-privileges` | log sem rotação enche o disco; o `stack deploy` ignora `security_opt`, então só o padrão do daemon vale para os serviços |
| **ufw antes do Swarm**: nega entrada, abre 22/80/443 | na primeira rodada, as portas do Swarm (2377, 7946, 4789) não ficam abertas nem por segundos |
| `swarm init` + redes `traefik-public`, `painel`, `banco` | ver 01 |
| `sshd`: 3 tentativas, 30 s, sem senha vazia, sem X11 | reduz força bruta |
| **senha desligada só se o root já tem chave válida** | desligar antes tranca todo mundo fora; confere com `sshd -T`, não com o arquivo |
| fail2ban: sshd agressivo + recidive + `IPS_CONFIAVEIS` | 5 erros/10 min = 1 h; reincidência dobra até 4 semanas; 3 bloqueios num dia = 1 semana |
| atualizações automáticas só de segurança; containerd fora do needrestart | o Docker não reinicia sozinho no meio do dia |
| fuso, usuário `ubuntu` sem login, sysctl de rede, swap | — |
| cron do backup às 03:30 | o script não faz nada até o Postgres existir |

## Pronto quando

```bash
# de fora, só 22, 80 e 443 respondem (rode do seu computador; -G é do nc do macOS, no Linux use -w 3)
for p in 22 80 443 2377 5432 7946 9000 9443; do nc -z -G 3 SERVIDOR $p && echo "$p aberta" || echo "$p fechada"; done
# no servidor
$SSH root@SERVIDOR "sshd -T | grep -E '^(passwordauthentication|permitrootlogin)'; ufw status; fail2ban-client get sshd ignoreip"
```

Esperado: 22/80/443 abertas e o resto fechado; `passwordauthentication no`, `permitrootlogin without-password`; o ufw
com as três regras; o `ignoreip` com o IP de casa.

## Outra pessoa precisa entrar

Acrescente a chave dela ao `authorized_keys`, **guardando o arquivo anterior**, e nunca troque o arquivo inteiro:

```bash
$SSH root@SERVIDOR 'cp /root/.ssh/authorized_keys /root/.ssh/authorized_keys.antes-$(date +%Y%m%d) && cat >> /root/.ssh/authorized_keys' < chave-da-pessoa.pub
$SSH root@SERVIDOR 'ssh-keygen -lf /root/.ssh/authorized_keys'
```

Se ela tentou entrar antes e foi bloqueada: `fail2ban-client status sshd` mostra os IPs; `fail2ban-client set sshd
unbanip IP` libera. Deixe claro para ela as regras da casa (só pelo Traefik, sem publicar porta, versão fixa).

## IPv6

Não crie registro AAAA ainda. Com o Traefik em modo host só no IPv4, o Docker põe um `docker-proxy` escutando em
`[::]:80/443`, e quem chega pelo IPv6 aparece com o IP interno do Docker: o rate limit e o allowlist do painel deixam
de valer. Só ligue o IPv6 depois de resolver isso (Docker com `ip6tables`/`ipv6` no daemon e conferir o IP de origem
no log com um teste de fora).

## O que fica para depois (e vale fazer)

- **Proxy do socket do Docker para o Traefik.** O `:ro` no `docker.sock` não limita a API. Um
  `tecnativa/docker-socket-proxy` (versão fixa) numa rede interna, liberando só leitura de serviços e redes.
- **Regra no `DOCKER-USER`.** Garante no kernel que só 80/443 chegam a um contêiner, mesmo se alguém criar uma stack
  à mão com `ports:`.
- **Aviso de atualização do Docker e do containerd**: eles não se atualizam sozinhos (de propósito); um alerta semanal
  (`apt list --upgradable`) evita ficar meses atrás.
