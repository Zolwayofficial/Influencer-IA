# Workflows N8N

Workflows exportados listos para importar en tu instancia de N8N.

## Como importar

1. Abre N8N en `https://n8n.tudominio.com`
2. Ve a **Settings > Import from File**
3. Selecciona el archivo `.json` del workflow

## Workflows disponibles

| # | Archivo | Descripcion | Trigger |
|---|---------|-------------|---------|
| 01 | `01-scheduled-livestream.json` | Inicia stream + grabacion automatica y saluda a la audiencia | Cron diario (8:00 PM) |
| 02 | `02-health-monitor.json` | Verifica salud de todos los servicios, alerta si algo cae | Cada 5 minutos |
| 03 | `03-daily-product-research.json` | OpenClaw investiga productos trending en Amazon | Cron diario (9:00 AM) |
| 04 | `04-chat-summary.json` | Resume el chat del stream con Ollama y guarda reporte | Webhook manual |

## Configuracion requerida

### Para el workflow 02 (Monitor de Salud)
- Cambiar la URL de `ntfy.sh/influencer-alerts` por tu canal real de notificaciones
- Alternativa: reemplazar el nodo de alerta por WhatsApp (Evolution API) o Telegram

### Para el workflow 03 (Investigacion)
- Crear la tabla en PostgreSQL:
```sql
CREATE TABLE daily_products (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  products_json JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Para el workflow 04 (Resumen)
- Crear la tabla en PostgreSQL:
```sql
CREATE TABLE stream_reports (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  total_messages INTEGER,
  unique_users INTEGER,
  gift_count INTEGER,
  summary TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```
- Llamar el webhook al terminar un stream: `curl -X POST https://n8n.tudominio.com/webhook/stream-ended`

## Notas
- Todos los workflows usan timezone `America/Mexico_City` - ajustar segun tu ubicacion
- Los horarios del cron se pueden cambiar directamente en N8N despues de importar
- Los workflows de PostgreSQL requieren configurar las credenciales de la DB en N8N
