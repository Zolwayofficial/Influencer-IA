# API Contracts

Estado: active
Última actualización: 2026-05-05

## Endpoints Internos (Docker network)

### openclaw — :3000

| Endpoint | Método | Propósito | Payload |
|---|---|---|---|
| `/api/status` | GET | Estado del sistema | `{ streaming, tts, agent }` |
| `/api/narrate-frame` | POST | Narración de frame via vision AI | `{ imageBase64 }` |
| `/api/speak` | POST | Hablar con emoción | `{ text, emotion }` |
| `/api/product` | POST | Mostrar producto | `{ name, price, original_price, image, qr_url }` |

### chat-bridge — :4000

| Endpoint | Método | Propósito |
|---|---|---|
| `/api/status` | GET | Estado del chat bridge |
| `/ws/commands` | WS | Canal de comandos en tiempo real |

## Routing Externo (Traefik → control.virtufan.com)

| Ruta externa | Destino interno |
|---|---|
| `/ctrl/*` | `chat-bridge:4000/api/*` |
| `/agent/*` | `openclaw:3000/api/*` |
| `/ws/commands` | `chat-bridge` WebSocket |
| `/agent/narrate-frame` | `openclaw:3000/api/narrate-frame` |

## Regla

Cualquier cambio en estos endpoints debe actualizar este archivo ANTES de tocar el código.
