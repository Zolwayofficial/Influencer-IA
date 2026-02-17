#!/bin/bash
set -e

# ============================================================
# Descarga del modelo Kokoro 82M ONNX para HeadTTS
# ============================================================
# Modelo: onnx-community/Kokoro-82M-v1.0-ONNX
# Fuente: HuggingFace
# Tamano: ~330MB
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MODEL_DIR="$PROJECT_DIR/headtts/models"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[x]${NC} $1"; exit 1; }

# Verificar wget o curl
if command -v wget &> /dev/null; then
  DOWNLOAD="wget -q --show-progress -O"
elif command -v curl &> /dev/null; then
  DOWNLOAD="curl -L -o"
else
  error "Necesitas wget o curl instalado"
fi

# Crear directorio de modelos
mkdir -p "$MODEL_DIR"

HF_BASE="https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main"

# Lista de archivos del modelo
FILES=(
  "model.onnx"
  "model_quantized.onnx"
  "config.json"
  "tokenizer.json"
  "voices.json"
)

log "Descargando modelo Kokoro 82M ONNX..."
log "Destino: $MODEL_DIR"
echo ""

for file in "${FILES[@]}"; do
  if [ -f "$MODEL_DIR/$file" ]; then
    warn "Ya existe: $file (saltando)"
  else
    log "Descargando $file..."
    $DOWNLOAD "$MODEL_DIR/$file" "$HF_BASE/$file"
  fi
done

# Descargar voces en espanol
VOICES_DIR="$MODEL_DIR/voices"
mkdir -p "$VOICES_DIR"

log "Descargando voces..."
VOICE_FILES=(
  "af_heart.bin"
  "af_bella.bin"
  "am_adam.bin"
  "am_michael.bin"
)

for file in "${VOICE_FILES[@]}"; do
  if [ -f "$VOICES_DIR/$file" ]; then
    warn "Ya existe: $file (saltando)"
  else
    log "Descargando voz $file..."
    $DOWNLOAD "$VOICES_DIR/$file" "$HF_BASE/voices/$file" 2>/dev/null || warn "Voz $file no disponible, saltando"
  fi
done

echo ""
log "Descarga completada!"
echo ""
log "Archivos del modelo:"
ls -lh "$MODEL_DIR"/*.onnx 2>/dev/null || true
ls -lh "$MODEL_DIR"/*.json 2>/dev/null || true
echo ""
log "Voces disponibles:"
ls -lh "$VOICES_DIR"/ 2>/dev/null || true
echo ""
log "Para usar el modelo cuantizado (mas rapido, menos RAM):"
echo "  Configurar en headtts/server.js: model = 'model_quantized.onnx'"
echo ""
log "Para usar el modelo completo (mejor calidad):"
echo "  Configurar en headtts/server.js: model = 'model.onnx'"
