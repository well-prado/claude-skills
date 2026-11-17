# 01 · A arquitetura e os princípios

## O desenho

Um servidor Ubuntu 24.04, um Docker Swarm de **um nó só**, e quatro stacks:

| Stack | Arquivo | Redes | Publica porta? | Sobe por |
|---|---|---|---|---|
| `traefik` | `infra/traefik.yml` | `traefik-public`, `painel` | **sim, só 80 e 443** (modo host) | linha de comando |
| `portainer` | `infra/portainer.yml` | `painel`, `agent_network` | não | linha de comando |
| `postgres` | `infra/postgres.yml` | `banco` | não | linha de comando ou Portainer |
| `meuapp` e `meuapp-dev` | `infra/stack.yml` (molde único) | `traefik-public`, `banco` | não | `ci-deploy` (Actions) |

As três redes são criadas pelo `setup-server.sh` e cada uma separa uma coisa:

- **`traefik-public`** (overlay, attachable): onde o Traefik encontra os apps. O Postgres não está nela.
- **`painel`** (overlay, **não** attachable): só o Traefik e o Portainer. Um contêiner do app comprometido não chega
  ao painel por dentro, e nenhum `docker run --network painel` avulso entra.
- **`banco`** (overlay, não attachable): só o Postgres e os apps. O Traefik nunca enxerga o banco.

Staging e produção vivem **no mesmo servidor**, com stacks, domínios, papéis e bancos separados. O staging tem
limites de memória menores e `noindex`. Isso custa zero a mais e garante que o staging é *de verdade* igual à
produção (mesmo kernel, mesmo Docker, mesmo Traefik, mesmo Postgres).

## Por que Swarm de um nó (e não Compose, nem Kubernetes)

- **Contra o `docker compose up`:** o Swarm dá, de graça, a troca `start-first` (a versão nova sobe e fica saudável
  antes de a antiga sair), o **rollback automático** quando a nova não fica saudável, o endereço virtual do serviço
  (que o Traefik usa para não dar 502 na troca) e o `docker stack deploy` declarativo. Com Compose, cada um disso é
  script seu.
- **Contra o Kubernetes:** para um servidor e um time pequeno, o k8s custa mais do que entrega (control plane,
  manifests, ingress, cert-manager). O Swarm é o mesmo `docker` que todo mundo já sabe, e o arquivo da stack é quase
  um Compose.
- **Quando mudar de ideia:** mais de um servidor de app por carga (o Swarm escala para N nós, mas o Postgres não vem
  junto: aí o banco vai para um gerenciado ou um primário+réplica), ou exigência de SLA que um nó só não cumpre.

## Tamanho

Um servidor de 6 vCPU, 12 GB de RAM e 200 GB de disco aguenta com folga produção + staging de um app Node com algumas
centenas de usuários simultâneos, o Postgres e os backups. Meça com `docker stats` depois de subir e ajuste os
limites de memória em `infra/stacks/*.env`. Num deploy `start-first` duas instâncias convivem por segundos: deixe
folga para isso.

## Os princípios

1. **Tudo em arquivo, no repositório.** O servidor pode ser refeito do zero em ~15 minutos a partir de `infra/`. Nada
   de configuração feita à mão que só existe na máquina, exceto os segredos.
2. **Uma porta só.** O Traefik publica 80 e 443; nenhuma outra stack tem `ports:`. Porta que um contêiner publica
   passa por fora do ufw, então essa regra é a firewall de verdade. O `infra.test.mjs` reprova.
3. **Versão fixa em tudo.** `traefik:v3.7.15`, `postgres:18.6`, `meuapp-app:<commit>`. Tag móvel (`latest`, `22`,
   `lts`) faz o rollback voltar para a mesma imagem e faz o servidor rodar uma versão que ninguém escolheu.
4. **A mesma imagem do staging vai para a produção.** O merge dev→main só é publicado se o código for idêntico ao da
   dev e se aquele commit passou pelo staging; a imagem é reaproveitada, não reconstruída. Para isso a imagem não
   pode ter nada do ambiente embutido (ver 05).
5. **Segredo só no servidor.** `/opt/deploy/segredos/<ambiente>.env`, 600, dono `deploy`, enviado pela entrada do
   SSH. O GitHub guarda só a chave do deploy e a impressão do servidor.
6. **Cada chave do GitHub faz uma coisa só, e a infra é do root.** O usuário `deploy` tem uma chave por ambiente,
   cada uma presa ao `ci-deploy` com o seu ambiente (`command=`, sem shell, túnel, agente nem pty), e o `ci-deploy` só usa do pacote recebido o contexto do build: a
   `stack.yml`, os valores por ambiente e os scripts são cópias que o root instalou. Vazou a chave (ou alguém com push
   na `dev` age de má-fé)? Ela publica código no ambiente dela, o que já é grave (troque a chave), mas não abre shell,
   não muda a infra, não publica na produção e não promove para lá uma imagem de outro código (a produção só
   reaproveita imagem cujo rótulo de conteúdo bate com o código do merge). Os secrets do GitHub ficam em Environments presos às branches.
7. **Nunca em dois lugares ao mesmo tempo.** Jobs de fundo, webhooks de saída e crons rodariam em dobro. Na virada a
   origem para antes do destino subir; num deploy, os jobs seguem um lock de líder no Postgres.
8. **Log sem segredo e sem dado pessoal.** O Traefik grava método, host, status e tempos; nunca o caminho (tokens na
   URL), os cabeçalhos ou o IP.
9. **Backup fora, e restaurado.** Dump diário conferido + cópia para S3 de outro provedor + ensaio de restauração.
10. **Prova, não promessa.** Cada fase termina com um comando e a saída que mostram o "pronto quando". Cada
    checagem foi vista falhar antes de ser vista passar.

## O registro da decisão (ADR)

Antes da fase 1, escreva um ADR curto no projeto (`docs/adr/NNNN-servidor-proprio.md`) com: contexto (por que sair
do PaaS, custos), decisão (este desenho, as fases), premissas (domínios, provedor de e-mail, onde fica o backup),
consequências (o que o time passa a operar), riscos e resposta, e **"muda de ideia se"** (os gatilhos para voltar
ou para crescer). Se o projeto já tem um ADR do PaaS, marque-o como substituído pelo novo.
