# 04 · Postgres, papéis por ambiente e backup

## Subir o Postgres

A senha do superusuário nasce no servidor e não passa pelo chat:

```bash
$SSH root@SERVIDOR 'umask 077; [ -f /opt/infra/postgres.env ] || echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > /opt/infra/postgres.env'
$SSH root@SERVIDOR 'cd /opt/infra && set -a && . ./postgres.env && set +a && docker stack deploy -c postgres.yml postgres'
$SSH root@SERVIDOR 'docker service ps postgres_postgres --format "{{.CurrentState}}"'
```

(Quem prefere editar pelo Portainer pode criar a stack lá, colando o `postgres.yml` e pondo `POSTGRES_PASSWORD` nas
variáveis da stack. Escolha um dos dois jeitos e fique nele.)

O que o molde garante: versão fixa; volume em `/var/lib/postgresql` (mudou no Postgres 18: os dados ficam em
`18/docker` dentro dele); sem porta; só na rede `banco`; **`stop-first`** (dois Postgres no mesmo volume corrompem os
dados); `stop_grace_period` de 60 s para o checkpoint.

## Um papel por ambiente, nunca o superusuário

```bash
SSH_OPTS="-o IdentitiesOnly=yes -i ~/.ssh/id_ed25519" PAPEL=meuapp     infra/postgres-app-role.sh root@SERVIDOR ~/.config/meuapp/database.env
SSH_OPTS="-o IdentitiesOnly=yes -i ~/.ssh/id_ed25519" PAPEL=meuapp_dev infra/postgres-app-role.sh root@SERVIDOR ~/.config/meuapp/database-dev.env
```

Cada chamada cria (ou acerta) o papel `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`, o banco de mesmo nome
com ele de dono, tira o `CONNECT` do `PUBLIC` e passa para o papel o que as migrações tinham criado como `postgres`.
A senha nasce aleatória no arquivo local (600) e vai ao servidor pela entrada do SSH. Depois, a `DATABASE_URL` de
cada arquivo entra nos segredos do ambiente (06).

ORMs que guardam o histórico em outro esquema (Drizzle: `drizzle`; Prisma: `_prisma_migrations` fica no `public`):
`ESQUEMAS="public drizzle"`.

**Pronto quando** o papel do staging não abre o banco da produção:

```bash
$SSH root@SERVIDOR "docker exec \$(docker ps -q -f name=postgres_postgres) psql -U meuapp_dev -d meuapp -c 'select 1'" 
# esperado: FATAL:  permission denied for database "meuapp"
```

Pelo socket local a imagem oficial não pede senha (`trust`), então o teste mede exatamente o privilégio `CONNECT`,
que vale igual para o app, que entra pela rede com senha (`scram-sha-256`). Mostre também o caminho feliz: o mesmo
comando com `-U meuapp -d meuapp` devolve `1`.

## Migrações

Rode as migrações **num lugar só e com trava**: ou o app as aplica ao subir, segurando um
`pg_advisory_lock` dedicado (duas instâncias num deploy start-first não aplicam a mesma migração duas vezes), ou um
passo do `ci-deploy` antes da troca (`docker run --rm --network banco meuapp-app:<tag> npm run migrar`). Nunca as duas.
Migração que apaga ou renomeia coluna quebra a versão antiga, que ainda atende por segundos no start-first: faça em
duas publicações (primeiro o código que não usa mais, depois a migração que apaga).

## Backup

O `backup-postgres.sh` roda às 03:30 (cron do `setup-server.sh`): `pg_dumpall` comprimido, **conferido** (gzip íntegro
e a linha final "dump complete" do `pg_dumpall`, para um dump truncado nunca virar "o backup de hoje"), 7 dias no
disco e, com `/opt/infra/backup-fora.env`, uma cópia para S3 de **outro provedor** pelo rclone (versão fixa).

Para o backup de fora:

1. A pessoa cria um bucket num provedor diferente do servidor (Cloudflare R2, Backblaze B2, Wasabi, AWS) com
   **versionamento ou retenção** (object lock), e uma chave que **só grava** naquele bucket.
2. Você monta o `backup-fora.env` no servidor (o modelo está no topo do script) sem a chave passar pelo chat: a
   pessoa cola num arquivo local e você o manda pela entrada do SSH (`... 'umask 077; cat > /opt/infra/backup-fora.env' < arquivo`).
3. `bash /opt/infra/backup-postgres.sh` uma vez à mão e a saída mostra o caminho de fora.

**Ensaio de restauração (uma vez por mês, e antes de qualquer virada):**

```bash
$SSH root@SERVIDOR 'docker run -d --name ensaio --network none -e POSTGRES_PASSWORD=ensaio postgres:18.6 && sleep 8 \
  && gunzip -c $(ls -t /var/backups/postgres/*.sql.gz | head -1) | docker exec -i ensaio psql -U postgres -q 2>&1 | grep -v "already exists" | tail -5 \
  && docker exec ensaio psql -U postgres -d meuapp -Atc "select count(*) from information_schema.tables where table_schema = '\''public'\''"; \
  docker rm -f ensaio'
```

O único erro esperado é `role "postgres" already exists`. Compare a contagem de tabelas (e as linhas das principais)
com a produção. Escreva a data e o tempo do ensaio no README da infra.

Precisa perder menos de um dia de dados (RPO < 24 h)? Acrescente arquivamento contínuo do WAL (WAL-G ou pgBackRest
para o mesmo S3) e ensaie a recuperação até um instante.

## Variante Supabase (auto-hospedado)

Para quem sai do Supabase gerenciado e o app depende de Auth, PostgREST, Storage ou Realtime: em vez do
`postgres:18.x`, a imagem `supabase/postgres` (versão fixa: traz `pg_cron`, `pg_net`, Vault e os papéis `anon`,
`authenticated`, `service_role`), mais os serviços em contêiner (GoTrue, PostgREST, Storage API, Realtime), com
versões fixas, atrás do Traefik **no mesmo domínio do app, por caminho**: `/auth/v1`, `/rest/v1`, `/storage/v1`,
`/realtime/v1` (o cliente `supabase-js` só precisa da URL nova). Use o `docker-compose.yml` oficial do repositório
`supabase/supabase` (pasta `docker/`) como referência das variáveis, convertido para stack do Swarm (sem `ports:`,
sem `container_name`, sem `depends_on`, labels em `deploy.labels`).

Pontos que mordem:

- **JWT:** gere um `JWT_SECRET` novo e, a partir dele, as chaves `anon` e `service_role` (JWT com `role`). Trocar o
  segredo invalida as sessões: todo mundo entra de novo na virada. Avise.
- **Vault:** segredos do Vault **não** confie no dump; recrie-os no destino.
- **`pg_cron` que chama o app (`pg_net`):** só ligue os jobs do banco novo depois que a URL guardada (no Vault ou numa
  tabela de configuração) apontar para o domínio novo; senão o banco novo chama o app velho.
- **Storage:** os arquivos dos buckets vão com o rclone (S3 → S3), e URLs **absolutas** guardadas no banco
  (`https://xyz.supabase.co/storage/v1/...`) precisam de um `update` na virada.
- **Auth:** usuários, MFA (TOTP) e identidades vêm no dump do esquema `auth`; reconfira os templates de e-mail, as
  URLs de redirecionamento permitidas e o SMTP (o do Supabase gerenciado não vem junto).
- O banco do staging é **outro Postgres** (outra stack), não outro banco no mesmo: os papéis do Supabase são globais
  ao cluster.
