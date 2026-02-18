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

# --- SETUP: Primera vez ---
cmd_setup() {
  log "Configuracion inicial del Influencer 3D Powerhouse"
  echo ""

  # Verificar Docker
  if ! command -v docker &> /dev/null; then
    error "Docker no esta instalado. Ejecuta: curl -fsSL https://get.docker.com | bash"
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
    mkdir -p traefik
    touch traefik/acme.json
    chmod 600 traefik/acme.json
    log "traefik/acme.json creado"
  fi

  # Permisos
  chmod +x scripts/create-multiple-dbs.sh 2>/dev/null || true
  chmod +x stream-compositor/scripts/entrypoint.sh 2>/dev/null || true

  # Optimizacion del kernel
  log "Aplicando optimizaciones del kernel..."
  sysctl -w fs.inotify.max_user_watches=524288 2>/dev/null || true
  sysctl -w net.core.rmem_max=2500000 2>/dev/null || true

  echo ""
  log "Setup completado!"
  echo ""
  info "Proximos pasos:"
  echo "  1. Edita .env con tus valores: nano .env"
  echo "  2. Pon tu avatar en: avatar-frontend/dist/models/avatar.glb"
  echo "  3. Pon tus animaciones en: avatar-frontend/dist/animations/"
  echo "  4. Levanta los servicios: ./deploy.sh up"
}

# --- UP: Levantar servicios ---
cmd_up() {
  log "Levantando servicios..."
  echo ""
  docker compose up -d --build
  echo ""
  log "Todos los servicios levantados!"
  echo ""
  cmd_status
}

# --- DOWN: Detener servicios ---
cmd_down() {
  log "Deteniendo servicios..."
  docker compose down
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
    docker compose logs -f --tail=50
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
  docker compose pull
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

  check "Qdrant"           "http://localhost:6333/healthz"
  check "HeadTTS"          "http://localhost:8882"
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
