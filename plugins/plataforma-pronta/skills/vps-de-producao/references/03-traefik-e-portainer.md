# 03 · DNS, Traefik e o painel

## O DNS (a pessoa faz; você entrega a tabela)

Um registro **A** por nome, todos para o IP do servidor. Sem curinga (`*`): cada nome que existe é uma decisão.

| Nome | Tipo | Valor | Para quê |
|---|---|---|---|
| `app` | A | IP do servidor | produção |
| `dev` | A | IP do servidor | staging |
| `painel` | A | IP do servidor | Portainer |
| `@` e `www` | A | IP do servidor | só se o site principal também for para lá |

E-mail (ex.: Resend, SES, Postmark): os registros **TXT/MX/CNAME de SPF, DKIM e DMARC** que o provedor de e-mail
mostra no painel dele, copiados exatamente. Não invente; peça a tela.

**No registro.br**, para quem nunca fez: *Domínios → o domínio → DNS → Configurar zona DNS* (modo avançado), *Nova
entrada* para cada linha da tabela, e **Salvar alterações** no fim (sem isso nada é publicado; é o erro mais comum).
Propaga em minutos, às vezes até 2 h. **Na Cloudflare**: os mesmos registros, com a nuvem **cinza** (só DNS) se o
`traefik.yml` estiver como no molde; para a nuvem laranja, veja o topo do `traefik.yml` (trustedIPs + SSL Full strict).

Conferir sem depender do DNS local (que guarda cache e às vezes nem sai da sandbox por UDP):

```bash
curl -s 'https://cloudflare-dns.com/dns-query?name=app.seudominio.com.br&type=A' -H 'accept: application/dns-json' | jq -r '.Answer[]?.data'
```

## Traefik

```bash
$SSH root@SERVIDOR 'cd /opt/infra && docker stack deploy -c traefik.yml traefik'
$SSH root@SERVIDOR 'docker service ps traefik_traefik --format "{{.CurrentState}} {{.Error}}"'
```

O que o molde faz e por quê:

- **Portas 80/443 em modo host**, na forma longa. No modo `ingress` do Swarm o IP de quem acessa vira o do
  balanceador interno, e o allowlist do painel deixaria de funcionar.
- **80 redireciona para 443**; o desafio HTTP do Let's Encrypt continua passando pela 80 (o Traefik trata antes do
  redirecionamento). Nunca redirecione `/.well-known/acme-challenge/*` em outro lugar.
- **`exposedByDefault=false`**: só entra na rota o serviço com `traefik.enable=true` nos labels **de deploy**
  (`deploy.labels`, não `labels` do contêiner: no Swarm, o Traefik lê os do serviço).
- **`aliasHeadersStrategy=delete`**: cabeçalhos "parecidos" (`X_Forwarded_For`) somem, ninguém forja o IP de origem.
- **Log de acesso** sem caminho, sem cabeçalhos e sem IP (por quê: 01, princípio 8).
- **`stop-first` + rollback**: as portas são do host, então o novo só sobe quando o antigo sai (alguns segundos fora
  numa atualização do Traefik); se o novo não ficar saudável, volta sozinho.
- Sem dashboard exposto. Para ver as rotas: `docker service logs traefik_traefik` e os labels.

## Portainer

```bash
$SSH root@SERVIDOR 'cd /opt/infra && PAINEL_IPS=SEU_IP/32 PAINEL_DOMINIO=painel.seudominio.com.br docker stack deploy -c portainer.yml portainer'
$SSH root@SERVIDOR "docker service logs portainer_portainer 2>&1 | grep setup_token | tail -1"
```

**Coordene com a pessoa antes de subir:** o Portainer espera só **5 minutos** pela criação do admin. Ela abre
`https://painel.seudominio.com.br`, cola o setup token do log e cria o admin **com a senha dela**. Passou do tempo:
`docker service update --force portainer_portainer` e um token novo.

Por que tanto cuidado: o admin do Portainer é root no servidor (o agente tem o `docker.sock` e os volumes do
Postgres). Por isso o painel:

- só abre para os IPs de `PAINEL_IPS` (o deploy recusa sem ela); de outro IP, **403**;
- fica fora da `traefik-public` (o app não alcança o painel por dentro); o Traefik chega nele pela rede `painel`;
- manda HSTS, `frameDeny`, `nosniff` e `referrerPolicy`.

O IP de casa mudou e o painel deu 403? Rode o mesmo deploy pelo SSH com o IP novo (o SSH não depende do allowlist).

## Pronto quando

```bash
curl -sI https://painel.seudominio.com.br | head -1                     # do seu IP: 200 (ou 307 para o login)
curl -s https://painel.seudominio.com.br -o /dev/null -w '%{ssl_verify_result}\n'   # 0 = certificado válido
```

E de outro IP (o celular no 4G, ou um `curl` de qualquer máquina fora da sua rede): **403**. Mostre as duas respostas.

## Atualizar o Traefik ou o Portainer

Troque a versão no arquivo (leia as notas de versão), copie para `/opt/infra` e rode o mesmo `docker stack deploy`.
O Traefik volta sozinho se a nova versão não ficar saudável; o Portainer não: `docker service rollback
portainer_portainer`. Ambos sobem **pela linha de comando**, nunca pelo próprio Portainer (um erro derrubaria o painel
que você usaria para consertar).
