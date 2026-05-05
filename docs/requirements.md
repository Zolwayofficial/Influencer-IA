# Requirements

Estado: active
Última actualización: 2026-05-05

## 1. Producto

- Nombre: Influencer-IA (Influencer 3D Powerhouse)
- Descripción: Sistema autónomo de influencer virtual 3D con avatar lip-sync, navegación web, chat en vivo y streaming a TikTok/YouTube.
- Problema que resuelve: Permite hacer livestreaming con un avatar IA 24/7 sin operador humano, respondiendo al chat en vivo, mostrando productos y narrando contenido de forma autónoma.
- Usuarios principales: Billy (operador único, proyecto privado).
- Contexto de uso: VPS Contabo Ubuntu 22.04, transmisión via TikTok Live Studio o OBS, acceso al panel de control via `control.virtufan.com`.

## 2. MVP

El MVP incluye:

- Avatar 3D con lip-sync en tiempo real (TalkingHead + Three.js)
- TTS funcional en VPS (gTTS activo)
- Panel de control (control.html) con 11 secciones coloreadas
- Stream mode con token `?key=live1234` / preview sin token
- Screen share capturado correctamente por TikTok Live Studio (canvas proxy)
- Lector de chat TikTok y YouTube
- Narración automática de slides de presentación (Canva vía screen share)
- Showcase de productos (nombre, precio, imagen, QR)
- Auto-browse de productos con pitch IA

El MVP no incluye:

- Multi-avatar simultáneo
- Panel de analytics/estadísticas de stream
- Integración con pagos o e-commerce directo
- Voz personalizada (Kokoro/HeadTTS requiere 64GB RAM; VPS actual es más pequeño)

## 3. Casos De Uso

| ID | Usuario | Necesidad | Resultado Esperado | Prioridad |
|---|---|---|---|---|
| UC-001 | Billy | Hacer livestream con avatar sin operador | Avatar responde chat, habla y gesticula en tiempo real | P0 |
| UC-002 | Billy | Mostrar producto en stream | Panel envía producto; avatar lo presenta con precio, imagen y QR en pantalla | P0 |
| UC-003 | Billy | Presentar slides de Canva en stream | Avatar detecta cambio de slide y narra automáticamente el contenido | P1 |
| UC-004 | Billy | Controlar avatar remotamente | Panel de control en control.virtufan.com (PIN 1977) permite comandos en tiempo real | P0 |
| UC-005 | Billy | Capturar stream con TikTok Live Studio | Stream compositor captura el avatar correctamente sin MPO overlay issues | P0 |

## 4. Criterios De Aceptación Globales

- [ ] Avatar visible y capturado por TikTok Live Studio sin frame negro
- [ ] Lip-sync sincronizado con audio generado por TTS
- [ ] Chat de TikTok y YouTube procesado y respondido por OpenClaw
- [ ] Panel de control accesible en `control.virtufan.com` con PIN
- [ ] Comando de producto muestra overlay correctamente en el stream
- [ ] Screen share de Canva narrado automáticamente al cambiar slide

## 5. Fuera De Alcance

- Entrenamiento de modelos de IA propios
- Automatización de carga de videos a TikTok/YouTube (solo streaming)
- Multi-idioma (solo español por ahora)
- App móvil de control

## 6. Preguntas Abiertas

- ¿Migrar TTS de gTTS a Kokoro cuando se amplíe el VPS?
- ¿Agregar avatar femenino alternativo para campañas?
- ¿Integrar Evolution API para alertas por WhatsApp cuando el stream se corta?
