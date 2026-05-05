# Module Map

Estado: active
Última actualización: 2026-05-05

| Módulo | Responsabilidad | Dueño | Contratos | Datos | Riesgos |
|---|---|---|---|---|---|
| avatar-frontend | Render 3D, lip-sync, screen share, product overlay, panel | Billy | api_contracts.md (recibe speak/product) | Ninguno persistente | AP-001 MPO CSS, AP-002 video proxy |
| chat-bridge | Lectura chat TikTok+YouTube, dedup, cola Redis | Billy | WS /ws/commands, /api/status | Redis (cola efímera) | RISK-002 TikTok API change |
| openclaw | Agente IA, orquesta skills, decide respuesta | Billy | api_contracts.md (expone /api/*) | Qdrant (vectores) | RISK-006 Groq rate limit |
| stream-compositor | Chromium headless + FFmpeg → MediaMTX | Billy | AVATAR_URL env var | Ninguno | RISK-005 RAM pico |
| f5-tts | Servidor gTTS, síntesis de voz | Billy | HTTP interno Docker | Ninguno | RISK-001 gTTS bloqueado |
| mediamtx | Distribución SRT/RTMP/HLS/WebRTC | Billy | Puertos 8890/1935/8888/8889 | Ninguno | — |
| traefik | Reverse proxy + SSL | Billy | DNS virtufan.com | Ninguno | — |
