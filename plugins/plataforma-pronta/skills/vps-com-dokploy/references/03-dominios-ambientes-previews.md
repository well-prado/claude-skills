# 03 · Domínios, ambientes e previews por PR

## Vários domínios

Sim: cada aplicação aceita **quantos domínios quiser**, cada um com o próprio HTTPS (Let's Encrypt), e cada app ou
projeto tem os seus. Medido: dois domínios no mesmo app respondem os dois, e um domínio não cadastrado dá 404.

| Situação | Como |
|---|---|
| Vários domínios no mesmo app (`exemplo.com.br` e `exemplo.com`) | Domains → Add Domain, um por vez, HTTPS + Let's Encrypt em cada |
| `www` levando para a raiz | crie o domínio `www.…` e, em Advanced → Redirects, o preset "Redirect to non-www" |
| Um domínio por cliente no mesmo app (multi-tenant) | um domínio por cliente no app; o app decide pelo cabeçalho `Host` |
| Domínio curinga (`*.cliente.com`) | **não** pelo Let's Encrypt padrão (desafio HTTP não emite curinga); exige um resolver com desafio DNS configurado no Traefik ou o certificado de origem da Cloudflare |
| Domínios gerados pelo Dokploy (`*.sslip.io`) | só HTTP: servem para testar, nunca para produção |

DNS: um registro **A** por nome, apontando para o servidor. O certificado só sai depois que o DNS responde
(confira com `curl -s 'https://cloudflare-dns.com/dns-query?name=NOME&type=A' -H 'accept: application/dns-json'`).
Na Cloudflare, nuvem **cinza** até o certificado sair; com a nuvem laranja, SSL "Full (strict)".

## Staging e produção

Dentro de um projeto, dois **ambientes** (production e staging; o production já vem criado), cada um com o seu app:

| | Staging | Produção |
|---|---|---|
| Branch que publica | `dev` (Autodeploy ligado) | `main` (Autodeploy ligado) |
| Domínio | `dev.seudominio.com.br` | `app.seudominio.com.br` |
| Banco | o seu próprio Postgres de staging | o da produção |
| Chaves de terceiros | de teste (gateway de pagamento em modo teste etc.) | as de verdade |
| `X-Robots-Tag: noindex` | sim (middleware ou no app) | não |

Variáveis: em três níveis — projeto (`${{project.X}}`), ambiente (`${{environment.X}}`) e serviço. O que é igual nos
dois fica no projeto; o que muda, no ambiente. Segredo nunca no repositório.

## Previews por pull request (a parte "Vercel")

Cada PR aberto contra a branch configurada ganha uma URL própria, que é apagada quando o PR fecha ou é mesclado. Não
ensaiado aqui (exige a GitHub App e o servidor alcançável pelo GitHub); da documentação e do código do Dokploy:

- **Só com GitHub**, pela GitHub App que o painel ajuda a criar (Settings → Git → GitHub). Ela tem acesso ao
  repositório: dê só aos repositórios necessários.
- **Domínio dos previews**: configure `*.preview.seudominio.com.br` no app (Preview Deployments) e crie no DNS um
  registro **A curinga** `*.preview` → IP do servidor. Cada preview ganha um nome como
  `preview-<app>-<id>.preview.seudominio.com.br`. O HTTPS dos previews vem **desligado** por padrão: ligue HTTPS e
  Let's Encrypt na tela de Preview Deployments (cada preview pede o seu certificado).
- **Variáveis próprias** (`previewEnv`): as do app são **substituídas** pelas do preview. Ponha um banco de teste e
  chaves de teste; **nunca** o banco da produção num preview. O Dokploy acrescenta `DOKPLOY_DEPLOY_URL` com o domínio
  do preview.
- **Limite**: 3 previews por padrão; acima disso os novos não sobem. Cada preview usa CPU e memória do mesmo servidor.
- **Repositório privado.** A documentação desaconselha preview em repositório público: um PR de qualquer pessoa
  dispararia build no seu servidor. Confira que a exigência de permissão de colaborador está ligada (o padrão é ligada).
- **Rede**: o preview entra na `dokploy-network`, de onde alcança o painel, a API do Traefik e os bancos pelo nome.
  Preview é código do seu time, não de terceiros; e nos bancos que o preview não precisa enxergar, use "Detach from
  dokploy-network".
- **Pronto quando**: um PR de teste abre a URL do preview com HTTPS, e ela some quando o PR fecha.

## Domínios e preview e o lock de líder

Preview e staging rodam jobs de fundo? Eles têm de apontar para bancos próprios: jobs que mandam e-mail, cobram ou
disparam webhooks, num preview com o banco da produção, agem sobre clientes de verdade.
