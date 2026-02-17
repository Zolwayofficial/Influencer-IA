FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive

# Instalar Chromium, FFmpeg, Xvfb, PulseAudio
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ffmpeg \
    xvfb \
    pulseaudio \
    pulseaudio-utils \
    fonts-liberation \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Configurar PulseAudio
RUN mkdir -p /run/pulse && \
    echo "load-module module-null-sink sink_name=virtual_sink sink_properties=device.description=VirtualSink" >> /etc/pulse/default.pa && \
    echo "load-module module-native-protocol-tcp auth-ip-acl=127.0.0.1 auth-anonymous=1" >> /etc/pulse/default.pa

WORKDIR /app
COPY package.json .
RUN npm install --production
COPY src/ ./src/
COPY scripts/ ./scripts/
RUN chmod +x scripts/*.sh

CMD ["./scripts/entrypoint.sh"]
