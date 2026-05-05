# Risk Register

Estado: active
Última actualización: 2026-05-05

| ID | Riesgo | Nivel | Probabilidad | Impacto | Mitigación | Estado |
|---|---|---|---|---|---|---|
| RISK-001 | gTTS bloqueado por Google (IPs datacenter) | Alto | Media | Alto | Preparar Kokoro cuando VPS escale a GPU | open |
| RISK-002 | TikTok-Live-Connector roto por cambio de API TikTok | Alto | Media | Alto | Monitorear repo zerodytrash; fallback manual | open |
| RISK-003 | Contraseña VPS en scripts de deploy | Medio | Baja | Alto | No commitear scripts; .gitignore activo | aceptado |
| RISK-004 | TalkingHead @1.7 CDN breaking change en @2.x | Medio | Baja | Medio | Pinnear versión en importmap | open |
| RISK-005 | Stream-compositor crashea VPS por RAM pico | Alto | Media | Alto | Monitorear con Prometheus; no builds en paralelo con stream | open |
| RISK-006 | Groq API rate limit durante stream activo | Medio | Baja | Medio | Fallback a Ollama local para narración | open |
