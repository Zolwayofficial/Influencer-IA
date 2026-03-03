# Voces para F5-TTS — Clonación de Voz

## Cómo agregar tu voz

F5-TTS clona cualquier voz con solo **6 segundos de audio**.

### Archivos requeridos

Para cada voz necesitas dos archivos con el mismo nombre base:

```
/app/voices/
├── reference.wav   ← Audio de muestra (6-10 segundos, WAV 24kHz mono)
└── reference.txt   ← Transcripción exacta de lo que se dice en el audio
```

### Requisitos del audio

- **Formato**: WAV (PCM 16-bit, mono)
- **Sample rate**: 22050 Hz o 24000 Hz (F5-TTS convierte automáticamente)
- **Duración**: 6-10 segundos (más corto = menos calidad)
- **Calidad**: Sin ruido de fondo, voz clara
- **Idioma**: Español (el mismo idioma que usará el influencer)

### Ejemplo de referencia.txt

```
Hola a todos, bienvenidos a mi canal. Hoy les voy a mostrar los mejores productos de importación directa desde China.
```

### Cómo grabar

1. Abre tu grabadora de voz en el teléfono o PC
2. Habla durante 8-10 segundos con tu voz natural
3. Guarda como WAV o convierte: `ffmpeg -i grabacion.mp3 -ar 24000 -ac 1 reference.wav`
4. Escribe exactamente lo que dijiste en `reference.txt`
5. Copia ambos archivos a este directorio
6. Reinicia el contenedor: `docker compose restart f5-tts`

### Múltiples voces

Puedes tener varias voces y seleccionar via API:

```bash
# Usar voz alternativa
curl -X POST http://localhost:8882/tts \
  -H "Content-Type: application/json" \
  -d '{"text": "Hola mundo", "voice": "voz_alternativa", "speed": 1.0}'
```

### Probar la voz

```bash
# Genera audio de prueba
curl -X POST http://localhost:8882/tts \
  -H "Content-Type: application/json" \
  -d '{"text": "Bienvenidos al stream! Hoy tenemos productos increíbles.", "speed": 1.0}' \
  -o prueba.wav && play prueba.wav
```
