# Browser Research

Navega sitios web de forma autonoma para investigar productos, precios y tendencias. Soporta navegacion con cookies de sesion para acceder a cuentas logueadas.

## Uso
- "Investiga los productos mas vendidos en Amazon categoria tecnologia"
- "Busca el precio de [producto] en Alibaba"
- "Navega a [URL] y dime que ves"
- "Compara precios de [producto] entre Amazon y 1688"

## Implementacion

### Navegacion basica
Usa la herramienta de navegador integrada de OpenClaw para:
1. Navegar a la URL especificada
2. Esperar a que la pagina cargue completamente
3. Extraer informacion relevante del DOM

### Cookies disponibles
Los archivos de cookies estan en `/app/cookies/`:
- `amazon.json` - Sesion de Amazon
- `alibaba.json` - Sesion de Alibaba
- `1688.json` - Sesion de 1688.com

Antes de navegar, cargar las cookies correspondientes al dominio.

### Patron de busqueda
1. Detectar el dominio de la URL
2. Cargar cookies si existen para ese dominio
3. Navegar a la URL
4. Esperar carga completa (domcontentloaded + networkidle)
5. Si es necesario, hacer scroll para cargar contenido lazy
6. Extraer datos estructurados
7. Si la pagina es compleja, tomar screenshot y usar vision

### Comportamiento humano
Para evitar deteccion de bots:
- Agregar delays aleatorios entre acciones (1-3 segundos)
- Hacer scroll suave (no instantaneo)
- Mover el mouse de forma natural antes de hacer click
- No hacer mas de 10 requests por minuto al mismo dominio

## Notas
- Las cookies deben ser exportadas manualmente desde el navegador del usuario
- Si una cookie expira, la navegacion continuara como invitado
- Para productos de 1688, el contenido puede estar en chino - usar el LLM para traducir
