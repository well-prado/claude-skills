# 01 · Instalar o Dokploy e trancar o painel

A ordem importa: a porta 3000 é trancada **antes** de o Dokploy existir, o admin nasce pelo túnel SSH, e o painel só
abre pelo domínio, só para os seus IPs.

## 1. Servidor

Servidor novo, Ubuntu 24.04, chave SSH da pessoa posta pelo painel do provedor e impressão digital conferida (como na
skill `vps-de-producao`, referência 02). Preparação sem Swarm (o Dokploy cria o dele):

```bash
SSH="ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.ssh/id_ed25519"
$SSH root@SERVIDOR mkdir -p /opt/infra
scp -o IdentitiesOnly=yes -i ~/.ssh/id_ed25519 <vps-de-producao>/assets/infra/setup-server.sh <esta skill>/assets/trancar-portas.sh <esta skill>/assets/painel-restrito.yml root@SERVIDOR:/opt/infra/
$SSH root@SERVIDOR 'SWARM=nao IPS_CONFIAVEIS="SEU_IP" bash /opt/infra/setup-server.sh'
```

O `setup-server.sh` instala o Docker mais novo (o ensaio rodou com o Docker 29.10). Achando o Docker, o instalador do
Dokploy não instala o dele (28.5.0, travado com `apt-mark hold`); se preferir a versão que o Dokploy testa, pule a
parte do Docker e deixe o instalador cuidar dela.

## 2. Trancar as portas antes de instalar

Logo depois de instalar, **o painel responde na 3000 e também na 80** (o Dokploy cria uma rota para o nome
`dokploy.docker.localhost`; basta mandar esse cabeçalho `Host`), e **o primeiro que chegar cria o admin**, que é root
no servidor. Porta publicada pelo Docker passa por fora do ufw. O `trancar-portas.sh --instalacao` põe na cadeia
`DOCKER-USER` (que o Docker consulta antes de encaminhar para um contêiner) regras que derrubam o que chega pelas
interfaces de fora para 80, 443 e 3000, só no sentido de quem abre a conexão (a resposta de uma conexão que um app
abre para outro servidor passa), e um serviço do systemd as reaplica a cada início do Docker:

```bash
$SSH root@SERVIDOR 'bash /opt/infra/trancar-portas.sh --instalacao'
```

Medido: com as regras, nada do Dokploy responde de fora, nem o painel pelo nome interno na 80; sem elas, responde; as
regras voltam depois de reiniciar o Docker. De dentro do servidor (e pelo túnel) tudo continua respondendo.

## 3. Instalar com versão fixa

Use o `install.sh` anexado à release (ele traz a versão escrita; o `dokploy.com/install.sh` sempre pega a última):

```bash
$SSH root@SERVIDOR 'curl -fsSL https://github.com/Dokploy/dokploy/releases/download/v0.31.4/install.sh -o /root/dokploy-install.sh \
  && sh /root/dokploy-install.sh'
```

Leia o script antes (ele é curto). O que ele faz: confere root, portas 80/443/3000 livres e que não está dentro de um
contêiner; instala o Docker se faltar; **`docker swarm leave --force`** e `swarm init`; recria a rede `dokploy-network`;
cria os serviços `dokploy` (painel, porta 3000 em modo host) e `dokploy-postgres`, e o contêiner `dokploy-traefik`
(Traefik v3.7, portas 80, 443 e 443/udp). Ele imprime "Please go to http://IP:3000": **não abra pela internet**.

Instalações antigas deixavam `/etc/dokploy` com permissão 0777 (alerta GHSA-qxjv-6cvh-32c6). Confira e acerte:
`stat -c %a /etc/dokploy` tem de ser `755` (`chmod 755 /etc/dokploy`).

## 4. O admin, pelo túnel

```bash
ssh -o IdentitiesOnly=yes -i ~/.ssh/id_ed25519 -N -L 3000:127.0.0.1:3000 root@SERVIDOR
```

Até aqui só a 22 responde de fora. A pessoa abre `http://localhost:3000` **no computador dela**, cria o admin com a senha dela e, em seguida, liga o 2FA
(Settings → Profile). Você não cria essa conta.

## 5. O painel pelo domínio, só para os seus IPs

1. DNS: registro A `painel` → IP do servidor (e os dos apps; tabela na referência 03).
2. Copie o `painel-restrito.yml` para o servidor (já foi no passo 1) e prepare os seus IPs (`curl -s https://ifconfig.me`).
3. Já com o admin criado: a lista de IPs. Em `assets/painel-restrito.yml`, troque `PAINEL_DOMINIO` e `SEU_IP`, e
   ponha em `/etc/dokploy/traefik/dynamic/painel-restrito.yml`. O Traefik relê sozinho. São três rotas com prioridade
   maior que as do Dokploy, todas pela lista: o domínio no HTTPS, o mesmo no HTTP (sem ela, quem desligasse o HTTPS do
   painel deixaria o login aberto em HTTP) e o nome interno `dokploy.docker.localhost`.

   Por que um arquivo à parte: o Dokploy regrava o `dokploy.yml` inteiro cada vez que o domínio do painel é salvo, e um
   middleware posto lá à mão some. Este arquivo ele não toca. Medido: IP fora da lista → 403; IP da lista → 200;
   continua valendo depois de o Dokploy regravar o painel. O Traefik do Dokploy vê o IP real de quem acessa (medido).
4. **Abra 80 e 443 para fora** (os apps e o Let's Encrypt precisam delas), mantendo a 3000 fechada:

   ```bash
   $SSH root@SERVIDOR 'bash /opt/infra/trancar-portas.sh --painel'
   curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: dokploy.docker.localhost' http://SERVIDOR/   # de outro IP: 403
   ```
5. No painel (pelo túnel): Settings → Web Server → **Server Domain**: `painel.seudominio.com.br`, HTTPS com Let's
   Encrypt e um e-mail. Abra `https://painel.seudominio.com.br` e confira o certificado.
6. **Feche a 3000** pela tela (Web Server → Server → *Disable Port 3000*; ela só deixa quando você está acessando pelo
   domínio) ou pelo SSH:

   ```bash
   $SSH root@SERVIDOR 'docker service update --publish-rm "published=3000,target=3000,mode=host" dokploy'
   ```

   Medido: depois disso a 3000 não responde nem de dentro, e o painel segue pelo domínio. Deixe a regra do
   `trancar-portas.sh --painel` ligada mesmo assim: se alguém reabrir a porta pela tela, ela continua fechada para fora.
   (Com a 3000 fechada, o Dokploy não deixa trocar o domínio do painel; para trocar, reabra pelo túnel com
   `docker service update --publish-add published=3000,target=3000,mode=host dokploy`.)

## Pronto quando

```bash
for p in 22 80 443 3000 5432 8080; do nc -z -G 3 SERVIDOR $p && echo "$p aberta" || echo "$p fechada"; done   # macOS; no Linux, -w 3
curl -s -o /dev/null -w '%{http_code}\n' https://painel.seudominio.com.br/          # do seu IP: 200 (ou 307 para o login)
```

E de outro IP (o celular no 4G): **403** no domínio do painel e no nome interno
(`curl -H 'Host: dokploy.docker.localhost' http://SERVIDOR/`). Abertas só 22, 80 e 443.

## Não faça

- Não ligue o dashboard do Traefik (8080) nem exponha a API do Docker.
- Não publique porta de banco ("External Port") a não ser por um motivo forte, e então só para um IP.
- Não edite o contêiner `dokploy-traefik` à mão (volumes, portas, labels): o Dokploy o recria e a mudança some. O que
  for seu vai em `/etc/dokploy/traefik/dynamic/`.
