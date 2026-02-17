#!/bin/bash
set -e

DISPLAY="${DISPLAY:-:99}"
WIDTH="${STREAM_WIDTH:-1920}"
HEIGHT="${STREAM_HEIGHT:-1080}"

echo "[Compositor] Iniciando servicios de sistema..."

# 1. PulseAudio daemon
pulseaudio -D --exit-idle-time=-1 2>/dev/null || true
sleep 1

# 2. Xvfb (framebuffer virtual)
Xvfb ${DISPLAY} -screen 0 ${WIDTH}x${HEIGHT}x24 -ac &
XVFB_PID=$!
sleep 2

echo "[Compositor] Xvfb iniciado en ${DISPLAY} (${WIDTH}x${HEIGHT})"

# 3. Chromium en modo kiosko apuntando al avatar frontend
chromium \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --use-gl=swiftshader \
  --kiosk \
  --window-size=${WIDTH},${HEIGHT} \
  --start-fullscreen \
  --autoplay-policy=no-user-gesture-required \
  --disable-features=TranslateUI \
  --disable-extensions \
  --no-first-run \
  --display=${DISPLAY} \
  "${AVATAR_URL}" &
CHROME_PID=$!
sleep 5

echo "[Compositor] Chromium iniciado, cargando avatar..."

# 4. Iniciar el servidor de control (API REST)
exec node src/index.js
