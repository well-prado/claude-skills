#!/usr/bin/env bash
# Backup do Postgres da stack "postgres": todos os bancos e papéis (pg_dumpall) comprimidos em /var/backups/postgres.
# Roda todo dia às 03:30 (cron instalado pelo setup-server.sh) e guarda os últimos KEEP_DAYS dias (padrão 7).
#
# Backup no mesmo disco protege de erro humano, NÃO da perda do servidor. Por isso, se existir
# /opt/infra/backup-fora.env, cada backup também vai para fora com o rclone (S3 de OUTRO provedor, Backblaze, R2...):
#   RCLONE_CONFIG_FORA_TYPE=s3
#   RCLONE_CONFIG_FORA_PROVIDER=Cloudflare          (ou AWS, Backblaze, Wasabi, Other...)
#   RCLONE_CONFIG_FORA_ENDPOINT=https://...
#   RCLONE_CONFIG_FORA_ACCESS_KEY_ID=...
#   RCLONE_CONFIG_FORA_SECRET_ACCESS_KEY=...
#   BACKUP_DESTINO=fora:nome-do-bucket/postgres
# (chmod 600, dono root; uma chave que só grava naquele bucket, e o bucket com retenção/versão para um invasor no
# servidor não conseguir apagar os backups antigos.)
#
# Restaurar (num Postgres vazio):
#   gunzip -c ARQUIVO.sql.gz | docker exec -i $(docker ps -q -f name=postgres_postgres) psql -U postgres
# Ensaio de restauração todo mês: references/04-postgres-e-backup.md. Backup que nunca foi restaurado não é backup.
set -euo pipefail
DIR=/var/backups/postgres
KEEP_DAYS=${KEEP_DAYS:-7}
FORA=/opt/infra/backup-fora.env
mkdir -p "$DIR"
chmod 700 "$DIR"
c=$(docker ps -q -f name=postgres_postgres | head -1)
[ -n "$c" ] || { echo "$(date -Is) postgres não está rodando"; exit 1; }
f="$DIR/postgres-$(date +%Y%m%d-%H%M).sql.gz"
# Um dump que falha não deixa o .tmp para trás (depois do mv ele já não existe).
trap 'rm -f "$f.tmp"' EXIT
docker exec "$c" pg_dumpall -U postgres | gzip > "$f.tmp"
# Um dump truncado (disco cheio, contêiner caiu no meio) não pode virar "o backup de hoje".
gzip -t "$f.tmp"
fim=$(gzip -dc "$f.tmp" | tail -n 5)
case "$fim" in
  *'PostgreSQL database cluster dump complete'*) ;;
  *) echo "$(date -Is) dump incompleto: $f.tmp"; exit 1 ;;
esac
mv "$f.tmp" "$f"
find "$DIR" -name 'postgres-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
echo "$(date -Is) ok $f ($(du -h "$f" | cut -f1))"

if [ -f "$FORA" ]; then
  destino=$(sed -n 's/^BACKUP_DESTINO=//p' "$FORA" | tail -n 1)
  [ -n "$destino" ] || { echo "$(date -Is) $FORA sem BACKUP_DESTINO"; exit 1; }
  docker run --rm --env-file "$FORA" -v "$DIR":/data:ro rclone/rclone:1.71 \
    copyto "/data/$(basename "$f")" "$destino/$(basename "$f")" --s3-no-check-bucket
  echo "$(date -Is) fora: $destino/$(basename "$f")"
else
  echo "$(date -Is) AVISO: sem $FORA, o backup só existe neste disco"
fi
