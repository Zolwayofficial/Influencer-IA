#!/bin/bash
set -e

# ============================================================
# HARDENING DEL VPS - Seguridad basica para produccion
# ============================================================
# Ejecutar como root: sudo ./scripts/harden-vps.sh
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[x]${NC} $1"; exit 1; }

if [ "$EUID" -ne 0 ]; then
  error "Ejecutar como root: sudo $0"
fi

echo "============================================"
echo " HARDENING VPS - Influencer 3D Powerhouse"
echo "============================================"
echo ""

# --- 1. Actualizar sistema ---
log "Actualizando sistema..."
apt-get update && apt-get upgrade -y

# --- 2. Instalar herramientas esenciales ---
log "Instalando herramientas..."
apt-get install -y \
  docker.io docker-compose-plugin \
  git htop curl wget unzip nano \
  net-tools ufw fail2ban \
  ca-certificates gnupg lsb-release

# --- 3. Docker ---
log "Habilitando Docker..."
systemctl enable docker
systemctl start docker

# --- 4. Firewall (UFW) ---
log "Configurando firewall..."

# Reglas por defecto
ufw default deny incoming
ufw default allow outgoing

# SSH
ufw allow 22/tcp comment 'SSH'

# HTTP/HTTPS (Traefik)
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'

# Streaming (MediaMTX)
ufw allow 1935/tcp comment 'RTMP'
ufw allow 8554/tcp comment 'RTSP'
ufw allow 8888/tcp comment 'HLS'
ufw allow 8889/tcp comment 'WebRTC'
ufw allow 8890/udp comment 'SRT'

# Habilitar UFW (sin prompt)
echo "y" | ufw enable
ufw status numbered

# --- 5. Fail2Ban ---
log "Configurando fail2ban..."

cat > /etc/fail2ban/jail.local <<'JAIL'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5
backend = systemd

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 7200
JAIL

systemctl enable fail2ban
systemctl restart fail2ban

# --- 6. SSH Hardening ---
log "Hardening SSH..."

# Backup config original
cp /etc/ssh/sshd_config /etc/ssh/sshd_config.backup

# Aplicar configuracion segura
cat >> /etc/ssh/sshd_config <<'SSHCONF'

# --- Hardening ---
PermitRootLogin prohibit-password
PasswordAuthentication yes
MaxAuthTries 3
LoginGraceTime 30
ClientAliveInterval 300
ClientAliveCountMax 2
X11Forwarding no
AllowAgentForwarding no
SSHCONF

warn "SSH hardening aplicado. Se recomienda configurar SSH keys y deshabilitar PasswordAuthentication"

# --- 7. Optimizacion del Kernel ---
log "Optimizando kernel para 64GB RAM..."

cat >> /etc/sysctl.conf <<'SYSCTL'

# --- Influencer 3D Powerhouse - Kernel Tuning ---
# Limites de archivos (Chrome + Node)
fs.inotify.max_user_watches=524288
fs.file-max=2097152

# Networking
net.core.rmem_max=2500000
net.core.wmem_max=2500000
net.core.somaxconn=65535
net.ipv4.tcp_max_syn_backlog=65535

# Memoria
vm.swappiness=10
vm.dirty_ratio=15
vm.dirty_background_ratio=5

# Seguridad de red
net.ipv4.conf.all.rp_filter=1
net.ipv4.conf.default.rp_filter=1
net.ipv4.icmp_echo_ignore_broadcasts=1
net.ipv4.conf.all.accept_redirects=0
net.ipv4.conf.all.send_redirects=0
SYSCTL

sysctl -p

# --- 8. Limites de archivos abiertos ---
log "Configurando limites de archivos..."

cat >> /etc/security/limits.conf <<'LIMITS'

# Influencer 3D Powerhouse
* soft nofile 65535
* hard nofile 65535
root soft nofile 65535
root hard nofile 65535
LIMITS

# --- 9. Swap (minimo para emergencias) ---
if [ ! -f /swapfile ]; then
  log "Creando swap de emergencia (4GB)..."
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# --- 10. Actualizaciones automaticas de seguridad ---
log "Habilitando actualizaciones de seguridad automaticas..."
apt-get install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades 2>/dev/null || true

# --- 11. Log rotation para Docker ---
log "Configurando log rotation para Docker..."
cat > /etc/docker/daemon.json <<'DOCKER'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "storage-driver": "overlay2"
}
DOCKER

systemctl restart docker

echo ""
echo "============================================"
log "HARDENING COMPLETADO"
echo "============================================"
echo ""
echo "Resumen:"
echo "  - UFW activado (puertos: SSH, HTTP, HTTPS, RTMP, SRT)"
echo "  - Fail2ban activo (3 intentos SSH = ban 2h)"
echo "  - SSH hardened (root solo con key)"
echo "  - Kernel optimizado para 64GB RAM"
echo "  - Swap de emergencia: 4GB"
echo "  - Docker log rotation: max 10MB x 3 archivos"
echo "  - Actualizaciones de seguridad automaticas"
echo ""
warn "IMPORTANTE: Configura SSH keys antes de deshabilitar PasswordAuthentication"
echo ""
