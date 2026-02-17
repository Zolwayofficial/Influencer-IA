FROM node:20-slim

WORKDIR /app

# Dependencias del sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    wget \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Clonar HeadTTS oficial (MIT License)
RUN git clone --depth 1 https://github.com/met4citizen/HeadTTS.git .

# Instalar dependencias (descarga modelo Kokoro en primer npm start)
RUN npm install --production

# Copiar nuestra config personalizada (espanol, puerto 8882)
COPY headtts-node.json .

# Cache de HuggingFace dentro del contenedor
ENV HF_HOME=/app/.cache/huggingface
RUN mkdir -p /app/.cache/huggingface

EXPOSE 8882

CMD ["npm", "start"]
