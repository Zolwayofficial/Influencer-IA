#!/bin/bash
set -e

# ============================================================
# BACKUP AUTOMATICO - Influencer 3D Powerhouse
# ============================================================
# Ejecutar: ./scripts/backup.sh
# Programar con cron: 0 3 * * * /opt/influencer/scripts/backup.sh
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups/influencer}"
DATE=$(date +%Y-%m-%d_%H-%M)
RETENTION_DAYS=7

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[x]${NC} $1"; }

mkdir -p "$BACKUP_DIR"

echo "============================================"
echo " BACKUP - $DATE"
echo "============================================"

# --- 1. PostgreSQL ---
log "Respaldando PostgreSQL..."
BACKUP_PG="$BACKUP_DIR/postgres_${DATE}.sql.gz"

if docker exec influencer-postgres pg_dumpall -U "${PG_USER:-influencer}" 2>/dev/null | gzip > "$BACKUP_PG"; then
  log "PostgreSQL respaldado: $(du -h "$BACKUP_PG" | cut -f1)"
else
  error "Error respaldando PostgreSQL"
  rm -f "$BACKUP_PG"
fi

# --- 2. Redis ---
log "Respaldando Redis..."
BACKUP_REDIS="$BACKUP_DIR/redis_${DATE}.rdb"

if docker exec influencer-redis redis-cli BGSAVE 2>/dev/null; then
  sleep 2
  docker cp influencer-redis:/data/dump.rdb "$BACKUP_REDIS" 2>/dev/null && \
    log "Redis respaldado: $(du -h "$BACKUP_REDIS" | cut -f1)" || \
    error "Error copiando dump de Redis"
fi

# --- 3. Configuraciones ---
log "Respaldando configuraciones..."
BACKUP_CONFIG="$BACKUP_DIR/config_${DATE}.tar.gz"

tar -czf "$BACKUP_CONFIG" \
  -C "$PROJECT_DIR" \
  .env \
  openclaw/config/ \
  openclaw/skills/ \
  mediamtx/mediamtx.yml \
  prometheus/prometheus.yml \
  avatar-frontend/nginx.conf \
  docker-compose.*.yml \
  2>/dev/null

log "Configuraciones respaldadas: $(du -h "$BACKUP_CONFIG" | cut -f1)"

# --- 4. Cookies (si existen) ---
if [ -d "$PROJECT_DIR/cookies" ] && [ "$(ls -A "$PROJECT_DIR/cookies" 2>/dev/null)" ]; then
  log "Respaldando cookies..."
  BACKUP_COOKIES="$BACKUP_DIR/cookies_${DATE}.tar.gz"
  tar -czf "$BACKUP_COOKIES" -C "$PROJECT_DIR" cookies/ 2>/dev/null
  log "Cookies respaldadas"
fi

# --- 5. Qdrant (snapshots) ---
log "Creando snapshot de Qdrant..."
QDRANT_SNAPSHOT=$(curl -sf -X POST http://localhost:6333/snapshots 2>/dev/null)
if [ $? -eq 0 ]; then
  log "Qdrant snapshot creado"
else
  warn "No se pudo crear snapshot de Qdrant (puede no estar corriendo)"
fi

# --- 6. Limpiar backups antiguos ---
log "Limpiando backups de mas de ${RETENTION_DAYS} dias..."
DELETED=$(find "$BACKUP_DIR" -name "*.gz" -o -name "*.rdb" -mtime +${RETENTION_DAYS} -delete -print | wc -l)
log "Eliminados: ${DELETED} archivos antiguos"

# --- 7. Resumen ---
echo ""
echo "============================================"
log "BACKUP COMPLETADO"
echo "============================================"
echo ""
echo "Ubicacion: $BACKUP_DIR"
echo "Archivos creados:"
ls -lh "$BACKUP_DIR"/*_${DATE}* 2>/dev/null | while read line; do
  echo "  $line"
done

TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
echo ""
echo "Tamano total backups: $TOTAL_SIZE"
echo "Retencion: ${RETENTION_DAYS} dias"
echo ""

# --- Opcional: Subir a MinIO ---
# Descomenta las siguientes lineas para subir backups a MinIO
#
# log "Subiendo a MinIO..."
# for f in "$BACKUP_DIR"/*_${DATE}*; do
#   docker exec -i influencer-minio mc cp "$f" local/backups/$(basename "$f") 2>/dev/null || true
# done
# log "Subida a MinIO completada"
