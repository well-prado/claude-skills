---
name: vps-de-producao
description: 'Sobe um projeto web numa VPS própria (Contabo, Hetzner, DigitalOcean, qualquer Ubuntu 24.04) com qualidade de produção — Docker Swarm de 1 nó, Traefik com HTTPS automático, Portainer restrito por IP, Postgres com papel por ambiente e backup fora do servidor, staging (branch dev) e produção (branch main) no mesmo servidor, deploy sem queda pelo GitHub Actions com a mesma imagem testada no staging indo para a produção, e o roteiro da virada saindo de Vercel, Supabase, Heroku, Railway ou Render. Use sempre que a pessoa quiser colocar o app numa VPS, sair de um PaaS, montar staging e produção, configurar Traefik/Swarm/Portainer, endurecer um servidor, montar deploy por SSH/GitHub Actions, fazer backup do Postgres ou migrar o banco, mesmo que ela não diga "VPS" (ex.: "quero parar de pagar a Vercel", "sobe isso no meu servidor", "quero um staging").'
---

# VPS de produção

Um servidor só, com tudo que um time pequeno precisa para dormir tranquilo: HTTPS sozinho, staging igual à produção,
deploy que não derruba ninguém e volta sozinho se der errado, banco com backup fora da máquina, painel trancado e um
teste que reprova a configuração perigosa antes de ela chegar ao servidor. Nasceu de dois projetos reais em produção
(um app Hono + Postgres e uma plataforma Next.js + Supabase) e virou molde.

```
                 DNS (registros A)                     ┌──────────────── VPS Ubuntu 24.04 ─────────────────────────┐
 usuários ─────► app.dominio / dev.dominio ──:443────► │ Traefik (único com porta) ──► stack meuapp      (main)   │
 você (seu IP) ─► painel.dominio ─────────────:443────► │   │  HTTPS Let's Encrypt     └► stack meuapp-dev  (dev)    │
                                                       │   └─ rede "painel" ─► Portainer (só seu IP)               │
 GitHub Actions ─ ssh deploy@ (só roda o ci-deploy) ─► │ ci-deploy: build → troca start-first → espera saudável   │
                                                       │ Postgres (rede "banco"): meuapp + meuapp_dev, 1 papel cada│
                                                       │ backup 03:30 ──────────────────────────────► S3 de fora   │
                                                       └───────────────────────────────────────────────────────────┘
```

## Como usar esta skill

1. **Leia antes de agir:** [references/01-arquitetura.md](references/01-arquitetura.md) (o desenho e os princípios
   que não se negociam). Depois, só a referência da fase em que você está.
2. **Copie os moldes** de `assets/` para o projeto e troque os marcadores (tabela abaixo). Os moldes já passaram por
   shellcheck, actionlint, `docker compose config` e pelo teste da pasta; adapte, não reescreva do zero.
3. **Uma fase por vez, cada uma com o "pronto quando" provado** (comando e saída), nunca só "deve funcionar".
4. **O que é da pessoa fica com a pessoa** (lista abaixo). Você prepara, explica o passo a passo e espera.

### Os moldes (`assets/`)

| Molde | Vai para | O que é |
|---|---|---|
| `infra/setup-server.sh` | `infra/` | prepara o Ubuntu zerado: Docker, Swarm, redes, ufw, fail2ban, SSH só chave, swap, cron do backup |
| `infra/traefik.yml` | `infra/` | a única porta do servidor (80/443), certificados, log sem caminho/cabeçalho/IP |
| `infra/portainer.yml` | `infra/` | painel só para os seus IPs, fora da rede do app |
| `infra/postgres.yml` + `postgres-app-role.sh` | `infra/` | Postgres sem porta, um papel sem superusuário por ambiente |
| `infra/backup-postgres.sh` | `infra/` | dump diário conferido + cópia para S3 de outro provedor |
| `infra/stack.yml` + `stacks/{prod,dev}.env` | `infra/` | a stack do app (molde único para os dois ambientes), sem queda |
| `infra/ci-deploy.sh`, `setup-deploy-user.sh`, `prune-images.sh` | `infra/` | o deploy no servidor, o usuário `deploy` preso a ele, a limpeza |
| `infra/infra.test.mjs` | `infra/` | as regras acima viram teste (`node --test infra/infra.test.mjs`) |
| `github/workflows/deploy-{staging,prod}.yml` | `.github/workflows/` | dev → staging; merge dev→main → produção com a imagem testada |
| `githooks/pre-push` | `.githooks/` | as checagens antes de publicar, sem gastar minutos de Actions |

### Marcadores para trocar

| Marcador | Exemplo | Onde |
|---|---|---|
| `meuapp` | nome curto do projeto, minúsculo | `ci-deploy.sh` (APP), `stacks/*.env` (ROTA), workflows (comentários) |
| `seudominio.com.br` | o domínio da pessoa | `stacks/*.env`, comando do Portainer |
| `SERVIDOR` | o IP ou nome do servidor | comandos de SSH (nunca no repositório público) |
| `SEU_IP` | o IP de casa da pessoa (`curl -s https://ifconfig.me`) | `IPS_CONFIAVEIS`, `PAINEL_IPS` |
| `SERVICOS` | `"app"` ou `"api web"` | `ci-deploy.sh`, e um bloco por serviço na `stack.yml` |
| porta `3000`, `/health` | a porta e a rota de saúde do app | `stack.yml`, Dockerfile, workflows |

## As fases

Cada fase tem a referência com o passo a passo, os comandos e as armadilhas. **Pronto quando** é o que você mostra.

| # | Fase | Referência | Pronto quando |
|---|---|---|---|
| 0 | Decisões e inventário | [01-arquitetura](references/01-arquitetura.md), [07-sair-de-paas](references/07-sair-de-paas-e-virada.md) | domínios, provedor, e-mail, backup e o que o app usa do PaaS escritos num ADR ou nota |
| 1 | Servidor | [02-servidor-e-seguranca](references/02-servidor-e-seguranca.md) | de fora, só 22/80/443 respondem; `sshd -T` diz `passwordauthentication no`; fail2ban com o IP de casa |
| 2 | Traefik e painel | [03-traefik-e-portainer](references/03-traefik-e-portainer.md) | `https://painel.…` abre com certificado válido do seu IP e dá 403 de outro |
| 3 | Banco e backup | [04-postgres-e-backup](references/04-postgres-e-backup.md) | papel do staging recebe `permission denied` no banco da produção; um backup restaurado num Postgres de ensaio |
| 4 | App em contêiner | [05-app-e-deploy-sem-queda](references/05-app-e-deploy-sem-queda.md) | a mesma imagem sobe com env de staging e de produção; `/health` devolve `commit` e `versao` |
| 5 | Pipeline | [06-pipeline-dev-staging-main](references/06-pipeline-dev-staging-main.md) | push na dev publica o staging; merge dev→main publica a produção sem novo build; sonda de fora sem nenhum 5xx durante a troca |
| 6 | Virada | [07-sair-de-paas-e-virada](references/07-sair-de-paas-e-virada.md) | ensaio cronometrado, virada com o app parado na origem, tabelas conferidas linha a linha, origem parada (não apagada) |
| — | Operação e armadilhas | [08-operacao-e-armadilhas](references/08-operacao-e-armadilhas.md) | — leia antes de debugar qualquer coisa |

## Inegociáveis

- **Só o Traefik publica porta.** Porta publicada por contêiner passa por fora do ufw. O teste reprova.
- **Versão fixa em toda imagem, nunca `latest`.** O rollback do Swarm precisa de uma versão anterior de verdade.
- **Segredo nunca no repositório, no chat, em log nem em linha de comando.** Vai pela entrada do SSH para
  `/opt/deploy/segredos/<ambiente>.env` (600, dono `deploy`). No repositório, só os nomes.
- **Quem tem push publica código; quem muda a infra é o root.** O `ci-deploy` só usa do pacote o contexto do build;
  `stack.yml`, valores por ambiente e scripts vêm de `/opt/deploy/infra` (`setup-deploy-user.sh --infra`).
- **A imagem testada no staging é a que vai para a produção.** Nada de "build de novo na main".
- **Nunca o sistema rodando em dois lugares ao mesmo tempo** (jobs e webhooks em dobro). Na virada, a origem para
  antes de o destino subir.
- **Backup só conta se está fora do servidor e já foi restaurado uma vez.**
- **Prove que cada checagem falha** antes de confiar nela: quebre a regra de propósito e veja o vermelho.

## O que é da pessoa (não faça por ela)

- Contratar a VPS, o domínio e o S3 de backup; criar registros no DNS (você entrega a tabela exata).
- Pôr a chave SSH dela pelo painel do provedor e conferir a impressão digital do servidor no console.
- **Criar o admin do Portainer** (nos 5 minutos depois do deploy dele): a senha é dela.
- Colar segredos de terceiros (chaves de API, senha de e-mail). Você gera os que dá para gerar (`openssl rand`) e os
  manda direto ao servidor, sem mostrar.
- Decidir a hora da virada e avisar os clientes (LGPD: troca de suboperador de hospedagem).

Comandos de SSH: sempre `-o BatchMode=yes -o IdentitiesOnly=yes -i <chave>` (chave errada conta para o fail2ban), e
nunca teste login em laço. Para esperar um bloqueio passar, teste só a porta (`nc -z SERVIDOR 22`).
