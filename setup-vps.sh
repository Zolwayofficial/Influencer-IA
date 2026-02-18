#!/bin/bash
set -e

# ============================================================
# INFLUENCER 3D POWERHOUSE - Instalacion Automatica en VPS
# ============================================================
# Ejecutar como root en Ubuntu 22.04/24.04 LTS:
#   bash setup-vps.sh
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[x]${NC} $1"; exit 1; }
info() { echo -e "${BLUE}[i]${NC} $1"; }

echo ""
echo "=========================================="
echo "  INFLUENCER 3D POWERHOUSE - Setup VPS"
echo "=========================================="
echo ""

# --- Verificar root ---
if [ "$(id -u)" -ne 0 ]; then
  error "Ejecuta este script como root: sudo bash setup-vps.sh"
fi

# --- 1. Actualizar sistema ---
log "Actualizando sistema operativo..."
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq curl wget git htop unzip ufw apt-transport-https ca-certificates gnupg lsb-release apache2-utils

# --- 2. Instalar Docker ---
if command -v docker &> /dev/null; then
  info "Docker ya esta instalado: $(docker --version)"
else
  log "Instalando Docker..."
  curl -fsSL https://get.docker.com | bash
  systemctl enable docker
  systemctl start docker
  log "Docker instalado: $(docker --version)"
fi

# Verificar docker compose plugin
if docker compose version &> /dev/null; then
  info "Docker Compose plugin: $(docker compose version)"
else
  error "Docker Compose plugin no encontrado. Reinstala Docker."
fi

# --- 3. Configurar Firewall ---
log "Configurando firewall UFW..."
ufw --force reset > /dev/null 2>&1
ufw default deny incoming
ufw default allow outgoing

# SSH
ufw allow 22/tcp

# HTTP/HTTPS (Traefik)
ufw allow 80/tcp
ufw allow 443/tcp

# RTMP Streaming
ufw allow 1935/tcp

# SRT Streaming
ufw allow 8890/udp

ufw --force enable
log "Firewall configurado (SSH, HTTP, HTTPS, RTMP, SRT)"

# --- 4. Optimizaciones del kernel ---
log "Aplicando optimizaciones del kernel..."
cat >> /etc/sysctl.conf << 'SYSCTL'

# --- Influencer 3D Powerhouse Optimizations ---
fs.inotify.max_user_watches=524288
net.core.rmem_max=2500000
net.core.wmem_max=2500000
vm.swappiness=10
vm.overcommit_memory=1
SYSCTL
sysctl -p > /dev/null 2>&1

# --- 5. Crear swap (4GB por seguridad) ---
if [ ! -f /swapfile ]; then
  log "Creando swap de 4GB..."
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  log "Swap de 4GB activado"
else
  info "Swap ya existe"
fi

# --- 6. Clonar repositorio ---
PROJECT_DIR="/opt/influencer"

if [ -d "$PROJECT_DIR" ]; then
  info "Directorio $PROJECT_DIR ya existe, actualizando..."
  cd "$PROJECT_DIR"
  git pull origin main || true
else
  log "Clonando repositorio..."
  git clone https://github.com/Zolwayofficial/Influencer-IA.git "$PROJECT_DIR"
  cd "$PROJECT_DIR"
fi

# --- 7. Crear .env desde template ---
if [ ! -f "$PROJECT_DIR/.env" ]; then
  cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
  log "Archivo .env creado desde template"
else
  info "Archivo .env ya existe"
fi

# --- 8. Crear directorios para assets ---
mkdir -p "$PROJECT_DIR/avatar-frontend/dist/models"
mkdir -p "$PROJECT_DIR/avatar-frontend/dist/animations"
mkdir -p "$PROJECT_DIR/traefik"
mkdir -p "$PROJECT_DIR/cookies"

# Permisos Traefik
touch "$PROJECT_DIR/traefik/acme.json"
chmod 600 "$PROJECT_DIR/traefik/acme.json"

# --- 9. Descargar avatar por defecto ---
AVATAR_FILE="$PROJECT_DIR/avatar-frontend/dist/models/avatar.glb"
if [ ! -f "$AVATAR_FILE" ]; then
  log "Descargando avatar por defecto (brunette.glb)..."
  wget -q -O "$AVATAR_FILE" \
    "https://raw.githubusercontent.com/met4citizen/TalkingHead/main/avatars/brunette.glb" || \
    warn "No se pudo descargar el avatar. Sube uno manualmente a: $AVATAR_FILE"
else
  info "Avatar ya existe"
fi

# --- 10. Permisos de scripts ---
chmod +x "$PROJECT_DIR/deploy.sh"
chmod +x "$PROJECT_DIR/scripts/create-multiple-dbs.sh" 2>/dev/null || true
chmod +x "$PROJECT_DIR/stream-compositor/scripts/entrypoint.sh" 2>/dev/null || true

# --- 11. Crear redes Docker ---
log "Creando redes Docker..."
docker network create influencer_brain-net 2>/dev/null || true
docker network create influencer_media-net 2>/dev/null || true
docker network create influencer_data-net  2>/dev/null || true
docker network create influencer_infra-net 2>/dev/null || true

echo ""
echo "=========================================="
echo -e "  ${GREEN}INSTALACION COMPLETADA${NC}"
echo "=========================================="
echo ""
echo "Proximos pasos:"
echo ""
echo "  1. Edita el archivo .env con tus API keys:"
echo -e "     ${BLUE}nano $PROJECT_DIR/.env${NC}"
echo ""
echo "  2. Las API keys que necesitas:"
echo "     - DASHSCOPE_API_KEY  -> https://dashscope.console.aliyun.com"
echo "     - YOUTUBE_STREAM_KEY -> https://studio.youtube.com"
echo "     - TIKTOK_SESSION_ID  -> Cookies de TikTok"
echo ""
echo "  3. Configura tu dominio (DNS A records apuntando a esta IP):"
echo -e "     ${BLUE}$(curl -s ifconfig.me 2>/dev/null || echo 'TU_IP')${NC}"
echo ""
echo "  4. Levanta los servicios:"
echo -e "     ${BLUE}cd $PROJECT_DIR && ./deploy.sh up${NC}"
echo ""
echo "  5. Verifica el estado:"
echo -e "     ${BLUE}./deploy.sh status${NC}"
echo ""
