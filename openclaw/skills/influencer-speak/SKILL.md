# Influencer Speak

Haz que el avatar 3D hable texto con lip-sync y emocion opcional.

## Uso
- "Saluda a la audiencia"
- "Diles sobre este producto"
- "Reacciona al regalo"
- "Agradece al usuario por seguirnos"

## Implementacion

Envia un POST request al Avatar Frontend:

```
POST http://avatar-frontend:8080/api/command
Content-Type: application/json
```

### Hablar texto simple
```json
{
  "type": "speak",
  "text": "El texto que quieres que diga el avatar",
  "emotion": "happy",
  "language": "es"
}
```

### Emociones disponibles
- `neutral` - expresion normal
- `happy` - sonriente, energetico
- `excited` - muy entusiasmado
- `surprised` - sorprendido (para regalos)
- `thinking` - pensativo (mientras busca info)

### Reproducir animacion
```json
{
  "type": "emote",
  "animation": "waving",
  "mood": "happy"
}
```

### Animaciones disponibles
- `idle` - posicion de espera
- `waving` - saludar con la mano
- `pointing` - señalar (hacia producto)
- `talking` - gestos al hablar
- `nodding` - asentir

### Detener habla
```json
{
  "type": "stop_speaking"
}
```

## Notas
- El avatar usa HeadTTS (Kokoro) para generar voz con lip-sync automatico
- El idioma por defecto es español (`es`)
- Mantener los textos cortos (1-3 oraciones) para mejor fluidez
- Usar emocion `excited` para productos y `surprised` para regalos grandes
