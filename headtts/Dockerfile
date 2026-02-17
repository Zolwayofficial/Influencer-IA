FROM node:20-slim

WORKDIR /app

# Dependencias del sistema para ONNX Runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    && rm -rf /var/lib/apt/lists/*

COPY package.json .
RUN npm install --production
COPY . .

USER node
EXPOSE 3001

CMD ["node", "server.js"]
