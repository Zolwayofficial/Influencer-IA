FROM python:3.11-slim

WORKDIR /app

# Dependencias del sistema para audio
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    sox \
    libsox-fmt-all \
    git \
    wget \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Python deps (requirements primero para cache de Docker)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar servidor
COPY server.py .

# Directorio de voces (montar como volumen en produccion)
RUN mkdir -p /app/voices /app/models

# F5-TTS descarga el modelo en HuggingFace cache al primer arrange
ENV HF_HOME=/app/models
ENV PYTHONUNBUFFERED=1

EXPOSE 8882

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8882", "--timeout-keep-alive", "75"]
