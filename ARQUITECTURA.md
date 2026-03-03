# Influencer 3D Powerhouse — Arquitectura Completa
> Última actualización: 2026-03-02 (v2 — Mem0 añadido)
> Estado: Definida, pendiente implementación

---

## 1. VISIÓN DEL PROYECTO

Un influencer virtual 3D completamente autónomo que:
- Hace streams en vivo en TikTok y YouTube 24/7
- Interactúa con el chat en español en tiempo real
- Muestra y explica productos de importación (Amazon, Alibaba, 1688)
- Analiza cotizaciones de importación con cálculos exactos
- Habla con voz clonada realista en español
- Corre a costo $0 usando APIs gratuitas + recursos del VPS

**VPS**: 64GB RAM — usado ~45GB (70%), libre ~19GB
**Costo total del sistema**: $0 — 100% gratuito (VPS propio + APIs free tier + open source)

---

## 2. DIAGRAMA GENERAL

```
TikTok Live ──┐
              ├──► chat-bridge ──► OpenClaw (agente) ──► chat-bridge WS ──► avatar-frontend
YouTube Live ─┘         │               │                                         │
                    rate limit        LLM Router                            TalkingHead
                    3s mínimo         (Groq APIs)                           lip-sync
                    Redis dedup            │                                      │
                                   Skills Engine                            F5-TTS (español)
                                   groq/compound                            voz clonada
                                   (web search)                                   │
                                        │                              stream-compositor
                                   Mem0 (memoria)                      FFmpeg X11grab
                                   ├── Qdrant                                     │
                                   └── sentence-transformers        ┌─────────────┴─────────────┐
                                   recuerda todo,               Real-ESRGAN               MediaMTX
                                   aprende con el tiempo        (upscaling)         RTMP/SRT/HLS/WebRTC
                                                                     │                       │
                                                             Stable Diffusion         TikTok/YouTube
                                                             (fondos dinámicos)       (stream en vivo)
```

---

## 3. SERVICIOS Y RECURSOS

### 3.1 Servicios actuales (existentes en docker-compose.yml)

| Servicio | Descripción | RAM | CPU | Puerto |
|---|---|---|---|---|
| `postgresql` | Base de datos principal (influencer + n8n) | 2GB | 1 | interno |
| `redis` | Cache, dedup, rate limits, TTS cache | 2GB | 0.5 | interno |
| `minio` | Almacenamiento de grabaciones del stream | 2GB | 1 | storage.DOMAIN |
| `n8n` | Automatización: stream programado, salud, research | 1GB | 1 | n8n.DOMAIN |
| `traefik` | Reverse proxy + SSL automático Let's Encrypt | ~200MB | libre | 80/443 |
| `portainer` | Panel de gestión Docker | ~200MB | libre | portainer.DOMAIN |
| `uptime-kuma` | Monitor de uptime de servicios | ~200MB | libre | status.DOMAIN |
| `prometheus` | Métricas de todos los servicios | 1GB | 0.5 | interno |
| `grafana` | Dashboard de métricas visuales | 512MB | 0.5 | grafana.DOMAIN |
| `cadvisor` | Métricas de contenedores Docker | 512MB | 0.5 | interno |
| `node-exporter` | Métricas del sistema operativo | 128MB | 0.25 | interno |
| `openclaw` | **El agente del influencer** | 4GB* | 2 | interno:3000 |
| `qdrant` | Base de datos vectorial (memoria del agente) | 2GB | 1 | interno:6333 |
| `avatar-frontend` | SPA Three.js + TalkingHead (nginx) | 256MB | 0.5 | avatar.DOMAIN |
| `chat-bridge` | Conecta TikTok/YouTube con OpenClaw | 512MB | 1 | interno:4000 |
| `mediamtx` | Relay RTMP/SRT/HLS/WebRTC | 512MB | 1 | 1935/8554/8888 |
| `stream-compositor` | FFmpeg X11grab → RTMP | 8GB** | 6* | interno:5000 |

*Cambios respecto al docker-compose original: openclaw 2GB→4GB, compositor CPUs 4→6
**Incluye 2GB de shm_size

### 3.2 Servicios nuevos a agregar

| Servicio | Descripción | RAM | CPU | Reemplaza |
|---|---|---|---|---|
| `f5-tts` | TTS español con voice cloning | 7GB | 2 | `headtts` (eliminar) |
| `mem0` | Memoria persistente + aprendizaje continuo | 1GB | 0.5 | — |
| `stable-diffusion` | Generación de fondos AI dinámicos | 7GB | 2 | — |
| `real-esrgan` | Upscaling AI del video del stream | 2GB | 1 | — |

### 3.3 Servicios eliminados

| Servicio | Razón |
|---|---|
| `headtts` | Solo inglés → reemplazado por F5-TTS |
| `browser-service` | groq/compound tiene web search integrado |
| `ollama/qwen14b` | No necesario, APIs gratuitas cubren todo |

### 3.4 Presupuesto RAM total

```
Datos (postgres+redis+minio+n8n)     7.0 GB
Infra (traefik+portainer+monitoring) 2.7 GB
IA (openclaw+qdrant+f5-tts+mem0)    14.0 GB
Media (avatar+chatbridge+compositor) 9.3 GB
Visual (stable-diffusion+esrgan)     9.0 GB
OS + Docker overhead                 3.0 GB
─────────────────────────────────────────
TOTAL USADO                         45.0 GB  (70%)
LIBRE                               19.0 GB  (30%)
VPS TOTAL                           64.0 GB
COSTO TOTAL                         $0.00 / mes ✅
```

---

## 4. OPENCLAW — EL AGENTE

OpenClaw NO es un modelo de IA. Es el **agente** del influencer: tiene
identidad propia, personalidad, reglas, memoria y sistema de skills.
Los LLMs (Groq APIs) son el cerebro intercambiable que consulta.

### 4.1 Identidad (config.yml)
- Influencer especializado en productos de importación
- Habla español, tono informal pero profesional
- Audiencia hispanohablante (México/Latinoamérica)
- Nunca inventa precios — siempre verifica en sitios reales
- Responde al chat en 1-3 oraciones máximo

### 4.2 LLM Router (NUEVO — implementar en router.js)

El router decide qué API usar según el tipo de tarea:

```javascript
TIER 1 — Chat en vivo (volumen alto, respuesta rápida)
  Modelo principal : llama-3.1-8b-instant
  Límite           : 14,400 req/día | 560 tokens/seg
  Uso              : responder chat, saludos, comentarios, reacciones
  Failover         : llama-3.3-70b-versatile → groq/compound-mini

TIER 2 — Tareas complejas (bajo volumen, alta calidad)
  Modelo principal : groq/compound  ← AGENTE con web search + código
  Límite           : 250 req/día | tokens ILIMITADOS/día
  Uso              : buscar productos, analizar cotizaciones, calcular
  Fallback         : kimi-k2 (multilingüe/chino) → gpt-oss-120b

TIER 3 — Visión (cuando hay imagen/screenshot)
  Modelo           : llama-4-scout-17b
  Límite           : 1,000 req/día | 30,000 tokens/min
  Uso              : analizar fotos de productos, leer cotizaciones en imagen
```

**Lógica de failover**: Redis almacena contador de requests por modelo
por día. Si un modelo alcanza su límite, el router salta automáticamente
al siguiente en la lista.

### 4.3 groq/compound — qué es exactamente

`groq/compound` NO es un LLM simple. Es un sistema agente de Groq que:
- Tiene **búsqueda web en tiempo real integrada**
- Puede **ejecutar código** para cálculos exactos
- Tiene **razonamiento** estructurado
- Contexto de 131,072 tokens
- Velocidad ~450 tokens/seg
- **Tokens por día: ILIMITADOS** (solo 250 req/día)

Esto significa que para investigar productos en Amazon/Alibaba/1688,
groq/compound navega la web por sí solo — sin necesidad de Playwright
ni browser-service en el VPS.

### 4.4 Skills Engine (implementar)

Las skills son módulos de código que OpenClaw ejecuta según la situación:

#### skill: browser-research
```
HERRAMIENTA: groq/compound (web search integrado)
CUÁNDO: alguien pide precio, disponibilidad o info de un producto
FLUJO:
  1. OpenClaw detecta intención de búsqueda en el mensaje
  2. Llama a groq/compound con la query del producto
  3. compound busca en Amazon/Alibaba/1688 en tiempo real
  4. Devuelve precio, descripción, características
  5. OpenClaw formatea la respuesta para el avatar
ARCHIVO: openclaw/src/skills/browser.js
```

#### skill: product-showcase
```
HERRAMIENTA: groq/compound + chat-bridge API
CUÁNDO: OpenClaw decide mostrar un producto visualmente
FLUJO:
  1. browser-research obtiene datos del producto (nombre, precio, imagen)
  2. OpenClaw POST a chat-bridge:4000/api/command
     { type: "speak_and_show", text: "...", product: { name, price, image, features } }
  3. Avatar habla y muestra overlay del producto
  4. Después de 15-20s: POST { type: "hide_product" }
ARCHIVO: openclaw/src/skills/showcase.js
```

#### skill: quotation-analysis
```
HERRAMIENTA: groq/compound (ejecución de código) + kimi-k2 (si es en chino)
CUÁNDO: alguien comparte una cotización de importación
FLUJO:
  1. OpenClaw recibe texto/imagen de cotización
  2. Si es imagen → llama llama-4-scout para extraer datos
  3. Pasa datos a groq/compound para análisis
  4. compound ejecuta código: calcula landed cost, márgenes, conversión CNY→USD→MXN
  5. Explica al chat de forma clara y entretenida
ARCHIVO: openclaw/src/skills/quotation.js
CÁLCULOS QUE HACE:
  - Conversión de monedas (CNY, USD, MXN)
  - Incoterms (FOB, CIF, DDP, EXW)
  - Aranceles aduaneros por fracción arancelaria
  - Costo final landed (producto + flete + aduana + IVA)
  - Margen de ganancia sugerido
```

#### skill: stream-control
```
HERRAMIENTA: stream-compositor API (puerto 5000)
CUÁNDO: N8N programa inicio/fin de stream, o comando manual
FLUJO:
  POST stream-compositor:5000/api/go-live  → inicia captura + RTMP
  POST stream-compositor:5000/api/stop-all → detiene todo
ARCHIVO: openclaw/src/skills/stream.js
```

### 4.5 Memoria vectorial (Qdrant — implementar)

Qdrant ya corre en el VPS con 2GB asignados. Falta el código en OpenClaw:

```
Colección: influencer_memory
Documentos almacenados:
  - Productos mostrados anteriormente (nombre, precio, fecha, reacción audiencia)
  - Espectadores frecuentes (username, intereses, última visita)
  - Preguntas recurrentes y sus respuestas
  - Cotizaciones analizadas (producto, proveedor, precio final)

Uso: antes de cada respuesta, OpenClaw busca en Qdrant si tiene
     contexto previo relevante → respuestas más personalizadas
```

---

## 5. MEM0 — MEMORIA PERSISTENTE Y APRENDIZAJE CONTINUO

### 5.1 Qué es Mem0

Mem0 es una capa de memoria universal para agentes de IA. Open source,
self-hosted, 100% gratis. Extrae automáticamente recuerdos importantes
de cada conversación, los consolida y los recupera cuando son relevantes.

**Repositorio**: https://github.com/mem0ai/mem0
**Licencia**: Apache 2.0 — completamente gratis
**Infraestructura**: usa Qdrant + Redis que ya existen en el proyecto

### 5.2 Cómo funciona

```
Cada mensaje del stream:
  OpenClaw recibe mensaje de chat
       │
       ├─► Mem0.search(mensaje, viewer_id)
       │   → busca en Qdrant recuerdos relevantes
       │   → "Carlos preguntó esto antes"
       │   → "Este producto lo mostré el 15 feb a $280"
       │
       ├─► Inyecta recuerdos al contexto del LLM
       │   → respuesta más personalizada e inteligente
       │
       └─► Después de responder: Mem0.add(interacción)
           → guarda el nuevo recuerdo automáticamente
           → actualiza si ya existía información previa
```

### 5.3 Qué recuerda para siempre

```
PRODUCTOS (colección: products)
  {
    nombre: "Sony WH-1000XM5",
    precio_usd: 265,
    precio_anterior: 280,
    url_amazon: "...",
    fecha_mostrado: "2026-02-15",
    engagement: "alto",  // cuánto reaccionó la audiencia
    categoria: "electronica"
  }

ESPECTADORES (colección: viewers)
  {
    username: "Carlos_MX",
    plataforma: "tiktok",
    intereses: ["electronica", "audífonos", "gaming"],
    primera_visita: "2026-01-10",
    ultima_visita: "2026-03-01",
    preguntas_frecuentes: ["precios en Amazon", "envío a México"]
  }

COTIZACIONES (colección: quotations)
  {
    producto: "Auricular Bluetooth",
    proveedor_1688: "Shenzhen Tech Co.",
    precio_cny: 85,
    precio_usd_calculado: 13.50,
    landed_cost_mxn: 380,
    fecha: "2026-02-20"
  }

CONOCIMIENTO DE MERCADO (colección: market)
  {
    tendencia: "audífonos gaming van al alza",
    periodo: "Q1 2026",
    fuente: "observación de 15 streams"
  }
```

### 5.4 Qué logra el influencer con el tiempo

```
Semana 1:  Recuerda productos y sus precios
Mes 1:     Reconoce viewers recurrentes, los saluda por nombre
Mes 3:     Detecta tendencias de mercado, recomienda productos populares
Mes 6:     Sabe qué días/horarios tiene más audiencia, adapta contenido
Año 1:     Historial completo de precios → "Este producto bajó 30% vs el año pasado"
```

### 5.5 Configuración Docker

```yaml
mem0:
  image: mem0ai/mem0-server:latest
  container_name: influencer-mem0
  environment:
    VECTOR_STORE_PROVIDER: qdrant
    QDRANT_URL: http://qdrant:6333
    REDIS_URL: redis://redis:6379
    EMBEDDING_PROVIDER: sentence_transformers
    EMBEDDING_MODEL: all-MiniLM-L6-v2   # 90MB, CPU, gratis
    LLM_PROVIDER: openai                 # compatible con Groq
    LLM_BASE_URL: https://api.groq.com/openai/v1
    LLM_API_KEY: ${GROQ_API_KEY}
    LLM_MODEL: llama-3.1-8b-instant
  networks:
    - influencer-net
  depends_on:
    - qdrant
    - redis
  restart: unless-stopped
  deploy:
    resources:
      limits:
        memory: 1G
        cpus: '0.5'
```

### 5.6 Integración en OpenClaw (skills/memory.js)

```javascript
// ANTES de llamar al LLM:
const memories = await mem0.search(userMessage, {
  user_id: msg.user,
  limit: 5
})
// memories = ["Carlos preguntó por Sony el 15 feb",
//             "Sony WH-1000XM5 estaba a $280 USD"]

// Inyectar al system prompt:
const contextWithMemory = `${systemPrompt}
\nRecuerdos relevantes:\n${memories.join('\n')}`

// DESPUÉS de responder:
await mem0.add([
  { role: 'user', content: userMessage },
  { role: 'assistant', content: response.text }
], { user_id: msg.user })
```

### 5.7 Costo

```
Mem0 self-hosted:              $0
Qdrant (ya existe):            $0
Redis (ya existe):             $0
Embeddings (sentence-transf.): $0
RAM adicional:                 1GB
────────────────────────────────
TOTAL:                         $0 / mes ✅
Memorias almacenadas:          Ilimitadas (limitado por disco del VPS)
```

---

## 6. TTS — VOZ EN ESPAÑOL

### 5.1 Por qué se elimina HeadTTS
HeadTTS (Kokoro-82M) solo soporta inglés. El influencer necesita hablar
en español. HeadTTS queda eliminado del proyecto.

### 5.2 F5-TTS — el reemplazo

**Repositorio**: https://github.com/SWivid/F5-TTS
**Modelo español**: Spanish-F5-TTS (fine-tune específico)
**RAM**: ~7GB en CPU
**Latencia**: ~3-5s por frase (con streaming: primer chunk en ~1s)
**Voice cloning**: Sí — con 6 segundos de muestra de audio

#### Voice Cloning del influencer
Para darle al influencer una voz única y reconocible:
1. Grabar 6 segundos de audio con la voz deseada para el personaje
2. F5-TTS clona esa voz exacta
3. Toda la síntesis posterior usa esa voz → identidad vocal única

#### Modo streaming (mitigar latencia)
F5-TTS puede devolver audio en chunks. TalkingHead empieza
a reproducir el primer chunk (~1s) mientras se genera el resto.
El avatar no espera en silencio — empieza a moverse casi de inmediato.

#### Lip-sync
F5-TTS no genera visemas (datos de lip-sync exactos como HeadTTS).
TalkingHead usa estimación por audio (audio-based lip-sync).
Para un live stream de entretenimiento es suficientemente natural.

#### Integración
```
OpenClaw genera texto de respuesta
        ↓
POST http://f5-tts:8000/tts/stream
  { text: "Hola a todos!", voice: "influencer_voice.wav", language: "es" }
        ↓
F5-TTS devuelve audio WAV en streaming
        ↓
chat-bridge envía comando WS al avatar-frontend:
  { type: "speak", audioUrl: "...", text: "Hola a todos!" }
        ↓
TalkingHead.speakText() con audio externo → lip-sync estimado
```

---

## 6. MEJORAS VISUALES

### 6.1 Stable Diffusion — fondos dinámicos

**Uso**: Generar fondos de estudio profesionales y relevantes al contenido.
No es tiempo real — los fondos se pre-generan y se guardan en MinIO.

**Flujo**:
```
N8N cada hora durante el stream:
  1. Detecta qué categoría de producto se está mostrando
  2. POST stable-diffusion:7860/generate
     { prompt: "professional studio background, tech products, blue lighting, 8k" }
  3. Guarda imagen en MinIO
  4. Envía comando al avatar-frontend para cambiar fondo
     { type: "set_background", url: "https://s3.DOMAIN/fondos/tech-studio-001.jpg" }
```

**Modelos recomendados**:
- SDXL-Turbo (4 pasos, más rápido en CPU)
- Dreamshaper XL (mejor calidad para estudios/sets)

### 6.2 Real-ESRGAN — upscaling del video

**Uso**: Mejorar la calidad percibida del stream aplicando upscaling AI
al video antes de enviarlo a MediaMTX.

**Flujo en stream-compositor**:
```
X11grab captura el browser con el avatar (1080p)
        ↓
FFmpeg pipe → Real-ESRGAN (2x upscale, denoise)
        ↓
Output 2K/4K percibido → RTMP a MediaMTX
```

**Nota**: En CPU es más lento. Configurar a 15fps para el upscaling
y mantener 30fps para el stream sin upscaling. Activar solo si el
VPS tiene CPU suficiente en el momento.

### 6.3 Mejoras de Three.js (sin RAM extra — solo código)

Cambios en `avatar-frontend/dist/js/app.mjs`:
- **Post-processing**: bloom, SSAO, tone mapping ACES cinematográfico
- **Iluminación de 3 puntos**: key light frontal, fill light lateral, back light (rim)
- **Fondo dinámico**: soporte para cambiar el fondo via WebSocket command `set_background`
- **Sombras suaves**: PCFSoftShadowMap en el renderer

### 6.4 Modelo 3D mejorado

ReadyPlayerMe tiene calidad limitada. Alternativas que funcionan con TalkingHead:
- **VRM models** de alta calidad (formato .vrm, compatible con Three.js)
- **Custom GLB** con más polígonos, mejores texturas PBR, blend shapes para expresiones
- Sitios: VRoid Hub, Sketchfab (buscar "avatar VRM high quality")

---

## 7. AUTOMATIZACIÓN CON N8N

N8N gestiona el ciclo de vida del stream automáticamente.
Workflows ya existentes en `n8n-workflows/` (importar en n8n.DOMAIN):

| Workflow | Trigger | Acción |
|---|---|---|
| `01-scheduled-livestream.json` | Cron 8PM diario | Inicia stream via compositor API |
| `02-health-monitor.json` | Cada 5 min | Verifica salud de servicios, alerta si falla |
| `03-daily-product-research.json` | Cron 9AM | OpenClaw investiga productos del día |
| `04-chat-summary.json` | Al terminar stream | Genera resumen del chat con Ollama |

**Workflow nuevo a crear**:
- `05-background-rotation.json` — Cada 30 min genera nuevo fondo con Stable Diffusion

---

## 8. FLUJO COMPLETO DE UN STREAM EN VIVO

```
18:00 — N8N dispara inicio de stream
  → POST compositor:5000/api/go-live
  → FFmpeg empieza X11grab del browser
  → RTMP → MediaMTX → TikTok/YouTube

18:01 — Avatar saluda (frase pre-cacheada en Redis)
  → Sin llamada a API, respuesta instantánea

18:02 — Chat: "hola!"
  → chat-bridge lo recibe (TikTok connector)
  → Redis dedup: no es duplicado
  → Rate limiter: han pasado 3s desde última respuesta ✓
  → POST openclaw:3000/webhook/chat
  → Router: mensaje simple → TIER 1 (llama-3.1-8b-instant)
  → Respuesta en ~300ms: { action: "speak", text: "¡Hola! Bienvenido al stream!" }
  → chat-bridge WS → avatar-frontend
  → POST f5-tts:8000/tts/stream → audio WAV español
  → TalkingHead.speakText() → lip-sync → avatar habla

18:15 — Chat: "¿cuánto cuesta ese auricular en Amazon?"
  → Router: intención de búsqueda → TIER 2 (groq/compound)
  → compound busca en web "auricular [nombre] Amazon precio"
  → Devuelve: nombre, precio USD, link, características
  → skill: product-showcase →
      - OpenClaw habla del producto (F5-TTS)
      - Overlay aparece en pantalla con imagen y precio
      - Espera 20s → oculta overlay

18:30 — Chat: [imagen de cotización de Alibaba]
  → Router: hay imagen → TIER 3 (llama-4-scout)
  → Scout extrae datos de la imagen
  → skill: quotation-analysis → groq/compound ejecuta código:
      precio_cny = 85
      tipo_cambio = 7.15
      flete_usd = 12
      arancel = 0.15
      iva = 0.16
      landed_cost = ((precio_cny/tipo_cambio) + flete_usd) * (1+arancel) * (1+iva)
  → Avatar explica el cálculo al chat en español

18:30 — N8N genera nuevo fondo (Stable Diffusion)
  → prompt dinámico según productos mostrados en el stream
  → Fondo cambia suavemente en el avatar-frontend

22:00 — N8N dispara fin de stream
  → POST compositor:5000/api/stop-all
  → N8N genera resumen del chat
```

---

## 9. APIS EXTERNAS — GROQ

**Base URL**: `https://api.groq.com/openai/v1`
**Autenticación**: `Authorization: Bearer ${GROQ_API_KEY}`
**Compatible con**: OpenAI SDK (ya usado en OpenClaw)

### Límites del free tier relevantes

| Modelo | ID en API | Req/día | Tokens/día | Uso en proyecto |
|---|---|---|---|---|
| Llama 3.1 8B Instant | `llama-3.1-8b-instant` | 14,400 | 500K | Tier 1 principal |
| Groq Compound | `groq/compound` | 250 | **Ilimitado** | Tier 2 research |
| Groq Compound Mini | `groq/compound-mini` | 250 | **Ilimitado** | Tier 2 fallback |
| Kimi K2 | `moonshotai/kimi-k2-instruct` | 1,000 | 300K | Tier 2 chino |
| GPT OSS 120B | `openai/gpt-oss-120b` | 1,000 | 200K | Tier 2 razonamiento |
| Llama 4 Scout | `meta-llama/llama-4-scout-17b-16e-instruir` | 1,000 | 500K | Tier 3 visión |
| Llama 3.3 70B | `llama-3.3-70b-versatil` | 1,000 | 100K | Fallback Tier 1 |
| Whisper V3 | `whisper-large-v3` | 2,000 | 28.8K seg/día | STT si se necesita |

### Cambio en OpenClaw (config.yml)
Reemplazar DashScope/Qwen por Groq:
```yaml
models:
  tier1:
    provider: openai-compatible
    endpoint: https://api.groq.com/openai/v1
    apiKey: ${GROQ_API_KEY}
    model: llama-3.1-8b-instant
  tier2:
    provider: openai-compatible
    endpoint: https://api.groq.com/openai/v1
    apiKey: ${GROQ_API_KEY}
    model: groq/compound
  tier2_fallback:
    provider: openai-compatible
    endpoint: https://api.groq.com/openai/v1
    apiKey: ${GROQ_API_KEY}
    model: moonshotai/kimi-k2-instruct
  tier3:
    provider: openai-compatible
    endpoint: https://api.groq.com/openai/v1
    apiKey: ${GROQ_API_KEY}
    model: meta-llama/llama-4-scout-17b-16e-instruir
```

---

## 10. VARIABLES DE ENTORNO (.env)

```bash
# Dominio
DOMAIN=tudominio.com
ACME_EMAIL=tu@email.com

# Groq (LLM + STT)
GROQ_API_KEY=gsk_xxxxxxxxxxxx

# PostgreSQL
PG_USER=influencer
PG_PASSWORD=xxxxxxxxxxxx

# Redis
REDIS_URL=redis://redis:6379

# MinIO (grabaciones)
MINIO_ACCESS_KEY=xxxxxxxxxxxx
MINIO_SECRET_KEY=xxxxxxxxxxxx

# N8N
N8N_USER=admin
N8N_PASSWORD=xxxxxxxxxxxx

# Grafana
GRAFANA_USER=admin
GRAFANA_PASSWORD=xxxxxxxxxxxx

# Traefik dashboard
TRAEFIK_DASHBOARD_AUTH=user:hashedpassword

# TikTok Live
TIKTOK_SESSION_ID=xxxxxxxxxxxx
TIKTOK_USERNAME=@tuusuario

# YouTube Live
YOUTUBE_API_KEY=xxxxxxxxxxxx
YOUTUBE_VIDEO_ID=xxxxxxxxxxxx  # se actualiza en cada stream

# F5-TTS
TTS_VOICE_SAMPLE=/app/voices/influencer.wav  # 6s de muestra de voz
TTS_LANGUAGE=es

# Stable Diffusion
SD_MODEL=sdxl-turbo
SD_STEPS=4
```

---

## 11. ESTRUCTURA DE ARCHIVOS — LO QUE SE VA A IMPLEMENTAR

```
influencer/
├── ARQUITECTURA.md          ← este archivo
├── docker-compose.yml       ← MODIFICAR: openclaw 4GB, compositor 6CPU,
│                               reemplazar headtts por f5-tts,
│                               agregar stable-diffusion y real-esrgan
├── .env.example             ← MODIFICAR: añadir GROQ_API_KEY, quitar DASHSCOPE
│
├── openclaw/
│   ├── src/
│   │   ├── index.js         ← MODIFICAR: integrar router, skills engine
│   │   ├── router.js        ← CREAR: selección de tier + failover con Redis
│   │   └── skills/
│   │       ├── browser.js   ← CREAR: usa groq/compound para web search
│   │       ├── showcase.js  ← CREAR: product overlay via chat-bridge
│   │       ├── quotation.js ← CREAR: análisis de cotizaciones + cálculos
│   │       ├── stream.js    ← CREAR: control del compositor
│   │       └── memory.js    ← CREAR: lectura/escritura Qdrant
│   ├── config/
│   │   └── config.yml       ← MODIFICAR: reemplazar DashScope por Groq tiers
│   └── package.json         ← MODIFICAR: añadir @qdrant/js-client-rest
│
├── f5-tts/                  ← CREAR: reemplaza headtts/
│   ├── Dockerfile           ← Python, F5-TTS, Spanish fine-tune
│   ├── entrypoint.sh
│   └── voices/              ← aquí va el .wav de 6s para voice cloning
│
├── stable-diffusion/        ← CREAR
│   ├── Dockerfile           ← Python, diffusers, SDXL-Turbo
│   └── app.py               ← API REST: POST /generate → imagen
│
├── real-esrgan/             ← CREAR
│   ├── Dockerfile           ← Python, basicsr, realesrgan
│   └── app.py               ← recibe frames de video, devuelve upscalado
│
├── avatar-frontend/
│   └── dist/js/
│       └── app.mjs          ← MODIFICAR: post-processing Three.js,
│                               iluminación 3 puntos, soporte set_background
│
├── headtts/                 ← ELIMINAR (reemplazado por f5-tts)
│
└── n8n-workflows/
    └── 05-background-rotation.json  ← CREAR: genera fondos cada 30min
```

---

## 12. ORDEN DE IMPLEMENTACIÓN

Para no desviarnos, implementar en este orden:

### Fase 1 — Base funcional (lo más importante primero)
1. **Cambiar proveedor de LLM en OpenClaw** — reemplazar DashScope/Qwen por Groq en config.yml y .env
2. **Implementar router.js** — OpenClaw decide qué modelo de Groq usar según el tipo de tarea
3. **Implementar skill: browser.js** — OpenClaw usa groq/compound para buscar productos en web
4. **Implementar skill: showcase.js** — OpenClaw muestra productos en el avatar via chat-bridge

### Fase 2 — Voz en español
5. **Reemplazar HeadTTS por F5-TTS** — Dockerfile + integración con TalkingHead
6. **Voice cloning** — grabar sample de 6 segundos y configurar F5-TTS

### Fase 3 — Memoria e inteligencia
7. **Añadir Mem0 al docker-compose** — conectar a Qdrant + Redis existentes
8. **Implementar skill: memory.js** — integrar Mem0 en OpenClaw
9. **Implementar skill: quotation.js** — análisis de cotizaciones con memoria

### Fase 4 — Calidad visual
10. **Post-processing Three.js** — iluminación + bloom + tone mapping
11. **Stable Diffusion** — fondos dinámicos AI
12. **Real-ESRGAN** — upscaling de video

### Fase 5 — Automatización
13. **Configurar N8N workflows** — stream programado, health monitor
14. **Workflow de fondos** — rotación automática cada 30 min

---

## 13. NOTAS IMPORTANTES — NO DESVIARSE

- **OpenClaw es el agente, los LLMs son herramientas** que usa OpenClaw.
  Nunca confundir groq/compound con OpenClaw.

- **groq/compound tiene web search integrado** — no necesitamos Playwright
  ni browser-service. Eso simplifica enormemente la arquitectura.

- **F5-TTS reemplaza HeadTTS completamente** — el volumen `headtts_cache`
  se renombra a `f5tts_voices` en docker-compose.

- **El lip-sync será estimado por audio** (no visemas exactos) con F5-TTS.
  Esto es suficiente para streaming de entretenimiento.

- **Las APIs de Groq son gratuitas** con los límites descritos.
  No se requiere tarjeta de crédito para el free tier.

- **Stable Diffusion NO es tiempo real** — los fondos se pre-generan.
  Un fondo nuevo cada 30 minutos durante el stream.

- **Real-ESRGAN es opcional y costoso en CPU** — activar solo si hay
  CPU disponible. Si ralentiza el stream, desactivar.
