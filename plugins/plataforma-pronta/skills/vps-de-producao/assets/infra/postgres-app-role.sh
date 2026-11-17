#!/usr/bin/env bash
# Cria (ou acerta) o papel do Postgres de um ambiente: dono só do banco dele, sem superusuário, sem criar banco nem
# papel, sem passar por cima do RLS. O "postgres" fica para o backup e a virada.
# Roda do seu computador; a senha vai pela entrada do ssh, nunca pela linha de comando (não aparece no ps nem no log).
#   infra/postgres-app-role.sh root@SERVIDOR ~/.config/meuapp/database.env        # produção
#   infra/postgres-app-role.sh root@SERVIDOR ~/.config/meuapp/database-dev.env    # staging
# O arquivo guarda a DATABASE_URL do ambiente (postgres://PAPEL:SENHA@postgres:5432/BANCO). Se não existir, é criado
# com uma senha aleatória, legível só por você. O banco é criado se faltar. Pode rodar de novo: a senha volta a ser a
# do arquivo, e o que as migrações criaram como "postgres" passa para o papel.
# ESQUEMAS (opcional): os esquemas cujos objetos passam para o papel (padrão "public"; ex.: "public drizzle").
# SSH_OPTS (opcional): ex. "-o IdentitiesOnly=yes -i ~/.ssh/id_ed25519" (chave errada conta para o fail2ban).
set -euo pipefail
USAGE="uso: infra/postgres-app-role.sh root@SERVIDOR ARQUIVO.env"
HOST=${1:?$USAGE}
FILE=${2:?$USAGE}
ESQUEMAS=${ESQUEMAS:-public}
# shellcheck disable=SC2206 # SSH_OPTS é uma lista de opções, dividida de propósito
SSH=(ssh ${SSH_OPTS:-})

if [ ! -e "$FILE" ]; then
  base=$(basename "$FILE" .env)
  nome=${PAPEL:-}
  [ -n "$nome" ] || { echo "$FILE não existe: rode com PAPEL=<nome do papel e do banco> para criar (ex.: PAPEL=meuapp_dev)" >&2; exit 1; }
  (umask 077 && mkdir -p "$(dirname "$FILE")" \
    && printf 'DATABASE_URL=postgres://%s:%s@postgres:5432/%s\n' "$nome" "$(openssl rand -hex 24)" "$nome" > "$FILE")
  echo "criado $FILE (senha nova; arquivo $base só seu)"
fi
URL=$(sed -n 's/^DATABASE_URL=//p' "$FILE" | tail -n 1)
# Só letras e números na senha: ela vai na URL sem escapar e no SQL abaixo.
RE='^postgres(ql)?://([a-z_][a-z0-9_]*):([A-Za-z0-9]+)@[^/@]+/([a-z_][a-z0-9_]*)$'
if ! [[ $URL =~ $RE ]]; then
  echo "$FILE: a DATABASE_URL tem de ser postgres://PAPEL:SENHA@postgres:5432/BANCO, com a senha só de letras e números" >&2
  exit 1
fi
ROLE=${BASH_REMATCH[2]} PASSWORD=${BASH_REMATCH[3]} DB=${BASH_REMATCH[4]}
[ "$ROLE" != postgres ] || { echo "$FILE: o app não entra como o superusuário postgres; use outro papel" >&2; exit 1; }
for e in $ESQUEMAS; do [[ $e =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "esquema inválido: $e" >&2; exit 1; }; done
PG="docker exec -i \$(docker ps -q -f name=postgres_postgres | head -1) psql -X -q -v ON_ERROR_STOP=1 -U postgres"

# 1) O papel e o banco (CREATE DATABASE não roda dentro de bloco DO, por isso o \gexec).
{
  printf "SET app.papel = '%s';\nSET app.senha = '%s';\nSET app.banco = '%s';\n" "$ROLE" "$PASSWORD" "$DB"
  cat <<'SQL'
DO $$
DECLARE app text := current_setting('app.papel');
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = app) THEN EXECUTE format('CREATE ROLE %I', app); END IF;
  EXECUTE format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
    app, current_setting('app.senha'));
END $$;
SELECT format('CREATE DATABASE %I OWNER %I', current_setting('app.banco'), current_setting('app.papel'))
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = current_setting('app.banco'))\gexec
SQL
} | "${SSH[@]}" "$HOST" "$PG -d postgres"

# 2) Dentro do banco: dono do banco, dos esquemas e do que as migrações criaram como postgres.
{
  printf "SET app.papel = '%s';\nSET app.esquemas = '%s';\n" "$ROLE" "$ESQUEMAS"
  cat <<'SQL'
-- Uma tabela em uso segura a troca no máximo 10 s; se falhar, nada muda e o script pode rodar de novo.
SET lock_timeout = '10s';
DO $$
DECLARE
  app text := current_setting('app.papel');
  esquemas text[] := string_to_array(current_setting('app.esquemas'), ' ');
  r record;
BEGIN
  EXECUTE format('ALTER DATABASE %I OWNER TO %I', current_database(), app);
  -- Ninguém além do dono conecta neste banco (o papel do staging não abre o banco da produção, e vice-versa).
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  FOR r IN SELECT nspname FROM pg_namespace WHERE nspname = ANY (esquemas) LOOP
    EXECUTE format('ALTER SCHEMA %I OWNER TO %I', r.nspname, app);
  END LOOP;
  -- ALTER TABLE também leva views e sequências; índices e sequências de colunas identity/serial seguem a tabela.
  FOR r IN
    SELECT c.oid::regclass AS rel FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ANY (esquemas) AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
      AND NOT EXISTS (SELECT FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype IN ('a', 'i'))
  LOOP
    EXECUTE format('ALTER TABLE %s OWNER TO %I', r.rel, app);
  END LOOP;
END
$$;
SQL
} | "${SSH[@]}" "$HOST" "$PG -d $DB"
echo "papel $ROLE pronto, dono do banco $DB. A DATABASE_URL está em $FILE: copie-a para o arquivo de segredos do ambiente no servidor (references/06-pipeline-dev-staging-main.md)."
