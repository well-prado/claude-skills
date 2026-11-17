# 04 · Bancos, backup e operação

## Bancos

Pela tela (Create Service → Database): Postgres, MySQL, MariaDB, MongoDB, Redis. Um banco por ambiente, sem "External
Port" (os apps entram pela rede interna, com o host e a senha que a tela mostra). Versão da imagem fixa (ex.:
`postgres:18.6`, não `postgres:18`).

## Backup (fora do servidor, e restaurado)

Não ensaiado aqui; da documentação do Dokploy. O backup só conta depois do primeiro ensaio de restauração.

1. **Destino S3** (Settings → S3 Destinations) num provedor **diferente** do servidor: Cloudflare R2, Backblaze B2,
   AWS S3. Bucket com versionamento ou retenção, chave que só grava naquele bucket, e criptografia do lado do bucket
   (o Dokploy não cifra o arquivo).
2. **Backup agendado de cada banco** (aba Backups do banco): cron diário, prefixo por ambiente, "keep the latest N".
   Redis não tem backup pelo Dokploy.
3. **Backup do próprio Dokploy** (Web Server → Backups): o banco interno e `/etc/dokploy` (configuração, certificados,
   rotas) para o mesmo S3. É o que permite remontar o painel num servidor novo.
4. **Ensaio de restauração** (mensal e antes de qualquer mudança grande): crie um banco de ensaio, aba Backup →
   Restore com o arquivo mais recente, e compare a contagem de linhas das tabelas principais com a produção. Apague o
   banco de ensaio. Escreva a data e o tempo no README do projeto.

## Atualizar o Dokploy

- Leia as notas da versão e os alertas de segurança do repositório.
- Faça o backup do Dokploy (acima) antes.
- Atualize com a versão fixa: `curl -fsSL https://github.com/Dokploy/dokploy/releases/download/vX.Y.Z/install.sh | sh -s update`.
- O Traefik não se atualiza junto; a tela tem a opção (Web Server → Traefik). Atualize um de cada vez.
- Depois: o painel abre pelo domínio, o `painel-restrito.yml` continua em `/etc/dokploy/traefik/dynamic/`, a 3000
  continua fechada (`docker service inspect -f '{{json .Endpoint.Ports}}' dokploy` tem de dar `null`).

## Notificações

Settings → Notifications (Slack, Discord, Telegram, e-mail…): erros de build, backups e limites de CPU/memória. Ligue
pelo menos os de backup e de build. Lembre: deploy "done" não prova que a versão está no ar; quem prova é a Action
`conferir-deploy.yml`.

## Log de acesso

O Dokploy só grava log de acesso do Traefik se você ligar (página Requests), em JSON com o caminho da requisição,
que pode levar tokens (link mágico, troca de senha). Deixe desligado, ou ligue só para investigar e desligue depois.

## Armadilhas (sintoma → causa → saída)

- *O site ficou em 502 depois de um deploy "done"* → app sem verificação de saúde: a versão quebrada ficou no ar →
  `swarm-settings.json` em todo app (02).
- *Deploy "done", mas o site mostra a versão antiga* → o Swarm voltou à anterior porque a nova não ficou saudável →
  a Action `conferir-deploy.yml` fica vermelha; veja os logs do serviço no Dokploy.
- *Todas as stacks do servidor sumiram ao instalar* → o instalador roda `docker swarm leave --force` → servidor
  dedicado, sempre.
- *O painel respondeu de fora pelo `Host: dokploy.docker.localhost` na porta 80* → faltou o `painel-restrito.yml`
  (rota `painel-interno`) antes de abrir a 80 → ponha o arquivo; até lá, `trancar-portas.sh --instalacao`.
- *Um app não consegue falar com um serviço de fora na porta 3000 (ex.: um Gitea)* → regra antiga sem `--ctdir
  ORIGINAL` derrubava a resposta → use o `trancar-portas.sh` atual.
- *O painel deu 403* → o IP de casa mudou → troque o IP em `/etc/dokploy/traefik/dynamic/painel-restrito.yml` pelo SSH.
- *Mudei o Traefik do Dokploy e a mudança sumiu* → o Dokploy recria o contêiner `dokploy-traefik` → o que for seu vai
  em `dynamic/`.
- *O middleware que pus na rota do painel sumiu* → o Dokploy regrava o `dokploy.yml` ao salvar o domínio do painel →
  `painel-restrito.yml` à parte (01).
- *Não consigo trocar o domínio do painel* → a 3000 está fechada → reabra pelo túnel, troque, feche de novo (01).
- *Preview apontando para o banco da produção* → `previewEnv` não definido → variáveis próprias do preview (03).
- *A API do Dokploy responde "Rate limit exceeded"* → as chaves de API nascem com limite de requisições → para
  automação, crie a chave com o limite desligado ou maior (Settings → Profile → API/CLI Keys).
- *Fiquei trancado fora do SSH* → fail2ban → console VNC do provedor, `fail2ban-client set sshd unbanip SEU_IP`; sempre
  `-o IdentitiesOnly=yes -i <chave>`.
