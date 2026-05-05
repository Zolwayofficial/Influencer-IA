# Stack

Single source of truth del stack técnico del proyecto. Todo agente lo lee antes de tocar dependencias o tomar decisiones técnicas.

Estado: active
Última actualización: 2026-05-05 (corregido contra docker-compose.yml, docker-compose.brain.yml, headtts/Dockerfile, README.md)

## Regla De Oro

```txt
Antes de instalar cualquier dependencia, esta debe estar declarada aquí o registrada en decision_log.md.
Antes de tomar una decisión técnica, citar la entrada de este archivo que la respalda.
Si la funcionalidad ya existe en este stack, no se instala una alternativa sin entrada en decision_log.md.
```

## 1. Lenguaje Y Runtime

| Item | Versión | Fuente | Motivo | Locked? |
|---|---|---|---|---|
| Node.js | ≥18 | docker-compose.yml (openclaw, chat-bridge, stream-compositor) | Runtime principal de servicios | No |
| Node.js | 22-slim | headtts/Dockerfile | Runtime de HeadTTS (Kokoro) | No |
| Python 3 | ≥3.10 | docker-compose.yml (f5-tts, browser-agent, product-hunter, mem0) | Runtime de servicios Python | No |
| Bash | — | scripts/ | Scripts de deploy y entrypoints | No |

## 2. Framework Principal

| Layer | Tool | Versión | Fuente | Motivo | Alternativa Descartada |
|---|---|---|---|---|---|
| Avatar frontend | Vanilla JS + importmap | ES modules | capability_map.md + avatar-frontend/dist/ | Sin build step; TalkingHead usa ESM nativo | React/Vue: overhead innecesario |
| Avatar 3D | TalkingHead @1.7 | Via CDN jsdelivr | README.md tabla stack, influencer-speak/SKILL.md | Lip-sync + visemas + Three.js integrado | Three.js solo: no incluye lip-sync |
| TTS server | f5-tts service (edge-tts / F5-TTS) | — | docker-compose.yml líneas 448-474 | Soporte dual: edge-tts (<1s) y F5-TTS voice cloning; actualmente `TTS_ENGINE: "edge"` | gTTS: voz robótica sin visemas |
| TTS premium lip-sync | HeadTTS (Kokoro 82M) — met4citizen | — | docker-compose.brain.yml, headtts/Dockerfile, README.md línea 215 | Voz con visemas reales para TalkingHead lip-sync; 4GB/2vCPU | — |
| Agent IA | OpenClaw | — | docker-compose.yml línea 312 | Orquestador de skills con Redis queue | LangChain: demasiado opinionado |
| Reverse proxy | Traefik | v2.11 | docker-compose.yml línea 160 `image: traefik:v2.11` | SSL automático, routing Docker-aware | nginx: sin autodiscovery |
| Workflows | N8N | latest | docker-compose.yml línea 112 | Automatización visual | Make/Zapier: vendor lock-in externo |
| Memoria persistente | mem0 | — | docker-compose.yml línea 418 | Memoria semántica persistente (Qdrant + all-MiniLM-L6-v2 + Groq) | Redis solo: sin búsqueda semántica |
| Fondos AI | Stable Diffusion v1-5 | CPU | docker-compose.yml línea 476 `SD_MODEL: runwayml/stable-diffusion-v1-5` | Generación de fondos cada 4h; startup=5 fondos | SD en GPU: sin GPU dedicada |

## 3. Librerías Autorizadas

| Propósito | Librería | Dónde | Fuente | Por Qué Está |
|---|---|---|---|---|
| Avatar 3D + lip-sync | TalkingHead @1.7 (met4citizen) | avatar-frontend via CDN | README.md tabla, influencer-speak/SKILL.md | Única lib OSS con lip-sync + visemas + Three.js integrado |
| TTS activo (voz) | edge-tts (Microsoft Neural) | f5-tts service | docker-compose.yml línea 459 `TTS_ENGINE: "edge"` | Latencia <1s; voz natural; **ADVERTENCIA: ver AP-004 — bloqueado en Contabo según sesión 2026-04-20; verificar si compose fue actualizado después** |
| TTS alternativo (voice cloning) | F5-TTS | f5-tts service | docker-compose.yml línea 459 comentario | Voice cloning con muestra de voz; lento en CPU |
| TTS premium lip-sync | Kokoro 82M via HeadTTS (met4citizen) | headtts/ | docker-compose.brain.yml, headtts/Dockerfile, README.md línea 215 | Visemas reales para TalkingHead; 4GB/2vCPU |
| LLM multi-tier | Groq API | openclaw, n8n, mem0 | docker-compose.yml líneas 325-326, .env.example | Tier1=llama-3.1-8b-instant (chat), Tier2=compound-beta (research), Tier3=llama-4-scout (vision) |
| Memoria semántica | mem0 + Qdrant + all-MiniLM-L6-v2 | mem0 service | docker-compose.yml líneas 418-446 | Memoria persistente entre sesiones; ~90MB modelo |
| Vector DB | Qdrant | VPS Docker | docker-compose.yml línea 399 | OSS, Docker-native, búsqueda semántica |
| Generación fondos | Stable Diffusion v1-5 (CPU) | stable-diffusion service | docker-compose.yml líneas 476-501 | Fondos dinámicos cada 4h; STARTUP_COUNT=5; compartido con nginx vía volumen sd_backgrounds |
| Browser automation | Playwright (browser-agent) | browser-agent service | docker-compose.yml línea 358 | Navegación autónoma Amazon/Alibaba/1688 |
| Product research | product-hunter | product-hunter service | docker-compose.yml línea 381 | Investigación de productos; 512MB/1CPU |
| Chat TikTok | TikTok-Live-Connector (zerodytrash) | chat-bridge | chat-bridge/src/platforms/tiktok.js | Única lib OSS activa para TikTok Live |
| Chat YouTube | YouTube Data API v3 | chat-bridge | chat-bridge/src/platforms/youtube.js, .env.example | API oficial |
| Streaming media | MediaMTX | VPS Docker | docker-compose.yml línea 567 | SRT/RTMP/HLS/WebRTC en uno, OSS |
| Captura video | FFmpeg + Xvfb + Chromium headless | stream-compositor | docker-compose.yml línea 587 | Captura canvas sin GPU |
| Almacenamiento objects | MinIO | VPS Docker | docker-compose.yml línea 77 | S3-compatible OSS; bucket recordings para grabaciones |
| Base de datos | PostgreSQL 16 | VPS Docker | docker-compose.yml línea 33 | Relacional, fiable; múltiples DBs: influencer + n8n |
| Cache / Queue | Redis 7 | VPS Docker | docker-compose.yml línea 57 | Cola de mensajes para chat-bridge y OpenClaw |
| Monitoreo | Grafana + Prometheus + cAdvisor + Uptime Kuma | VPS Docker | docker-compose.yml líneas 250, 230, 279, 210 | Stack OSS estándar de observabilidad |
| SSH/SCP desde Windows | plink / pscp (PuTTY) | Dev local | AP-005 | Único método funcional con contraseña; clave id_rsa_vps no en authorized_keys |

## 4. Servicios Externos

| Servicio | Propósito | Fuente | Reemplazable Por | Costo |
|---|---|---|---|---|
| Groq API | LLM multi-tier (chat/research/vision) | .env.example `GROQ_API_KEY` | Ollama local (sin visión) | Free tier |
| Microsoft Neural TTS | edge-tts (en f5-tts service) | docker-compose.yml línea 459 | F5-TTS voice cloning, HeadTTS Kokoro | Free |
| YouTube Data API v3 | Lectura de chat YouTube | .env.example `YOUTUBE_API_KEY` | — | Free tier |
| HostGator DNS | DNS para virtufan.com | docs/deployment.md | Cloudflare | ~$12/año |
| Contabo VPS | Servidor (64GB RAM, 8+ vCPU) | docs/deployment.md | Cualquier VPS Ubuntu 22.04 | ~€15/mes |

## 5. Librerías Prohibidas

| Librería | Por Qué No | Fuente | Alternativa En El Stack |
|---|---|---|---|
| React / Vue / Angular | Overhead innecesario para avatar frontend single-page | decision_log.md ADR-001 | Vanilla JS + importmap |
| LangChain | Demasiado opinionado, abstrae comportamiento del agente | decision_log.md | OpenClaw skills |

**Nota sobre edge-tts**: AP-004 documenta bloqueo en Contabo en sesión 2026-04-20. Sin embargo, docker-compose.yml línea 459 muestra `TTS_ENGINE: "edge"` como configuración activa. **Contradicción no resuelta — verificar en VPS si edge-tts funciona actualmente antes de documentar como bloqueado o habilitado.**

## 6. Convenciones De Código Atadas Al Stack

| Convención | Regla | Fuente | Dónde Se Aplica |
|---|---|---|---|
| CSS filters sobre WebGL canvas | NUNCA usar `brightness(1.0)` o `saturate(1.0)` solos — Chrome los optimiza como `filter: none` → canvas en MPO | AP-001, TS-001 | avatar-frontend/dist/css/style.css |
| Capture keepalive | Siempre `#capture-keepalive` div (opacity 0.001→0.0012, z-index 5) para forzar composite layer | TS-001 | avatar-frontend/dist/index.html + style.css |
| Screen share proxy | Usar `<canvas>`, nunca `<video>` para proxying de pantalla | AP-002, TS-002 | avatar-frontend/dist/index.html |
| Deploy avatar-frontend | Copiar archivos con pscp; NO reiniciar container (bind-mount nginx estático) | AP-006 | scripts de deploy |
| Deploy openclaw | SIEMPRE `docker restart influencer-openclaw` tras cambios en index.js o skills/ | AP-007 | scripts de deploy |
| SSH desde Windows | SIEMPRE plink/pscp con `-hostkey` y `-pw`, nunca ssh/scp estándar | AP-005 | dev local |
| Traefik versión | v2.11 — no actualizar a v3 sin entrada en decision_log | docker-compose.yml línea 160 | infra |

## 7. Stack Snapshot Para El Agente

```txt
Runtime:         Node.js ≥18 / Python 3.10 / Node.js 22-slim (HeadTTS)
Avatar:          TalkingHead @1.7 (CDN jsdelivr) + Three.js
TTS activo:      f5-tts service — TTS_ENGINE="edge" (edge-tts) — ADVERTENCIA: verificar si bloqueado en VPS (AP-004 vs docker-compose.yml)
TTS lip-sync:    HeadTTS (Kokoro 82M) en headtts/ — 4GB/2vCPU — brain compose
LLM:             Groq API multi-tier (llama-3.1-8b-instant / compound-beta / llama-4-scout)
Memoria:         mem0 (Qdrant + all-MiniLM-L6-v2 + Groq) + Qdrant
Agent:           OpenClaw (5 skills: influencer-speak, product-showcase, browser-research, stream-control, video-record)
Proxy:           Traefik v2.11
Streaming:       MediaMTX (SRT:8890 / RTMP:1935 / HLS:8888 / WebRTC:8889)
Captura:         FFmpeg + Xvfb + Chromium headless (stream-compositor, 6GB/4CPU)
Fondos:          Stable Diffusion v1-5 CPU (stable-diffusion, 7GB/4CPU)
DB:              PostgreSQL 16 + Redis 7
Storage:         MinIO (S3-compatible)
SSH Windows:     plink/pscp (NO ssh/scp estándar)
```

## 8. Cambios De Stack

Todo cambio en este archivo (agregar, quitar, sustituir librería) requiere entrada en `docs/change_control.md` y en `docs/decision_log.md`. No se aceptan cambios silenciosos.
