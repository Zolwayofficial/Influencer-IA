# Project Memory

Resumen vivo del estado del proyecto. La IA lo lee SIEMPRE al iniciar tarea, en Lite y en Full.

Estado: active
Última actualización: 2026-05-05 (corregido contra archivos reales del proyecto)

## 0. Stack Snapshot

```txt
Runtime:         Node.js ≥18 / Python 3.10 / Node.js 22-slim (HeadTTS)
Avatar:          TalkingHead @1.7 (CDN jsdelivr) + Three.js — NUNCA instanciar más de uno
TTS:             f5-tts service — TTS_ENGINE="edge" en compose PERO AP-004 documenta bloqueo. VERIFICAR en VPS.
TTS lip-sync:    HeadTTS (Kokoro 82M) en headtts/ — 4GB/2vCPU — brain compose
LLM:             Groq API multi-tier: llama-3.1-8b-instant (chat) / compound-beta (research) / llama-4-scout (vision)
Memoria:         mem0 (Qdrant + all-MiniLM-L6-v2 + Groq) en mem0:6789
Agent:           OpenClaw (Node.js, 4GB/2CPU, restart obligatorio tras cambios — AP-007)
Proxy:           Traefik v2.11 (NO v3)
Streaming:       MediaMTX SRT:8890 RTMP:1935 HLS:8888 WebRTC:8889
Captura:         FFmpeg + Xvfb + Chromium headless (stream-compositor 6GB/4CPU)
Fondos:          Stable Diffusion v1-5 CPU (stable-diffusion 7GB/4CPU, regenera cada 4h)
DB:              PostgreSQL 16 + Redis 7 + Qdrant + MinIO
SSH Windows:     plink/pscp con -hostkey y -pw (NO ssh/scp estándar — AP-005)
```

Si esto no coincide con `docs/stack.md`, gana `stack.md`.

## 1. Tarea Activa

- ID: —
- Objetivo: Corrección de docs FactorIA contra archivos reales del proyecto
- Estado: done (2026-05-05)
- Criterio de aceptación: stack.md, design_summary.md, capability_map.md, anti_patterns.md, project_memory.md corregidos con citas a fuentes reales
- Fuente del criterio: SKILL.md principio "forced source citation"
- Toca lethal trifecta?: no

## 2. Próximos Pasos

1. **URGENTE — verificar TTS**: En VPS, comprobar si edge-tts funciona en f5-tts container. Ver AP-004 contradicción vs docker-compose.yml L459.
2. Definir próxima feature y registrarla en `task_tracker.md`
3. Evaluar activar brain compose (HeadTTS Kokoro) para lip-sync real vs edge-tts actual

## 3. Decisiones Recientes

- [ADR-000] Adoptar FactorIA v8 | 2026-05-05 | actor: Billy + Claude Sonnet 4.6
- [ADR-001] Canvas en vez de video para screen share | 2026-04-20 | actor: Billy + Claude Sonnet
- [ADR-002] f5-tts service dual-mode; Kokoro viable en VPS 64GB (4GB/2vCPU) | 2026-04-20 actualizado 2026-05-05
- [ADR-003] plink/pscp en vez de ssh/scp | 2026-04-20 | actor: Billy + Claude Sonnet
- [ADR-004] filter: contrast(1.0001) para fix MPO | 2026-04-25 | actor: Billy + Claude Sonnet

## 4. Tareas Recién Cerradas

- [IT-000] | 2026-05-05 | Setup FactorIA v8 en el proyecto Influencer-IA
- [IT-001] | 2026-05-05 | Corrección docs FactorIA contra archivos reales (forced source citation)

## 5. Riesgos Activos

- [RISK-001]: TTS_ENGINE="edge" en compose pero AP-004 documenta bloqueo en Contabo. Sin verificar → riesgo de silencio en stream.
- [RISK-002]: TikTok-Live-Connector es OSS no oficial; puede romperse si TikTok cambia su API de live chat.
- [RISK-003]: Contraseña VPS en scripts de deploy (uso personal, riesgo aceptado por ahora).
- [RISK-004]: stable-diffusion en CPU genera fondos en ~90s. Si el proceso falla al arrancar, avatar sin fondos dinámicos.

## 6. Archivos Críticos

- `avatar-frontend/dist/js/app.mjs` — lógica principal del avatar (TalkingHead, screen share, productos)
- `avatar-frontend/dist/css/style.css` — CSS crítico (ver AP-001, ADR-004, contrast(1.0001))
- `avatar-frontend/dist/index.html` — stream mode gate, canvas proxy, #capture-keepalive
- `avatar-frontend/dist/control.html` — panel de control
- `docker-compose.yml` — fuente de verdad de todos los servicios, versiones y recursos
- `docker-compose.brain.yml` — compose alternativo con HeadTTS Kokoro
- `openclaw/src/index.js` — agente IA central (bind-mount, requiere restart tras cambios)
- `openclaw/skills/` — skills del agente (bind-mount, requiere restart tras cambios)
- `.env.example` — variables de entorno requeridas

## 7. Última Lección Aprendida

- [AP-001]: CSS identity filters sobre WebGL canvas → MPO overlay → TikTok Studio frame negro. Fix: `contrast(1.0001)`.
- [AP-004]: Contradicción sin resolver: edge-tts documentado como bloqueado pero activo en compose. No asumir ni uno ni otro hasta verificar.
- [FactorIA]: Llenar docs sin leer archivos reales viola el principio de "forced source citation" y produce documentación incorrecta. SIEMPRE leer archivos antes de documentar.

## 8. Resumen Operacional

Sistema de influencer virtual 3D con avatar TalkingHead @1.7, chat TikTok+YouTube, LLM multi-tier Groq, memoria persistente mem0, navegación autónoma browser-agent, fondos generados por Stable Diffusion, 5 skills OpenClaw activas, panel de control web. Bugs de captura MPO resueltos. VPS 64GB Contabo soporta todos los servicios simultáneos (RAM total estimada: ~30-35GB). Estado TTS sin verificar en producción.

## 9. Provenance De Esta Memoria

| Fecha | Actor | Tipo de cambio | Tarea relacionada |
|---|---|---|---|
| 2026-05-05 | Claude Sonnet 4.6 | Creación inicial — setup FactorIA | IT-000 |
| 2026-05-05 | Claude Sonnet 4.6 | Corrección contra archivos reales (docker-compose, README, Dockerfiles, SKILL.md) | IT-001 |
