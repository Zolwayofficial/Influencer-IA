# Design Summary

Estado: active
Última actualización: 2026-05-05 (corregido contra docker-compose.yml, docker-compose.brain.yml, headtts/Dockerfile, README.md)

## 1. Arquitectura Global

```txt
Chat (TikTok/YouTube)
  → chat-bridge (deduplicación + Redis queue)
  → openclaw (Groq multi-tier LLM, ejecuta skills)
  → f5-tts service (TTS_ENGINE="edge" actualmente; puerto 8882)
  → avatar-frontend (TalkingHead @1.7 lip-sync, nginx:alpine)
  → stream-compositor (Xvfb + Chromium headless + FFmpeg)
  → MediaMTX (SRT/RTMP/HLS/WebRTC)
  → TikTok Live Studio / OBS / navegador

Memoria persistente:
  openclaw → mem0 (http://mem0:6789)
           → Qdrant (http://qdrant:6333)

Productos / investigación:
  openclaw → browser-agent (http://browser-agent:5002) — Playwright headless
           → product-hunter (http://product-hunter:5001)

Fondos dinámicos:
  stable-diffusion (CPU, SD v1-5) → volumen sd_backgrounds
  avatar-frontend (nginx) sirve /backgrounds desde el mismo volumen

Control remoto:
  control.virtufan.com (panel HTML)
  → Traefik v2.11 → avatar-frontend:8080/ctrl/*
                   → openclaw:3000/agent/*

Alternativa TTS con lip-sync real (brain compose):
  headtts (Kokoro 82M, met4citizen) → puerto 8882 → TalkingHead visemas
```

Fuente: docker-compose.yml (líneas 1-624), docker-compose.brain.yml, influencer-speak/SKILL.md, stream-control/SKILL.md

## 2. Módulos

| Módulo | Responsabilidad | RAM / CPU | Fuente |
|---|---|---|---|
| avatar-frontend | nginx:alpine — sirve TalkingHead @1.7, panel control, fondos SD | 256MB / 0.5 CPU | docker-compose.yml L507 |
| chat-bridge | Lee TikTok + YouTube live chat, deduplica, encola Redis | 512MB / 1 CPU | docker-compose.yml L540 |
| openclaw | Agente IA central: Groq multi-tier LLM, ejecuta 5 skills | 4GB / 2 CPU | docker-compose.yml L312 |
| browser-agent | Playwright headless — navega Amazon/Alibaba/1688 con cookies | 1GB / 1 CPU | docker-compose.yml L358 |
| product-hunter | Investigación autónoma de productos | 512MB / 1 CPU | docker-compose.yml L381 |
| mem0 | Memoria semántica persistente (Qdrant + all-MiniLM-L6-v2 + Groq) | 2GB / 1 CPU | docker-compose.yml L418 |
| f5-tts | TTS server dual-mode: edge-tts (activo) / F5-TTS voice cloning | 7GB / 4 CPU | docker-compose.yml L448 |
| stable-diffusion | SD v1-5 CPU — genera 5 fondos al arrancar, renueva cada 4h | 7GB / 4 CPU | docker-compose.yml L476 |
| stream-compositor | Xvfb + Chromium headless + FFmpeg → MediaMTX RTMP | 6GB / 4 CPU | docker-compose.yml L587 |
| mediamtx | Distribución multi-protocolo: SRT/RTMP/HLS/WebRTC | 512MB / 1 CPU | docker-compose.yml L567 |
| traefik | Reverse proxy v2.11 + SSL automático (Let's Encrypt) | — | docker-compose.yml L159 |
| infra | PostgreSQL 16, Redis 7, Qdrant, MinIO, N8N, Grafana, Prometheus, Uptime Kuma, Portainer | varios | docker-compose.yml |
| headtts (brain) | Kokoro 82M — TTS con visemas reales para lip-sync nativo | 4GB / 2 CPU | docker-compose.brain.yml, headtts/Dockerfile |

## 3. Límites Del Sistema

- Frontend: nginx estático (bind-mount `./avatar-frontend/dist`), público en `avatar.virtufan.com:8080`
- Panel control: `control.virtufan.com` (Traefik label `control.${DOMAIN}`)
- Stream output: MediaMTX → SRT `:8890`, RTMP `:1935`, HLS `:8888`, WebRTC `:8889`
- VPS: 194.163.172.161 (Contabo Ubuntu 22.04, 64GB RAM), proyecto en `/opt/influencer/`
- Dev local: `C:\Users\Billy\influencer\`, deploy via pscp/plink
- AVATAR_URL interno: `http://avatar-frontend:8080` (sin parámetro `?key=`) — fuente: docker-compose.yml L592
- Traefik versión: v2.11 (NO v3) — fuente: docker-compose.yml L160

## 4. Decisiones Vigentes

| Decisión | Motivo | Fecha | ADR | Revisar Cuando |
|---|---|---|---|---|
| Canvas en vez de video para screen share | Video usa MPO → TikTok Studio no lo captura | 2026-04-20 | ADR-001 | Chrome cambie compositing de canvas |
| f5-tts con TTS_ENGINE="edge" (edge-tts activo) | **CONTRADICCIÓN**: AP-004 documenta bloqueo en Contabo; compose tiene edge activo — pendiente verificar en VPS | 2026-05-05 | — | Verificar `curl http://localhost:8882/health` en VPS |
| plink/pscp en vez de ssh/scp | Clave id_rsa_vps no en authorized_keys | 2026-04-20 | ADR-003 | Se agregue clave SSH |
| filter: contrast(1.0001) como base CSS | Previene MPO de Chrome en WebGL canvas | 2026-04-25 | ADR-004 | Chrome cambie política de compositing |
| Traefik v2.11 (no v3) | Versión en docker-compose.yml — no actualizar sin change_control | 2026-05-05 | — | Al actualizar infra |
| Stable Diffusion en CPU | VPS sin GPU dedicada; SD v1-5 viable en CPU (7GB/4vCPU, ~90s por imagen) | 2026-05-05 | — | Si se agrega GPU al VPS |

## 5. Restricciones

- **Performance**: stream-compositor 6GB/4vCPU + f5-tts 7GB/4vCPU + stable-diffusion 7GB/4vCPU = servicios pesados concurrentes. VPS 64GB permite esto.
- **TTS**: f5-tts service actualmente configurado con `TTS_ENGINE: "edge"`. Si edge-tts está bloqueado en VPS (AP-004), cambiar a `TTS_ENGINE: "f5"` o arrancar brain compose con HeadTTS.
- **GPU**: Sin GPU dedicada. Stable Diffusion corre en CPU (lento, ~90s/imagen). HeadTTS Kokoro no requiere GPU (4GB/2vCPU — README.md línea 215).
- **Seguridad**: Panel control sin auth explícita en nginx (Traefik label, sin middleware auth en control router). Verificar antes de exponer.
- **Operación**: avatar-frontend sin restart al actualizar archivos (bind-mount); openclaw requiere restart tras cambios en index.js o skills/.
- **Fondos**: sd_backgrounds volumen compartido entre stable-diffusion y avatar-frontend (nginx sirve `/backgrounds`).
