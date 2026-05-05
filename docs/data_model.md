# Data Model

Estado: active
Última actualización: 2026-05-05

## Nota

Este proyecto no tiene modelo de datos relacional central (no es una app CRUD). Los datos son efímeros y de configuración.

## Datos Persistentes

| Dato | Dónde vive | Formato | Sensible |
|---|---|---|---|
| Vectores de conocimiento (Qdrant) | VPS Docker — Qdrant | Vectores + metadata | No |
| Workflows N8N | VPS Docker — PostgreSQL | JSON | No |
| Objetos MinIO (videos grabados) | VPS Docker — MinIO | MP4/binario | No |
| Métricas Prometheus | VPS Docker — Prometheus | Time series | No |

## Datos Efímeros

| Dato | Dónde vive | TTL |
|---|---|---|
| Cola de mensajes de chat | Redis | Hasta consumo |
| Estado del stream | Redis | Sesión activa |
| Sesión de control panel | Browser (PIN) | Tab activa |

## Datos Sensibles

| Dato | Ubicación | Manejo |
|---|---|---|
| Contraseña VPS | Solo en scripts locales de dev | No commitear |
| Groq API key | `.env` en VPS | No en repo |
| PIN panel (1977) | `control.html` o config | No exponer en logs |
| Stream token (`live1234`) | `docker-compose.yml` | Visible en URL pública (aceptado) |
