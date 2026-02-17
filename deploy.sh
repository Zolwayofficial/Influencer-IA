#!/bin/bash
set -e

# ============================================================
# INFLUENCER 3D POWERHOUSE - Script de Despliegue
# ============================================================
# Uso:
#   ./deploy.sh setup    - Primera vez: configura todo
#   ./deploy.sh up       - Levanta todos los servicios
#   ./deploy.sh down     - Detiene todos los servicios
#   ./deploy.sh restart  - Reinicia todos los servicios
#   ./deploy.sh logs     - Ver logs de todos los servicios
#   ./deploy.sh status   - Ver estado de todos los contenedores
#   ./deploy.sh pull     - Actualizar imagenes Docker
# ============================================================

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[x]${NC} $1"; exit 1; }
info() { echo -e "${BLUE}[i]${NC} $1"; }

# Archivos compose en orden de dependencia
COMPOSE_FILES=(
  "docker-compose.data.yml"
  "docker-compose.infra.yml"
  "docker-compose.brain.yml"
  "docker-compose.media.yml"
)

compose_cmd() {
  local action=$1
  shift
  for f in "${COMPOSE_FILES[@]}"; do
    docker compose -f "$f" $action "$@"
  done
}

# --- SETUP: Primera vez ---
cmd_setup() {
  log "Configuracion inicial del Influencer 3D Powerhouse"
  echo ""

  # Verificar Docker
  if ! command -v docker &> /dev/null; then
    error "Docker no esta instalado. Ejecuta: apt-get install -y docker.io docker-compose-plugin"
  fi

  # Verificar .env
  if [ ! -f .env ]; then
    if [ -f .env.example ]; then
      cp .env.example .env
      warn "Archivo .env creado desde .env.example"
      warn "IMPORTANTE: Edita .env con tus valores reales: nano .env"
    else
      error "No se encontro .env ni .env.example"
    fi
  else
    info ".env ya existe"
  fi

  # Crear acme.json para Traefik (permisos estrictos)
  if [ ! -f traefik/acme.json ]; then
    touch traefik/acme.json
    chmod 600 traefik/acme.json
    log "traefik/acme.json creado"
  fi

  # Crear redes Docker compartidas
  log "Creando redes Docker..."
  docker network create influencer_brain-net 2>/dev/null || info "Red brain-net ya existe"
  docker network create influencer_media-net 2>/dev/null || info "Red media-net ya existe"
  docker network create influencer_data-net  2>/dev/null || info "Red data-net ya existe"
  docker network create influencer_infra-net 2>/dev/null || info "Red infra-net ya existe"

  # Permisos del script de creacion de DBs
  chmod +x scripts/create-multiple-dbs.sh 2>/dev/null || true

  # Permisos del entrypoint del compositor
  chmod +x stream-compositor/scripts/entrypoint.sh 2>/dev/null || true

  # Optimizacion del kernel
  log "Aplicando optimizaciones del kernel..."
  sysctl -w fs.inotify.max_user_watches=524288 2>/dev/null || true
  sysctl -w net.core.rmem_max=2500000 2>/dev/null || true

  # Persistir optimizaciones
  grep -q "fs.inotify.max_user_watches" /etc/sysctl.conf 2>/dev/null || \
    echo "fs.inotify.max_user_watches=524288" >> /etc/sysctl.conf
  grep -q "net.core.rmem_max" /etc/sysctl.conf 2>/dev/null || \
    echo "net.core.rmem_max=2500000" >> /etc/sysctl.conf

  echo ""
  log "Setup completado!"
  echo ""
  info "Proximos pasos:"
  echo "  1. Edita .env con tus valores: nano .env"
  echo "  2. Pon tu avatar en: avatar-frontend/dist/models/avatar.glb"
  echo "  3. Pon tus animaciones en: avatar-frontend/dist/animations/"
  echo "  4. Levanta los servicios: ./deploy.sh up"
  echo "  5. Descarga el modelo de Ollama: docker exec influencer-ollama ollama pull qwen2.5:7b"
}

# --- UP: Levantar servicios ---
cmd_up() {
  log "Levantando servicios..."
  echo ""

  # Crear redes si no existen
  docker network create influencer_brain-net 2>/dev/null || true
  docker network create influencer_media-net 2>/dev/null || true
  docker network create influencer_data-net  2>/dev/null || true
  docker network create influencer_infra-net 2>/dev/null || true

  # Levantar en orden
  for f in "${COMPOSE_FILES[@]}"; do
    info "Desplegando $f..."
    docker compose -f "$f" up -d --build
    sleep 3
  done

  echo ""
  log "Todos los servicios levantados!"
  echo ""
  cmd_status
}

# --- DOWN: Detener servicios ---
cmd_down() {
  log "Deteniendo servicios..."
  # Detener en orden inverso
  for (( i=${#COMPOSE_FILES[@]}-1 ; i>=0 ; i-- )); do
    docker compose -f "${COMPOSE_FILES[$i]}" down
  done
  log "Todos los servicios detenidos"
}

# --- RESTART ---
cmd_restart() {
  cmd_down
  sleep 2
  cmd_up
}

# --- LOGS ---
cmd_logs() {
  local service=${1:-""}
  if [ -n "$service" ]; then
    docker logs -f "influencer-$service"
  else
    compose_cmd logs -f --tail=50
  fi
}

# --- STATUS ---
cmd_status() {
  echo ""
  info "Estado de contenedores:"
  echo "-------------------------------------------"
  docker ps --filter "name=influencer-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | sort
  echo ""
}

# --- PULL ---
cmd_pull() {
  log "Actualizando imagenes Docker..."
  compose_cmd pull
  log "Imagenes actualizadas. Ejecuta './deploy.sh up' para aplicar."
}

# --- HEALTH CHECK ---
cmd_health() {
  info "Verificando salud de servicios..."
  echo ""

  check() {
    local name=$1
    local url=$2
    if curl -sf "$url" > /dev/null 2>&1; then
      echo -e "  ${GREEN}OK${NC}  $name"
    else
      echo -e "  ${RED}FAIL${NC}  $name ($url)"
    fi
  }

  check "Ollama"           "http://localhost:11434/api/tags"
  check "Qdrant"           "http://localhost:6333/healthz"
  check "HeadTTS"          "http://localhost:3001/health"
  check "Chat Bridge"      "http://localhost:4000/health"
  check "Stream Compositor" "http://localhost:5000/health"
  check "MediaMTX"         "http://localhost:9997/v3/paths/list"
  check "Prometheus"       "http://localhost:9090/-/healthy"

  echo ""
}

# --- MAIN ---
case "${1:-help}" in
  setup)   cmd_setup ;;
  up)      cmd_up ;;
  down)    cmd_down ;;
  restart) cmd_restart ;;
  logs)    cmd_logs "$2" ;;
  status)  cmd_status ;;
  pull)    cmd_pull ;;
  health)  cmd_health ;;
  *)
    echo "Uso: $0 {setup|up|down|restart|logs|status|pull|health}"
    echo ""
    echo "  setup    - Configuracion inicial (primera vez)"
    echo "  up       - Levantar todos los servicios"
    echo "  down     - Detener todos los servicios"
    echo "  restart  - Reiniciar todos los servicios"
    echo "  logs     - Ver logs (opcion: logs <servicio>)"
    echo "  status   - Ver estado de contenedores"
    echo "  pull     - Actualizar imagenes Docker"
    echo "  health   - Verificar salud de servicios"
    ;;
esac
