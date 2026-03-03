/**
 * Skill: browser
 * Investiga productos usando compound-beta (busqueda web integrada de Groq).
 * No necesita Playwright ni Chrome — compound-beta navega por cuenta propia.
 *
 * Uso: searchProduct(query)
 *   query: URL directa ("https://www.amazon.com/...") o termino ("auriculares bluetooth")
 * Retorna: objeto con name, price, image, features, rating, store, url
 */

'use strict';

const { researchCompletion } = require('../router');

const SYSTEM_PROMPT = `Eres un asistente especializado en investigar productos de importacion.
Tu trabajo: buscar el producto indicado en tiendas online (Amazon, Alibaba, 1688) y extraer datos clave.

Responde SIEMPRE con un JSON valido y nada mas. Estructura exacta:
{
  "name": "Nombre completo del producto",
  "price": "Precio principal con moneda (ej: $29.99 USD o $450 MXN)",
  "price_usd": 29.99,
  "image": "URL de la imagen principal del producto (si disponible)",
  "features": [
    "Caracteristica destacada 1",
    "Caracteristica destacada 2",
    "Caracteristica destacada 3"
  ],
  "rating": "4.5/5 (1,234 reseñas)",
  "store": "amazon | alibaba | 1688 | otro",
  "url": "URL final del producto",
  "found": true
}

Si no encuentras el producto responde:
{"found": false, "error": "motivo breve"}

Reglas importantes:
- Precios: incluir siempre la moneda. Si el precio esta en CNY (yuan chino), convertir a USD tambien.
- Features: maximo 5 caracteristicas, breves y utiles para el comprador.
- No inventar datos: si un campo no esta disponible, usar null.`;

/**
 * Busca informacion de un producto usando compound-beta con web search.
 * @param {string} query - URL del producto o termino de busqueda
 * @returns {Promise<object>} Datos del producto o {found: false, error: string}
 */
async function searchProduct(query) {
  console.log(`[Browser] Buscando producto: ${query}`);

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Busca y extrae informacion de este producto: ${query}\n\nResponde SOLO con el JSON, sin texto adicional.`,
    },
  ];

  try {
    const raw = await researchCompletion(messages, { temperature: 0.2 });
    console.log(`[Browser] Respuesta raw (${raw.length} chars)`);

    // Extraer JSON de la respuesta (puede venir con texto extra o bloques markdown)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[Browser] No se encontro JSON en la respuesta');
      return { found: false, error: 'No se pudo extraer informacion del producto' };
    }

    const result = JSON.parse(jsonMatch[0]);
    console.log(`[Browser] Producto encontrado: ${result.name || 'desconocido'} @ ${result.price || '?'}`);
    return result;

  } catch (err) {
    console.error('[Browser] Error buscando producto:', err.message);
    return { found: false, error: err.message };
  }
}

module.exports = { searchProduct };
