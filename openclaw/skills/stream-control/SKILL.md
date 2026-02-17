# Stream Control

Controla el livestream: iniciar/detener streaming, iniciar/detener grabacion, verificar salud del stream.

## Uso
- "Inicia el livestream"
- "Detener el stream y guardar la grabacion"
- "Verificar si el stream esta funcionando"
- "Ir en vivo con grabacion"

## Implementacion

### Iniciar streaming
```
POST http://stream-compositor:5000/api/stream/start
```

### Detener streaming
```
POST http://stream-compositor:5000/api/stream/stop
```

### Iniciar grabacion
```
POST http://stream-compositor:5000/api/record/start
Content-Type: application/json

{"filename": "video_opcional.mp4"}
```

### Detener grabacion (se sube automaticamente a MinIO)
```
POST http://stream-compositor:5000/api/record/stop
```

### Ir en vivo + grabar simultaneamente
```
POST http://stream-compositor:5000/api/go-live
Content-Type: application/json

{"filename": "livestream_2024_01_15.mp4"}
```

### Detener todo
```
POST http://stream-compositor:5000/api/stop-all
```

### Verificar estado
```
GET http://stream-compositor:5000/health
```
Respuesta:
```json
{
  "status": "ok",
  "streaming": true,
  "recording": true,
  "uptime": 3600,
  "config": {
    "resolution": "1920x1080",
    "fps": "30",
    "bitrate": "4000k"
  }
}
```

### Listar grabaciones guardadas
```
GET http://stream-compositor:5000/api/recordings
```

## Conexion a plataformas
Una vez iniciado el stream, MediaMTX lo hace disponible en:
- **SRT**: `srt://TU_IP:8890?streamid=read:live/influencer`
- **RTMP**: `rtmp://TU_IP:1935/live/influencer`
- **HLS**: `http://TU_IP:8888/live/influencer`
- **WebRTC**: `http://TU_IP:8889/live/influencer`

Para conectar a TikTok Live Studio u OBS:
1. En OBS, agregar fuente de Media
2. URL: `srt://TU_IP:8890?streamid=read:live/influencer`
3. Configurar buffering al minimo

## Notas
- Las grabaciones se guardan automaticamente en MinIO (bucket: recordings)
- El stream usa libx264 con preset veryfast y tune zerolatency
- Bitrate por defecto: 4000kbps (ajustable via variables de entorno)
