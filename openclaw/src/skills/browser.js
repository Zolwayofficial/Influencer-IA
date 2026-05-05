/**
 * Skill: browser
 * Investiga productos usando el microservicio Product Hunter (scraping real).
 * Antes usaba compound-beta (Groq) pero fallaba con 413 Request Entity Too Large.
 *
 * Uso: searchProduct(query)
 *   query: URL directa ("https://www.amazon.com/...") o termino ("auriculares bluetooth")
 * Retorna: objeto con name, price, image, features, rating, store, url, found
 */

'use strict';

const http = require('http');

const HUNTER_HOST = process.env.PRODUCT_HUNTER_HOST || 'product-hunter';
const HUNTER_PORT = parseInt(process.env.PRODUCT_HUNTER_PORT || '5001', 10);

/**
 * Llama al Product Hunter microservice y retorna el primer resultado.
 * @param {string} query - Termino de busqueda o URL
 * @returns {Promise<object>} Datos del producto o {found: false, error: string}
 */
async function searchProduct(query) {
  console.log(`[Browser] Buscando producto via Product Hunter: ${query}`);

  return new Promise((resolve) => {
    const encoded = encodeURIComponent(query);
    const path    = `/search?q=${encoded}&source=auto&limit=3`;

    const options = {
      hostname: HUNTER_HOST,
      port:     HUNTER_PORT,
      path,
      method:   'GET',
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json    = JSON.parse(data);
          const results = json.results || [];

          if (!results.length) {
            console.warn('[Browser] Producto no encontrado en Product Hunter');
            resolve({ found: false, error: 'No se encontraron resultados' });
            return;
          }

          const product = results[0];
          console.log(`[Browser] Producto encontrado: ${product.name} @ ${product.price}`);
          resolve({ ...product, found: true });

        } catch (err) {
          console.error('[Browser] Error parseando respuesta:', err.message);
          resolve({ found: false, error: err.message });
        }
      });
    });

    req.on('error', (err) => {
      console.error('[Browser] Error conectando a Product Hunter:', err.message);
      resolve({ found: false, error: err.message });
    });

    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ found: false, error: 'Timeout buscando producto' });
    });

    req.end();
  });
}

module.exports = { searchProduct };
