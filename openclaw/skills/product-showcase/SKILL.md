# Product Showcase

Investiga y presenta un producto a la audiencia. Puede navegar Amazon, Alibaba o 1688 para obtener detalles del producto, luego mostrarlos con el avatar.

## Uso
- "Muestra a la audiencia este producto: [URL]"
- "Busca productos populares de [categoria]"
- "Compara estos dos productos"
- "Que precio tiene este producto en Amazon?"

## Implementacion

### Paso 1: Investigar el producto
Usa la herramienta de navegador para ir a la URL del producto y extraer:
- Nombre del producto
- Precio
- Imagen principal
- Caracteristicas clave (3-5 puntos)
- Rating/valoracion

### Paso 2: Analisis con Vision (para paginas complejas)
Si la pagina tiene muchas imagenes o layout complejo, toma un screenshot y usa el modelo de vision (API externa) para analizar:
- Precio real vs precio de lista
- Caracteristicas destacadas de las imagenes
- Comparacion visual con productos similares

### Paso 3: Enviar al avatar
```
POST http://chat-bridge:4000/api/command
Content-Type: application/json
```

```json
{
  "type": "speak_and_show",
  "text": "Miren este producto increible que encontre! Es un [nombre] y esta a solo [precio].",
  "product": {
    "name": "Nombre del Producto",
    "price": "$XX.XX USD",
    "image": "https://url-de-la-imagen.jpg",
    "features": [
      "Caracteristica 1",
      "Caracteristica 2",
      "Caracteristica 3"
    ]
  }
}
```

### Paso 4: Ocultar overlay despues
Esperar 15-20 segundos, luego:
```json
{
  "type": "hide_product"
}
```

## Sitios soportados
- **Amazon** (.com, .com.mx) - Cookies en /app/cookies/amazon.json
- **Alibaba** (.com) - Cookies en /app/cookies/alibaba.json
- **1688.com** - Cookies en /app/cookies/1688.json

## Notas
- Siempre convertir precios a USD o MXN segun el contexto
- Si un producto de 1688 esta en CNY, convertir y mencionar ambos precios
- Mantener las descripciones breves y entusiastas para el stream
- Usar emocion "excited" al presentar productos
