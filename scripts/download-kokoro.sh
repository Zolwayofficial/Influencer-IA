#!/bin/bash
# ============================================================
# NOTA: Este script ya NO es necesario.
#
# HeadTTS oficial descarga automaticamente el modelo Kokoro
# desde HuggingFace al primer inicio del contenedor.
# El modelo se cachea en el volumen Docker 'headtts_cache'.
#
# Si quieres pre-descargar el modelo manualmente:
#   docker compose -f docker-compose.brain.yml up headtts
#   (esperar a que termine la descarga, luego Ctrl+C)
# ============================================================
echo "HeadTTS oficial descarga el modelo Kokoro automaticamente."
echo "Solo ejecuta: docker compose -f docker-compose.brain.yml up headtts"
echo "El modelo se descargara en el primer inicio (~330MB)."
