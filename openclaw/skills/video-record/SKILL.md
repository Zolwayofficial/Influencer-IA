# Video Record

Genera videos pregrabados con el avatar 3D. El avatar sigue un guion, presenta productos y el resultado se guarda como MP4 en MinIO.

## Uso
- "Graba un video presentando estos 3 productos"
- "Genera un video de 2 minutos sobre [tema]"
- "Crea un video de bienvenida para el canal"

## Implementacion

### Paso 1: Generar guion
Usar el LLM para crear un guion con estructura:
```json
{
  "segments": [
    {"type": "speak", "text": "Hola! Bienvenidos...", "emotion": "happy"},
    {"type": "emote", "animation": "waving"},
    {"type": "speak_and_show", "text": "Miren este producto...", "product": {...}},
    {"type": "pause", "duration": 2000},
    {"type": "speak", "text": "Gracias por ver!", "emotion": "happy"},
    {"type": "emote", "animation": "waving"}
  ]
}
```

### Paso 2: Iniciar grabacion
```
POST http://stream-compositor:5000/api/record/start
{"filename": "video_productos_enero.mp4"}
```

### Paso 3: Ejecutar segmentos del guion
Para cada segmento, enviar el comando al avatar:
```
POST http://chat-bridge:4000/api/command
```
Esperar la duracion estimada de cada segmento antes de enviar el siguiente.

### Paso 4: Detener grabacion
```
POST http://stream-compositor:5000/api/record/stop
```
El video se sube automaticamente a MinIO.

### Paso 5: Notificar
Informar al usuario que el video esta disponible en:
```
GET http://stream-compositor:5000/api/recordings
```

## Notas
- Los videos se graban en 1080p a 30fps
- Duracion recomendada: 1-5 minutos por video
- Incluir pausas entre segmentos para transiciones naturales
- El avatar debe estar en estado idle entre segmentos de habla
