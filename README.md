# Influencer 3D Powerhouse

Sistema autonomo de influencer virtual 3D con avatar lip-sync, navegacion web, chat en vivo y streaming.

## Arquitectura

```
┌─────────────────────────────────────────────────────────┐
│                   INFRAESTRUCTURA                       │
│  Traefik · Portainer · Uptime Kuma · Grafana/Prometheus │
├─────────────────────────────────────────────────────────┤
│                    CEREBRO IA                           │
│  OpenClaw · Ollama (local) · Qdrant · HeadTTS (Kokoro)  │
├─────────────────────────────────────────────────────────┤
│                   AVATAR & MEDIA                        │
│  TalkingHead (Three.js) · MediaMTX · Stream Compositor  │
├─────────────────────────────────────────────────────────┤
│                 CHAT & AUTOMATIZACION                   │
│  Chat Bridge (TikTok+YouTube) · N8N · Evolution API     │
├─────────────────────────────────────────────────────────┤
│                   ALMACENAMIENTO                        │
│  PostgreSQL · Redis · MinIO                             │
└─────────────────────────────────────────────────────────┘
```

## Requisitos

- **Servidor**: VPS con minimo 16 vCPU / 64GB RAM / 400GB SSD (recomendado: Contabo VPS L)
- **OS**: Ubuntu 22.04/24.04 LTS
- **Docker**: Docker Engine + Docker Compose v2
- **Dominio**: Con DNS apuntando al servidor (para SSL via Traefik)

## Inicio Rapido

### 1. Clonar y configurar

```bash
git clone https://github.com/Zolwayofficial/Influencer-IA.git /opt/influencer
cd /opt/influencer
chmod +x deploy.sh scripts/*.sh stream-compositor/scripts/*.sh
```

### 2. Hardening del servidor (primera vez)

```bash
./scripts/harden-vps.sh
```

### 3. Configurar variables de entorno

```bash
cp .env.example .env
nano .env
# Llena TODOS los valores: dominio, API keys, passwords, etc.
```

### 4. Preparar el avatar

1. Crear avatar en [ReadyPlayerMe](https://readyplayer.me/) (cuerpo completo)
2. Exportar como GLB (con blendshapes ARKit/Oculus)
3. Descargar animaciones de [Mixamo](https://www.mixamo.com/) (idle, talking, pointing, waving) como FBX
4. Colocar archivos:

```
avatar-frontend/dist/models/avatar.glb
avatar-frontend/dist/animations/idle.fbx
avatar-frontend/dist/animations/talking.fbx
avatar-frontend/dist/animations/pointing.fbx
avatar-frontend/dist/animations/waving.fbx
```

### 5. Descargar modelo TTS

```bash
./scripts/download-kokoro.sh
```

### 6. Desplegar

```bash
./deploy.sh setup    # Primera vez: crea redes, permisos, optimiza kernel
./deploy.sh up       # Levanta todos los servicios
```

### 7. Descargar modelo de Ollama

```bash
docker exec influencer-ollama ollama pull qwen2.5:7b
```

### 8. Verificar salud

```bash
./deploy.sh health
```

## Comandos

| Comando | Descripcion |
|---------|-------------|
| `./deploy.sh setup` | Configuracion inicial (primera vez) |
| `./deploy.sh up` | Levantar todos los servicios |
| `./deploy.sh down` | Detener todos los servicios |
| `./deploy.sh restart` | Reiniciar todo |
| `./deploy.sh logs` | Ver logs de todos los servicios |
| `./deploy.sh logs <servicio>` | Ver logs de un servicio (ej: `logs compositor`) |
| `./deploy.sh status` | Estado de contenedores |
| `./deploy.sh health` | Health check de todos los servicios |
| `./deploy.sh pull` | Actualizar imagenes Docker |
| `./scripts/backup.sh` | Ejecutar backup manual |

## Estructura del Proyecto

```
influencer/
├── avatar-frontend/          # Frontend 3D (TalkingHead + Three.js)
│   ├── dist/
│   │   ├── index.html
│   │   ├── css/style.css
│   │   ├── js/app.mjs
│   │   ├── models/           # avatar.glb (tu avatar)
│   │   └── animations/       # idle.fbx, talking.fbx, etc.
│   └── nginx.conf
├── chat-bridge/              # Lector unificado de chat
│   ├── Dockerfile
│   ├── src/
│   │   ├── index.js
│   │   └── platforms/
│   │       ├── tiktok.js     # TikTok Live Connector
│   │       └── youtube.js    # YouTube Data API v3
│   └── package.json
├── stream-compositor/        # Captura + encoding + streaming
│   ├── Dockerfile
│   ├── scripts/entrypoint.sh
│   ├── src/index.js
│   └── package.json
├── headtts/                  # TTS con visemas para lip-sync
│   ├── Dockerfile
│   ├── server.js
│   └── package.json
├── openclaw/                 # Agente IA central
│   ├── config/config.yml
│   └── skills/
│       ├── influencer-speak/
│       ├── product-showcase/
│       ├── browser-research/
│       ├── stream-control/
│       └── video-record/
├── n8n-workflows/            # Workflows exportados para N8N
├── scripts/                  # Scripts utilitarios
│   ├── harden-vps.sh
│   ├── backup.sh
│   ├── download-kokoro.sh
│   └── create-multiple-dbs.sh
├── traefik/
├── prometheus/prometheus.yml
├── mediamtx/mediamtx.yml
├── docker-compose.data.yml
├── docker-compose.infra.yml
├── docker-compose.brain.yml
├── docker-compose.media.yml
├── deploy.sh
├── .env.example
└── .gitignore
```

## Flujo de Datos

### Modo Livestream

```
Chat (TikTok/YouTube)
  → Chat Bridge (deduplicacion + cola Redis)
  → OpenClaw (decide respuesta con Ollama o API externa)
  → HeadTTS (genera audio + visemas Kokoro)
  → Avatar Frontend (TalkingHead lip-sync en Three.js)
  → Stream Compositor (Chromium headless + FFmpeg captura)
  → MediaMTX (SRT/RTMP/HLS/WebRTC)
  → OBS/TikTok Live Studio
```

### Modo Video Pregrabado

```
N8N Trigger (cron/manual)
  → OpenClaw (genera guion + investiga productos)
  → HeadTTS (renderiza audio segmentos)
  → Stream Compositor (graba avatar hablando)
  → MinIO (almacena MP4 final)
  → N8N (notifica + auto-upload opcional)
```

## Conexion a Plataformas de Streaming

Una vez que el stream esta activo, MediaMTX lo hace disponible en:

| Protocolo | URL |
|-----------|-----|
| SRT | `srt://TU_IP:8890?streamid=read:live/influencer` |
| RTMP | `rtmp://TU_IP:1935/live/influencer` |
| HLS | `http://TU_IP:8888/live/influencer` |
| WebRTC | `http://TU_IP:8889/live/influencer` |

**Para OBS / TikTok Live Studio:**
1. Agregar fuente de Media
2. URL: `srt://TU_IP:8890?streamid=read:live/influencer`
3. Buffer al minimo

## Asignacion de Recursos (64GB RAM)

| Servicio | RAM | CPU |
|----------|-----|-----|
| Ollama (qwen2.5:7b) | 16 GB | 6 vCPU |
| Stream Compositor | 6 GB | 4 vCPU |
| HeadTTS (Kokoro) | 4 GB | 2 vCPU |
| OpenClaw | 4 GB | 4 vCPU |
| PostgreSQL | 2 GB | 1 vCPU |
| Qdrant | 2 GB | 1 vCPU |
| MinIO | 2 GB | 1 vCPU |
| Monitoreo | 2 GB | 1.5 vCPU |
| N8N + Redis + otros | 3 GB | 3 vCPU |
| **Total** | **~43 GB** | **~27 vCPU** |
| **Libre (OS + picos)** | **~21 GB** | - |

## Configuracion Manual Requerida

### Cookies de sesion
Exportar cookies de tu navegador (usa EditThisCookie o similar):
- `cookies/amazon.json` - Sesion de Amazon
- `cookies/alibaba.json` - Sesion de Alibaba
- `cookies/1688.json` - Sesion de 1688.com

### TikTok Live
Extraer `sessionid` de las cookies de TikTok despues de loguearte.

### YouTube Live
Crear API key en [Google Developer Console](https://console.developers.google.com/) con YouTube Data API v3 habilitada.

### API Keys de IA
- **Qwen (DashScope)**: https://dashscope.console.aliyun.com/
- **OpenAI** (opcional): https://platform.openai.com/

## Stack Tecnologico

| Componente | Tecnologia |
|------------|------------|
| Avatar 3D + Lip-sync | [TalkingHead](https://github.com/met4citizen/TalkingHead) + Three.js |
| TTS con visemas | [HeadTTS](https://github.com/met4citizen/HeadTTS) (Kokoro 82M) |
| Agente IA | [OpenClaw](https://github.com/openclaw/openclaw) |
| LLM Local | Ollama (qwen2.5:7b) |
| Memoria vectorial | Qdrant |
| Chat TikTok | [TikTok-Live-Connector](https://github.com/zerodytrash/TikTok-Live-Connector) |
| Chat YouTube | YouTube Data API v3 |
| Streaming | MediaMTX (SRT/RTMP/HLS/WebRTC) |
| Captura video | FFmpeg + Xvfb + Chromium headless |
| Workflows | N8N |
| Reverse proxy | Traefik v3 |
| Monitoreo | Grafana + Prometheus + Uptime Kuma |
| Almacenamiento | MinIO (S3-compatible) |

## Licencia

Proyecto privado.
