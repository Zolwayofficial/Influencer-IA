# Environment

Estado: active
Última actualización: 2026-05-05

## 1. Entornos

| Entorno | Descripción | URL |
|---|---|---|
| Producción | VPS Contabo 194.163.172.161 | avatar.virtufan.com |
| Dev local | C:\Users\Billy\influencer\ | localhost (sin servidor local) |

No existe entorno de staging. Los cambios se prueban en producción con precaución.

## 2. Variables De Entorno Clave (VPS)

Definidas en `/opt/influencer/.env` — NO en el repo.

| Variable | Propósito |
|---|---|
| `TTS_ENGINE` | Motor TTS activo (`gtts`) |
| `AVATAR_URL` | URL del avatar para el compositor (`http://avatar-frontend:8080/?key=live1234`) |
| `GROQ_API_KEY` | API key de Groq para narración |
| `OLLAMA_MODEL` | Modelo LLM local (`qwen2.5:7b`) |

## 3. Runtime Local (Windows dev)

| Tool | Propósito |
|---|---|
| plink / pscp (PuTTY) | SSH/SCP al VPS |
| Node.js ≥18 | Scripts locales (factoria-check, etc.) |
| Git | Control de versiones |
