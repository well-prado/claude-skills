---
name: vps-com-dokploy
description: 'Monta a "própria Vercel" numa VPS nova com o Dokploy (painel de deploy auto-hospedado sobre Docker Swarm e Traefik): deploy por push do GitHub, preview por pull request, vários domínios por app com HTTPS automático, staging e produção, bancos com backup para S3 — endurecido e com deploy que não derruba produção, provado com sonda. Cobre a instalação com versão fixa, a porta 3000 trancada no kernel antes de instalar, o painel atrás de domínio e restrito por IP, a verificação de saúde e o rollback que o padrão não liga, e a conferência de fora (o Dokploy diz "done" mesmo quando o Swarm voltou à versão anterior). Use quando a pessoa quiser Dokploy, uma Vercel/Netlify/Heroku própria, painel de deploy na VPS, preview por PR no próprio servidor, ou comparar Dokploy com montar tudo à mão.'
---

# VPS com Dokploy: a sua própria Vercel

O Dokploy dá a experiência de PaaS (tela, deploy por push, preview por PR, domínios, bancos, backups) num servidor
seu. Esta skill instala e **endurece** o Dokploy e configura cada app para trocar de versão sem queda. Tudo o que vai
marcado como **medido** foi ensaiado numa Ubuntu 24.04 descartável com o Dokploy **v0.31.4**, com uma sonda batendo no
app 5 vezes por segundo.

| Medido no ensaio | Resultado |
|---|---|
| Portas 80, 443 e 3000 trancadas no kernel antes da instalação | de fora não respondem (nem o painel pelo nome interno na 80); sem a regra, respondem; voltam depois de reiniciar o Docker |
| Painel atrás de domínio, só para os seus IPs | IP de fora → 403 no HTTPS, no HTTP e no nome interno; o seu → liberado; continua depois de o Dokploy regravar o painel |
| A trava não atrapalha o app | um app fala com um serviço de fora na porta 3000 (com a regra antiga, sem `--ctdir`, não falava) |
| Porta 3000 fechada depois | o painel segue pelo domínio; a 3000 não responde nem de dentro |
| Dois domínios no mesmo app | os dois respondem 200; um domínio não cadastrado, 404 |
| Troca de versão **com** a configuração desta skill | 135 respostas, 0 erros |
| Versão quebrada **com** a configuração desta skill | volta sozinha para a anterior, 124 respostas, 0 erros |
| Versão quebrada com o **padrão** do Dokploy (sem verificação de saúde) | **fica no ar dando 502** (91 erros e contando) |
| O que o Dokploy mostra nos dois casos de versão quebrada | **"done"** (sucesso), mesmo quando o Swarm voltou para a anterior |

Não ensaiado aqui (vem da documentação e do código do Dokploy, e a skill diz como provar no seu servidor): preview
por PR (precisa da GitHub App e de um servidor alcançável pelo GitHub), certificados do Let's Encrypt (precisa de DNS
de verdade) e backup para S3 com restauração.

## ⚠️ Antes de tudo

- **Só em servidor NOVO ou dedicado.** O instalador do Dokploy roda `docker swarm leave --force`: **apaga qualquer
  Swarm que já exista**, com todas as stacks. Nunca rode num servidor que já tem algo no ar (por exemplo, um montado
  com a skill `vps-de-producao`). Se for o caso, use outro servidor.
- **O admin do Dokploy é root no servidor**, como o do Portainer. Senha forte, 2FA (Settings → Profile) e painel
  restrito por IP não são opcionais.
- **Versão fixa e atualizada.** O Dokploy acumula 134 alertas de segurança publicados desde julho de 2025, 74 deles
  só em novembro de 2026 (muitos críticos: execução de comando como root, vazamento entre organizações), a maioria
  corrigida até a v0.31.1, e alguns ainda sem versão corrigida no GitHub. Use a última estável (v0.31.4 neste ensaio),
  acompanhe os alertas do repositório e não exponha o painel.
- **A lista de IPs protege o painel de quem vem pela internet, não de dentro.** Todo app, preview e banco entra por
  padrão na rede `dokploy-network`, onde o painel (`http://dokploy:3000`), a API do Traefik e os bancos respondem pelo
  nome. Código que você não confia (o de um PR de fora, num preview) não roda nesse servidor sem rede própria.

## As fases

| # | Fase | Referência | Pronto quando |
|---|---|---|---|
| 1 | Servidor e trava das portas | [01-instalar-e-trancar](references/01-instalar-e-trancar.md) | de fora, só a 22 responde até o painel estar restrito |
| 2 | Dokploy e painel | [01-instalar-e-trancar](references/01-instalar-e-trancar.md) | admin com 2FA; painel pelo domínio com HTTPS, 403 de outro IP (inclusive pelo nome interno na 80); 3000 fechada |
| 3 | Apps sem queda | [02-apps-sem-queda](references/02-apps-sem-queda.md) | sonda sem erro numa troca e numa versão quebrada que volta sozinha |
| 4 | Domínios, ambientes e previews | [03-dominios-ambientes-previews](references/03-dominios-ambientes-previews.md) | cada domínio com HTTPS; staging (dev) e produção (main); preview abre e some com o PR |
| 5 | Bancos, backup e operação | [04-bancos-backup-operacao](references/04-bancos-backup-operacao.md) | um backup restaurado num banco de ensaio; o Dokploy com backup próprio para fora |

## Os moldes (`assets/`)

| Molde | Para quê |
|---|---|
| `trancar-portas.sh` | regras no `DOCKER-USER` (e serviço do systemd) que derrubam quem chega de fora nas portas do Dokploy: 80, 443 e 3000 durante a instalação (`--instalacao`), só a 3000 depois (`--painel`) |
| `painel-restrito.yml` | rotas de prioridade maior para o painel (o domínio no HTTPS e no HTTP, e o nome interno `dokploy.docker.localhost`), todas com a lista de IPs; vai para `/etc/dokploy/traefik/dynamic/` |
| `swarm-settings.json` | verificação de saúde, troca start-first com rollback e a volta start-first, nos campos que o Dokploy aceita (tempos em nanossegundos) |
| `github/workflows/conferir-deploy.yml` | confere de fora que o commit do push está no ar; vermelha quando o Dokploy disse "done" mas a versão voltou |
| `dokploy.test.mjs` | as regras acima viram teste (`node --test`), para quem adaptar os moldes não quebrar sem ver |

A preparação do servidor (Docker, ufw, fail2ban, SSH só por chave, swap) é o `setup-server.sh` da skill
`vps-de-producao`, do mesmo plugin, com `SWARM=nao` (o Dokploy cria o Swarm dele).

## O que é da pessoa

- Contratar o servidor, o domínio e o S3 de backup; criar os registros no DNS (você entrega a tabela).
- **Criar o admin do Dokploy pelo túnel SSH, com a senha dela, e ligar o 2FA.**
- Criar a GitHub App pelo painel (o Dokploy guia), que exige a conta dela no GitHub.
- Colar segredos de terceiros nas variáveis dos apps.

## Dokploy ou a skill `vps-de-producao`?

| | Dokploy (esta skill) | `vps-de-producao` (tudo em arquivo) |
|---|---|---|
| Tela para deploys, logs, variáveis, domínios | sim | não (SSH e Portainer) |
| Preview por PR | sim (GitHub App) | não |
| Produção recebe exatamente a imagem testada no staging | não por padrão (cada app constrói o seu); dá com registry (ver 02) | sim, por desenho |
| Quem mexe na infra | qualquer admin do painel | só quem tem root; o deploy recusa infra diferente |
| Superfície de ataque | painel web com root (muitos alertas em 2026) | só SSH e o `ci-deploy` |
| Servidor | dedicado (o instalador apaga o Swarm existente) | dedicado |

Time pequeno que quer conforto e preview por PR: Dokploy, endurecido como aqui. Dados sensíveis ou exigência de
auditoria forte: a `vps-de-producao`.
