# Skills do Wellington para Claude Code

Três skills, empacotadas no plugin **`plataforma-pronta`**, que levam qualquer projeto web para um padrão de produção
de time grande, mesmo com um time pequeno:

| Skill | Para quê |
|---|---|
| [`vps-de-producao`](plugins/plataforma-pronta/skills/vps-de-producao/SKILL.md) | Sobe o projeto numa VPS própria com Docker Swarm, Traefik (HTTPS sozinho), Portainer trancado por IP, Postgres com papel por ambiente e backup fora do servidor, **staging (`dev`) e produção (`main`)** no mesmo servidor, deploy **sem queda** pelo GitHub Actions com a mesma imagem testada no staging indo para a produção, e o roteiro para sair de Vercel, Supabase, Heroku, Railway ou Render. |
| [`vps-com-dokploy`](plugins/plataforma-pronta/skills/vps-com-dokploy/SKILL.md) | A **sua própria Vercel**: o Dokploy num servidor dedicado, com deploy por push, preview por PR, vários domínios por app com HTTPS, staging e produção pela tela, endurecido (porta do painel trancada no kernel antes de instalar, painel só para os seus IPs) e com deploy que não derruba produção, tudo medido num ensaio. |
| [`brain-e-contratos`](plugins/plataforma-pronta/skills/brain-e-contratos/SKILL.md) | Instala o **Brain**, um mapa vivo da aplicação lido do código (rotas com quem pode chamar, telas, server actions, tabelas com RLS, imports, checagens automáticas de segurança) que abre local e se atualiza a cada arquivo salvo, e os **contratos** de regra de negócio, com ID, testes e casos de borda, checados no CI. |

Elas nasceram de dois sistemas reais em produção, um app Hono + Postgres e uma plataforma Next.js + Supabase
com centenas de rotas. Foram feitas com o Claude Code e depois viraram molde.

## Instalar

No Claude Code:

```
/plugin marketplace add well-prado/claude-skills
/plugin install plataforma-pronta@well-prado
```

Ou só as skills, sem o plugin (copie para a sua pasta de skills):

```bash
git clone https://github.com/well-prado/claude-skills
cp -R claude-skills/plugins/plataforma-pronta/skills/* ~/.claude/skills/
```

## Usar

Peça com as suas palavras; a skill certa é carregada sozinha. Por exemplo:

- "Quero tirar este projeto da Vercel e do Supabase e subir na minha VPS da Contabo, com staging e produção."
- "Monta o deploy sem queda pelo GitHub Actions para o meu servidor."
- "Instala o brain neste projeto e escreve os contratos das áreas de pagamento e acesso."
- "Quais rotas e ações gravam sem guarda?"
- "Quero a minha própria Vercel com o Dokploy, com preview por PR e vários domínios."

## O que vem em cada uma

**`vps-de-producao`**
- O roteiro em 7 fases, cada uma com o "pronto quando" que se prova com um comando.
- Moldes testados: `setup-server.sh` (Docker, Swarm, ufw, fail2ban, SSH só por chave), `traefik.yml`,
  `portainer.yml`, `postgres.yml`, o papel do banco por ambiente, o backup conferido com cópia para S3 de fora,
  a `stack.yml` do app sem queda, o `ci-deploy` preso à chave do GitHub, os workflows de staging e produção, o
  `pre-push`, e um teste (`node --test`, sem dependência) que reprova a configuração perigosa: porta publicada fora do
  Traefik, imagem sem versão, log com dado pessoal, painel aberto, segredo no repositório…
- Oito referências: arquitetura, servidor e segurança, DNS/Traefik/painel, Postgres e backup (com a variante Supabase
  auto-hospedado), app e deploy sem queda (Next.js incluído), pipeline, saída de PaaS e virada, operação e armadilhas.

**`vps-com-dokploy`**
- Instalação do Dokploy com versão fixa, a trava da porta 3000 antes de instalar, o admin criado pelo túnel SSH, o
  painel pelo domínio só para os seus IPs e a porta 3000 fechada.
- Configuração de cada app para trocar sem queda e voltar sozinho (sem ela, uma versão quebrada fica no ar com 502),
  e uma Action que confere de fora que o deploy está no ar (o Dokploy diz "done" mesmo quando voltou à versão anterior).
- Vários domínios, staging e produção, previews por PR, bancos e backup, e quando escolher o Dokploy ou a
  `vps-de-producao`.

**`brain-e-contratos`**
- O Brain inicial (`tools/brain`): gerador em ts-morph com coletores para Next.js App Router, Hono/Express e
  migrações SQL, interface local em `127.0.0.1:4319` com busca, e uma linha de comando com `gerar`, `checar` (para o
  CI) e `achados`.
- O formato dos contratos com uma área de exemplo, o método para escrevê-los em paralelo com subagentes, e como ligar
  tudo no dia a dia e no CI.

## Princípios que atravessam todas

- Prova, não promessa: cada fase termina com um comando e a saída esperada; cada checagem foi vista falhar.
- Segredo nunca no repositório, no chat nem em log.
- A imagem testada no staging é a que vai para a produção.
- Nunca o sistema rodando em dois lugares ao mesmo tempo.
- O que é decisão da pessoa (senhas, DNS, a hora da virada) fica com a pessoa.

Escritas em português do Brasil. Contribuições e correções são bem-vindas por issue ou PR.

## Licença

[MIT](LICENSE)
