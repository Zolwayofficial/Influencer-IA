/**
 * Skill: showcase
 * Muestra un producto en el overlay del avatar via chat-bridge.
 * El avatar habla mientras se muestra la tarjeta del producto en pantalla.
 * Despues de HIDE_DELAY_MS oculta el overlay automaticamente.
 *
 * Uso: showProduct(product, speakText)
 *   product  : objeto {name, price, image, features[]}
 *   speakText: texto que dira el avatar (opcional, se genera automaticamente)
 */

'use strict';

const http  = require('http');
const https = require('https');

const CHAT_BRIDGE_HOST = process.env.CHAT_BRIDGE_HOST || 'chat-bridge';
const CHAT_BRIDGE_PORT = parseInt(process.env.CHAT_BRIDGE_PORT || '4000', 10);
const HIDE_DELAY_MS    = parseInt(process.env.SHOWCASE_HIDE_DELAY || '18000', 10); // 18s

/**
 * Envia un comando JSON a chat-bridge via HTTP interno.
 * @param {object} payload
 * @returns {Promise<void>}
 */
function postCommand(payload) {
  return new Promise((resolve, reject) => {
    const body    = JSON.stringify(payload);
    const options = {
      hostname: CHAT_BRIDGE_HOST,
      port:     CHAT_BRIDGE_PORT,
      path:     '/api/command',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    // Elegir http o https segun el puerto
    const transport = CHAT_BRIDGE_PORT === 443 ? https : http;
    const req = transport.request(options, (res) => {
      res.resume(); // consumir el body para liberar el socket
      if (res.statusCode >= 400) {
        reject(new Error(`chat-bridge respondio ${res.statusCode}`));
      } else {
        resolve();
      }
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Muestra un producto en el stream con overlay y texto hablado.
 * La llamada es no-bloqueante: el hide ocurre automaticamente despues del delay.
 *
 * @param {object} product - {name, price, image, features[]}
 * @param {string} [speakText] - Texto que dira el avatar. Si se omite, se genera.
 * @returns {Promise<void>} Resuelve cuando el show_product fue enviado (no espera hide).
 */
async function showProduct(product, speakText) {
  const text = speakText || _buildSpeakText(product);

  console.log(`[Showcase] Mostrando: ${product.name} @ ${product.price}`);

  await postCommand({
    type:    'speak_and_show',
    text,
    emotion: 'excited',
    product: {
      name:     product.name     || 'Producto',
      price:    product.price    || '?',
      image:    product.image    || null,
      features: (product.features || []).slice(0, 4),
    },
  });

  // Ocultar overlay despues del delay — no bloquea el return
  setTimeout(async () => {
    try {
      await postCommand({ type: 'hide_product' });
      console.log('[Showcase] Overlay ocultado');
    } catch (err) {
      console.error('[Showcase] Error al ocultar overlay:', err.message);
    }
  }, HIDE_DELAY_MS);
}

/**
 * Genera texto de presentacion del producto si no se proporciona.
 */
function _buildSpeakText(product) {
  const name  = product.name  || 'este producto increible';
  const price = product.price || 'un precio increible';
  const feat  = product.features?.[0] || '';
  const extra = feat ? ` ${feat}.` : '!';
  return `Miren esto! ${name} por solo ${price}.${extra} Que opinan en el chat?`;
}

module.exports = { showProduct };
