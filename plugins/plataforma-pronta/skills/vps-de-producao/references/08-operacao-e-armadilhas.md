# 08 · Operação e armadilhas

## Rotina

| Quando | O quê |
|---|---|
| Todo deploy | a Action confere `/health` (commit e versão); vermelha = não está no ar |
| Toda semana | `apt list --upgradable` (Docker e containerd não se atualizam sozinhos); `df -h /`; `fail2ban-client status sshd` |
| Todo mês | ensaio de restauração do backup (04); conferir que o backup de fora está chegando |
| Kernel novo | `reboot` numa hora calma (~40 s fora); o Swarm sobe as stacks sozinho |
| Versão nova de Traefik/Portainer/Postgres | ler as notas, trocar a versão no arquivo, `docker stack deploy` (Postgres: só minor; major é dump e restore) |
| Monitor externo | um verificador de fora (UptimeRobot, Better Stack, Healthchecks) batendo no `/health` da produção a cada minuto |

## Trocar de servidor

1. Servidor novo montado (02, 03), Postgres no ar com os papéis (04), `setup-deploy-user.sh` e os segredos (06).
2. Portainer: *Settings → Backup* no antigo; no novo, nos 5 primeiros minutos, *Restore from backup*.
3. Certificados: copie o `acme.json` do volume `traefik_certificates` do antigo para o novo (com o Traefik do novo
   parado), para a troca de DNS não ter erro de SSL.
4. Virada como na 07: app parado no antigo → dump → restore → conferência → stack no novo → DNS. Antigo parado, não
   apagado.

## Armadilhas (sintoma → causa → saída)

**Acesso**
- *Fiquei trancado fora do SSH, a porta 22 não responde* → fail2ban: chaves erradas do agente contaram como falhas →
  console VNC do provedor, `fail2ban-client set sshd unbanip SEU_IP`; daí em diante sempre `-o IdentitiesOnly=yes -i
  <chave>` e o IP de casa em `IPS_CONFIAVEIS`. Para esperar um bloqueio, teste só a porta (`nc -z`), nunca o login.
- *A chave de outra pessoa parou de entrar* → o "reset de credenciais" do painel do provedor substituiu o
  `authorized_keys` → acrescente a chave dela de volta (02).
- *`$SSH root@...` dá "command not found"* → zsh não divide variável em palavras → `bash -c` ou array.
- *O agente não alcança o servidor (timeout no ssh, no dig)* → a sandbox do agente bloqueia a rede para fora →
  libere o comando; para DNS, use DoH (`curl` no `cloudflare-dns.com/dns-query`), que passa por HTTPS.

**Rede e certificados**
- *Uma porta que eu não abri responde de fora* → um contêiner publicou porta (`ports:`), e o Docker passa por fora do
  ufw → tire o `ports:`; o `infra.test.mjs` reprova isso no push.
- *Certificado não sai* → o DNS ainda não aponta (confira por DoH), o `/.well-known/acme-challenge` está sendo
  redirecionado em algum lugar, ou a Cloudflare está em modo proxy com SSL "Flexible" → DNS direto (nuvem cinza) até
  sair, ou trustedIPs + "Full (strict)".
- *O painel dá 403* → o IP de casa mudou → deploy do Portainer de novo pelo SSH com `PAINEL_IPS` novo.
- *O token do Portainer expirou* → passou dos 5 minutos → `docker service update --force portainer_portainer`.
- *IP de quem acessa aparece como 10.x / 172.x* → porta do Traefik em modo `ingress`, ou acesso pelo IPv6 via
  `docker-proxy` → modo `host` (molde) e sem AAAA (02).

**Deploy**
- *502 por alguns segundos a cada deploy* → falta `traefik.swarm.lbswarm=true` ou o `retry`, ou o app não tem
  HEALTHCHECK (o Swarm troca antes de a nova estar pronta) → as quatro peças da 05.
- *O deploy "deu certo" mas o app é o velho* → o Swarm fez rollback e ninguém olhou → o `ci-deploy` espera e falha
  nesse caso; a Action confere o commit no `/health`.
- *O deploy falhou com "rollback paused" e o site oscila* → o Swarm começou a voltar e parou no meio (o padrão do
  `rollback_config` é pausar se uma tarefa da volta falha), e pode haver duas tarefas da versão antiga, uma delas sem
  ficar saudável. Visto no ensaio com deploys quebrados seguidos; num estado limpo, a volta foi sem nenhum erro →
  `docker service ps meuapp_app` para ver, e então publique de novo o último commit bom (Re-run do deploy dele) ou
  `docker service update --force meuapp_app`. Não deixe o serviço em `rollback_paused`.
- *Rollback não volta para a versão anterior* → imagem com tag móvel (`latest`) ou a anterior apagada → tag por
  commit (molde) e o `prune-images.sh` guarda a usada e a anterior.
- *Webhook enviado duas vezes, cobrança em dobro* → job rodando nas duas instâncias do start-first → lock de líder
  (05).
- *A produção mostra a URL do staging* → `NEXT_PUBLIC_*` embutido no build → configuração em tempo de execução (05).
- *"invalid reference format" com um pedaço da mensagem de erro no lugar da imagem* → uma mensagem `${NOME:?…}` com
  hífen: o `docker stack deploy` lê o trecho depois do hífen como valor padrão, mesmo com a variável definida (o
  `docker compose config` lê certo e não acusa) → mensagem sem hífen; o `infra.test.mjs` reprova.
- *"infra/… deste commit difere da instalada no servidor"* → o commit mudou a `stack.yml`, um `stacks/*.env`, o
  `smoke.sh` ou o `prune-images.sh` → um admin revisa a mudança e roda `infra/setup-deploy-user.sh root@SERVIDOR
  --infra`; depois, refaça o deploy (Re-run do job).
- *O `docker stack deploy` ignorou meu `build:`, `container_name`, `depends_on`, `security_opt`* → o Swarm não usa
  essas chaves → imagem já construída, labels em `deploy.labels`, `no-new-privileges` no `daemon.json`.

**Banco**
- *Postgres corrompeu depois de um update* → dois Postgres no mesmo volume (`start-first`) → `stop-first` (molde).
- *Postgres 18 subiu vazio com o volume antigo* → o caminho do volume mudou para `/var/lib/postgresql` → monte o
  volume no caminho novo; dados de uma major anterior precisam de dump e restore.
- *SQL colado no editor gravou acentos estragados ("Ação" virou "A√ß√£o")* → `pbcopy` sem UTF-8 no macOS →
  `LANG=en_US.UTF-8 pbcopy < arquivo.sql`; confira um texto acentuado no banco depois.
- *"Rodei o SQL" mas metade não entrou* → um erro no meio desfaz a transação inteira no editor → confira o esquema
  depois (as tabelas e colunas esperadas existem) antes de dar por feito.
- *O backup existia, mas não restaurava* → nunca foi ensaiado → ensaio mensal (04).

**Disco e memória**
- *Disco enchendo* → logs sem rotação (o `daemon.json` do molde resolve), imagens antigas (o `prune-images.sh`),
  backups locais (`KEEP_DAYS`) → `docker system df`, `du -sh /var/lib/docker/* /var/backups/*`.
- *O app reinicia sozinho* → passou do limite de memória → `docker service ps --no-trunc` mostra `OOMKilled`; meça e
  ajuste `APP_MEMORIA` e o `--max-old-space-size`.
