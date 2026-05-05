# Capability Map

Single source of truth de las **capabilities internas reusables** del proyecto. La IA debe leer este archivo antes de implementar funcionalidad nueva o refactorizar, y nunca duplicar una capability ya listada aquí.

Estado: active
Última actualización: 2026-05-05 (corregido contra docker-compose.yml, SKILL.md files)

## Reglas De Oro

```txt
Antes de implementar, lee este archivo y haz grep en el codebase con palabras clave.
Si encuentras capability que cubre la necesidad parcial o total, úsala o extiéndela.
No reinventes lo que ya existe.
Si implementas capability reutilizable nueva, agrégala aquí antes de cerrar la tarea.
```

## 1. Avatar Frontend — `avatar-frontend/dist/js/app.mjs`

| Capability | Propósito | Ubicación | Cuándo Usarla | Cuándo NO |
|---|---|---|---|---|
| `AvatarController` (clase principal) | Orquesta todo el avatar: TalkingHead, screen share, stream mode, producto | `app.mjs` — clase principal | Siempre que se extienda el avatar | No instanciar más de una vez |
| `AvatarController.speak(text, emotion)` | Hace hablar al avatar con una emoción | `app.mjs` | Cuando OpenClaw envía texto | — |
| `AvatarController.showProduct(product)` | Muestra overlay de producto (nombre, precio, imagen, QR) | `app.mjs` | Showcase de productos | — |
| `AvatarController._customBg` | Almacena fondo personalizado; evita que efectos de emoción lo sobreescriban | `app.mjs` | Al cambiar fondo desde panel | No usar `document.body.style.background` directamente |
| Emotion → TalkingHead mood map | Mapeo de emociones (happy, sad, angry…) a moods de TalkingHead | `app.mjs` línea ~27 | Al recibir emoción de OpenClaw | TalkingHead no tiene `surprised`; usar `neutral` |
| Screen share canvas proxy | Captura pantalla compartida y la refleja en `<canvas id="screen-canvas">` sin MPO | `app.mjs` + `index.html` | Screen share para TikTok Studio | NUNCA usar `<video>` para esto (AP-002) |
| Slide change detector | Detecta cambio de slide por diferencia de píxeles (threshold 25%, cooldown 8s) | `app.mjs` | Presentaciones Canva | Ajustar threshold si hay mucho falso positivo |
| Stream mode gate | `?key=live1234` en index.html/app.mjs activa audio + voz; sin key = PREVIEW silencioso | `index.html` + `app.mjs` | Control de acceso; nota: AVATAR_URL interno NO lleva key (docker-compose.yml L592) | No cambiar el token sin actualizar lógica en app.mjs |
| `#capture-keepalive` div | Div animado (opacity 0.001→0.0012, z-index 5) que fuerza composite layer en Chrome | `index.html` + `style.css` | Siempre presente | No eliminar ni poner opacity:0 (rompería MPO fix) |
| Fondos dinámicos SD | `avatar-frontend` sirve `/backgrounds` desde volumen compartido `sd_backgrounds` | nginx.conf + docker-compose.yml | Cuando stable-diffusion genera nuevo fondo | No copiar manualmente al dist si el volumen está activo |

## 2. Control Panel — `avatar-frontend/dist/control.html`

| Capability | Propósito | Ubicación | Cuándo Usarla |
|---|---|---|---|
| Panel de control web | Secciones coloreadas para comandos en tiempo real | `control.html` | Control remoto del avatar |
| Upload de fondo | Permite subir imagen por URL o archivo para el fondo del avatar | `control.html` sección s-pink | Personalización de escena |
| Product form | Formulario con nombre, precio, precio original, imagen/video, QR | `control.html` sección producto | Lanzar showcase de producto |
| Knowledge upload | Sube documento/URL al knowledge base de OpenClaw (Qdrant) | `control.html` | Cargar contexto de producto |

## 3. Services Y Endpoints

| Capability | Propósito | Endpoint | Fuente |
|---|---|---|---|
| chat-bridge | Lee chat TikTok+YouTube, deduplica, encola Redis | `:4000/health`, `:4000/api/*` | docker-compose.yml L540 |
| OpenClaw agent | Decide respuesta con LLM, ejecuta skills | `openclaw:3000/api/*` | docker-compose.yml L312 |
| `/api/narrate-frame` | Narración automática de frame via vision AI (llama-4-scout) | `openclaw:3000/api/narrate-frame` | capability_map prev. |
| `/api/status` | Estado actual del sistema (polling desde panel) | `openclaw:3000/api/status` | capability_map prev. |
| `/webhook/chat` | Recibe eventos de chat-bridge | `openclaw:3000/webhook/chat` | docker-compose.yml L549 |
| f5-tts server | Síntesis de voz (edge-tts activo / F5-TTS alternativo) | `f5-tts:8882` | docker-compose.yml L459, L331 `F5TTS_URL` |
| browser-agent | Playwright headless — navega web con cookies | `browser-agent:5002/health` | docker-compose.yml L335, L358 |
| product-hunter | Investigación autónoma de productos | `product-hunter:5001/health` | docker-compose.yml L381 |
| mem0 | Memoria semántica persistente — add/search memorias | `mem0:6789/health` | docker-compose.yml L418, L334 `MEM0_URL` |
| stable-diffusion | Generación de fondos AI (SD v1-5 CPU) | `stable-diffusion:7860/health` | docker-compose.yml L476 |
| stream-compositor | Captura Chromium headless + FFmpeg → MediaMTX | `stream-compositor:5000/*` | docker-compose.yml L587 |
| MediaMTX | Distribución SRT/RTMP/HLS/WebRTC | `:8890 SRT`, `:1935 RTMP`, `:8888 HLS`, `:8889 WebRTC` | docker-compose.yml L567 |
| MinIO | Almacenamiento de grabaciones (bucket: recordings) | `minio:9000` API, `minio:9001` console | docker-compose.yml L77 |
| headtts (brain) | Kokoro 82M TTS con visemas reales para TalkingHead | `:8882` (brain compose) | docker-compose.brain.yml, headtts/Dockerfile |

## 4. OpenClaw Skills

| Skill | Propósito | Endpoint destino | Fuente |
|---|---|---|---|
| `influencer-speak` | Envía texto + emoción al avatar; 5 emociones, 5 animaciones | `avatar-frontend:8080/api/command` | openclaw/skills/influencer-speak/SKILL.md |
| `product-showcase` | Investiga producto (browser-agent) + lanza overlay en avatar | `chat-bridge:4000/api/command` tipo `speak_and_show` | openclaw/skills/product-showcase/SKILL.md |
| `browser-research` | Navega web autónomamente (Amazon/Alibaba/1688) con cookies | `browser-agent:5002` interno | openclaw/skills/browser-research/SKILL.md |
| `stream-control` | Control de estado del stream (start/stop/go-live/status) | `stream-compositor:5000/api/*` | openclaw/skills/stream-control/SKILL.md |
| `video-record` | Graba segmento de video del compositor | `stream-compositor:5000/api/record/*` | openclaw/skills/video-record/SKILL.md |

**Emociones disponibles en influencer-speak**: `neutral`, `happy`, `excited`, `surprised`, `thinking` — fuente: influencer-speak/SKILL.md
**Animaciones disponibles en influencer-speak**: `idle`, `waving`, `pointing`, `talking`, `nodding` — fuente: influencer-speak/SKILL.md

## 5. Nginx Routing — `avatar-frontend` (Traefik labels)

| Ruta / Host | Destino | Fuente |
|---|---|---|
| `avatar.${DOMAIN}` | `avatar-frontend:8080` | docker-compose.yml L519-520 |
| `control.${DOMAIN}` | `avatar-frontend:8080` (misma app, ruta distinta) | docker-compose.yml L524-527 |
| Internamente: `/ctrl/*` | `chat-bridge:4000/api/*` | capability_map prev. |
| Internamente: `/agent/*` | `openclaw:3000/api/*` | capability_map prev. |

## 6. Cookies Por Sitio (browser-research / product-showcase)

| Sitio | Archivo cookies | Fuente |
|---|---|---|
| Amazon | `/app/cookies/amazon.json` (en openclaw container) | browser-research/SKILL.md |
| Alibaba | `/app/cookies/alibaba.json` | browser-research/SKILL.md |
| 1688.com | `/app/cookies/1688.json` | browser-research/SKILL.md |

Volumen bind-mount: `./cookies:/app/cookies` — fuente: docker-compose.yml L322

## 7. Capabilities Deprecadas

| Capability | Por Qué Se Deprecó | Fuente | Reemplazo |
|---|---|---|---|
| `<video id="screen-video">` | MPO hardware overlay — TikTok Studio no lo captura | AP-002, TS-002 | `<canvas id="screen-canvas">` |
| gTTS como TTS principal | **Estado incierto**: AP-004 documentó bloqueo de edge-tts → gTTS como fix; pero docker-compose.yml L459 muestra `TTS_ENGINE: "edge"` activo. Verificar en VPS. | AP-004 vs docker-compose.yml | f5-tts service con TTS_ENGINE a confirmar |

## 8. Convenciones De Naming

| Tipo | Patrón | Ejemplo |
|---|---|---|
| Skills OpenClaw | kebab-case en carpeta | `influencer-speak/` |
| Endpoints API | `/api/verb-noun` | `/api/narrate-frame` |
| IDs de elementos HTML | kebab-case descriptivo | `screen-canvas`, `capture-keepalive` |
| Variables CSS de estado | Clases en body o en elemento | `body.spotlight`, `#avatar.emotion-happy` |
| Containers Docker | `influencer-<servicio>` | `influencer-openclaw`, `influencer-f5tts` |
