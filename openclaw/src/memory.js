/**
 * OpenClaw Memory — Cliente para Mem0 Server
 * Proporciona memoria persistente e ilimitada al agente.
 *
 * Mem0 + Qdrant guardan recuerdos vectorizados que persisten entre streams.
 * El influencer recuerda preferencias de viewers, productos mostrados,
 * conversaciones importantes y aprende con el tiempo.
 *
 * API:
 *   addMemory(text, userId?, metadata?)  — guardar recuerdo
 *   searchMemory(query, userId?, limit?) — recuperar contexto relevante
 *   getContextForChat(userMsg, userId?)  — string de contexto listo para el LLM
 */

'use strict';

const http  = require('http');
const https = require('https');

const MEM0_BASE = process.env.MEM0_URL || 'http://mem0:6789';
const DEFAULT_USER = 'influencer';

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------
function _post(path, body, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const data    = JSON.stringify(body);
    const url     = new URL(path, MEM0_BASE);
    const transport = url.protocol === 'https:' ? https : http;
    const options = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = transport.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve({}); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('mem0 timeout')); });
    req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// API publica
// ---------------------------------------------------------------------------

/**
 * Guarda un recuerdo en Mem0.
 * Mem0 deduplica y mergea recuerdos similares automaticamente.
 *
 * @param {string} text     - Texto del recuerdo
 * @param {string} userId   - Identificador del usuario (default: 'influencer')
 * @param {object} metadata - Metadatos opcionales (plataforma, timestamp, etc.)
 */
async function addMemory(text, userId = DEFAULT_USER, metadata = {}) {
  // 300s: mem0 hace dedup con Groq+Qdrant, tarda 1-3min cuando hay muchas memorias
  await _post('/memories/add', { text, user_id: userId, metadata }, 300000);
}

/**
 * Busca recuerdos relevantes para una query.
 *
 * @param {string} query  - Pregunta o contexto a buscar
 * @param {string} userId - Identificador del usuario
 * @param {number} limit  - Maximo de resultados
 * @returns {Promise<Array<{memory: string, score: number}>>}
 */
async function searchMemory(query, userId = DEFAULT_USER, limit = 5) {
  try {
    // 5s: si mem0 es lento en chat, fallback silencioso
    const res = await _post('/memories/search', { query, user_id: userId, limit }, 5000);
    return res.memories || [];
  } catch (err) {
    console.warn('[Memory] No se pudo buscar en memoria:', err.message);
    return [];
  }
}

/**
 * Recupera contexto de memoria relevante para inyectar en el prompt del LLM.
 * Retorna un string formateado o string vacio si no hay memoria relevante.
 *
 * @param {string} userMessage - Mensaje del viewer (usado como query de busqueda)
 * @param {string} userId      - ID del usuario
 * @returns {Promise<string>}  - Bloque de contexto para el LLM, o ''
 */
async function getContextForChat(userMessage, userId = DEFAULT_USER) {
  const memories = await searchMemory(userMessage, userId, 4);
  if (!memories.length) return '';

  const lines = memories
    .filter(m => m.memory && m.score > 0.4)  // umbral de relevancia
    .map(m => `- ${m.memory}`);

  if (!lines.length) return '';

  return `[MEMORIA RELEVANTE]\n${lines.join('\n')}`;
}

/**
 * Guarda una interaccion importante del stream en la memoria.
 * Solo guarda si la accion fue significativa (no 'ignore').
 *
 * @param {object} msg      - Mensaje del chat {platform, user, text, type}
 * @param {object} response - Respuesta del agente {action, text}
 */
async function saveInteraction(msg, response) {
  if (response.action === 'ignore') return;

  // Construir descripcion del recuerdo
  const parts = [];

  if (msg.type === 'gift') {
    parts.push(`El viewer @${msg.user} hizo un regalo en ${msg.platform}.`);
  } else if (msg.type === 'subscribe' || msg.type === 'follow') {
    parts.push(`@${msg.user} se suscribio/siguio en ${msg.platform}.`);
  } else if (msg.text) {
    // Solo guardar mensajes de chat con contenido interesante
    parts.push(`Chat de @${msg.user} en ${msg.platform}: "${msg.text}"`);
  }

  if (response.action === 'show_product' && response.query) {
    parts.push(`El influencer mostro producto: "${response.query}".`);
  } else if (response.text) {
    parts.push(`El influencer respondio: "${response.text}"`);
  }

  const memText = parts.join(' ');
  if (memText.length > 20) {
    const metadata = {
      platform: msg.platform,
      user:     msg.user,
      type:     msg.type,
      ts:       new Date().toISOString(),
    };
    await addMemory(memText, DEFAULT_USER, metadata);
  }
}

module.exports = { addMemory, searchMemory, getContextForChat, saveInteraction };
