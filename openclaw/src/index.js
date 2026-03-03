'use strict';

const express = require('express');
const fs      = require('fs');
const yaml    = require('js-yaml');
const path    = require('path');

// LLM router — Groq 3-tier
const { chatCompletion, MODELS } = require('./router');

// Skills
const { searchProduct } = require('./skills/browser');
const { showProduct   } = require('./skills/showcase');

// Memoria persistente — Mem0 + Qdrant
const { getContextForChat, saveInteraction } = require('./memory');

const PORT = process.env.OC_GATEWAY_PORT || 3000;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
let config = {};
try {
  const configPath = path.join(__dirname, '..', 'config', 'config.yml');
  const raw        = fs.readFileSync(configPath, 'utf8');
  const resolved   = raw.replace(/\$\{(\w+)(?::-([^}]*))?\}/g, (_, key, fallback) => {
    return process.env[key] || fallback || '';
  });
  config = yaml.load(resolved);
} catch (err) {
  console.warn('[Config] Error cargando config.yml:', err.message);
}

// ---------------------------------------------------------------------------
// System prompt (identidad del influencer)
// ---------------------------------------------------------------------------
const identity = config.identity || {};

const systemPrompt = `${identity.description || 'Eres un influencer virtual de productos de importacion.'}

Personalidad:
${(identity.personality || []).map(p => `- ${p}`).join('\n')}

Reglas:
${(identity.rules || []).map(r => `- ${r}`).join('\n')}

IMPORTANTE: Responde SIEMPRE en formato JSON valido con esta estructura exacta:
{
  "action": "speak" | "show_product" | "ignore",
  "text": "Lo que dira el avatar (1-3 oraciones cortas, en español)",
  "emotion": "neutral" | "happy" | "excited" | "surprised" | "thinking",
  "query": "(solo si action es show_product) URL o termino de busqueda del producto"
}

Cuando usar cada action:
- "speak"        : respuesta normal al chat
- "show_product" : cuando alguien pide ver/mostrar/precio de un producto especifico
                   Incluir "query" con la URL o nombre del producto.
- "ignore"       : spam, irrelevante, repetido, sin contexto

Ejemplos de show_product:
  Chat: "muestra ese auricular de Amazon" → action: show_product, query: "auriculares bluetooth Amazon"
  Chat: "cuanto cuesta este: amazon.com/dp/B09..." → action: show_product, query: "amazon.com/dp/B09..."

Si el mensaje no merece respuesta (spam, ofensivo, sin sentido), usa "action": "ignore".
Para regalos y nuevos seguidores, siempre responde con emotion "surprised" o "excited".`;

// ---------------------------------------------------------------------------
// Historial de conversacion (ventana deslizante)
// ---------------------------------------------------------------------------
const conversationHistory = [];
const MAX_HISTORY = 20;

function addToHistory(role, content) {
  conversationHistory.push({ role, content });
  if (conversationHistory.length > MAX_HISTORY) {
    conversationHistory.shift();
  }
}

// ---------------------------------------------------------------------------
// Procesar mensaje del chat
// ---------------------------------------------------------------------------
async function processChat(msg) {
  const userMessage = `[${msg.platform || 'unknown'}] ${msg.user || 'viewer'} (${msg.type || 'chat'}): ${msg.text}`;
  addToHistory('user', userMessage);

  // Recuperar contexto de memoria relevante (best-effort, no bloquea si mem0 esta caido)
  const memoryContext = await getContextForChat(msg.text || userMessage);

  // Construir system prompt enriquecido con memoria
  const fullSystem = memoryContext
    ? `${systemPrompt}\n\n${memoryContext}`
    : systemPrompt;

  let parsed;

  try {
    const raw = await chatCompletion(
      [{ role: 'system', content: fullSystem }, ...conversationHistory],
      { temperature: 0.8, maxTokens: 300 },
    );

    addToHistory('assistant', raw);

    // Extraer JSON de la respuesta (puede venir con markdown)
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) throw new Error('No JSON en la respuesta');
    parsed = JSON.parse(jsonMatch[0]);

  } catch (err) {
    console.error('[LLM] Error procesando mensaje:', err.message);
    return { action: 'ignore', error: err.message };
  }

  // Guardar interaccion en memoria (async, no bloquea la respuesta)
  saveInteraction(msg, parsed).catch(() => { /* best-effort */ });

  // -------------------------------------------------------------------------
  // Manejar action: show_product
  // -------------------------------------------------------------------------
  if (parsed.action === 'show_product' && parsed.query) {
    console.log(`[OpenClaw] show_product detectado, query: ${parsed.query}`);

    // Investigar el producto (async, no bloquea la respuesta al webhook)
    _handleProductShowcase(parsed.query).catch(err => {
      console.error('[OpenClaw] Error en showcase:', err.message);
    });

    // Responder inmediatamente al chat-bridge con el speak de anticipacion
    return {
      action:  'speak',
      text:    parsed.text || 'Un momento, voy a buscar ese producto!',
      emotion: parsed.emotion || 'excited',
    };
  }

  return parsed;
}

/**
 * Flujo completo de showcase (async, no bloquea processChat):
 * 1. Busca el producto con compound-beta
 * 2. Muestra el overlay en el avatar
 */
async function _handleProductShowcase(query) {
  const product = await searchProduct(query);

  if (!product.found && product.error) {
    console.warn(`[Showcase] Producto no encontrado: ${product.error}`);
    return;
  }

  // speakText sera generado automaticamente en showcase.js si no se pasa
  await showProduct(product, null);
}

// ---------------------------------------------------------------------------
// Express API
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({
    status:      'ok',
    models:      MODELS,
    historySize: conversationHistory.length,
  });
});

// Webhook: recibe mensajes de chat-bridge
app.post('/webhook/chat', async (req, res) => {
  const msg = req.body;
  console.log(`[Chat] ${msg.platform}/${msg.user}: ${msg.text}`);

  const response = await processChat(msg);
  console.log(`[Response] action=${response.action} | ${response.text || '(ignored)'}`);

  res.json(response);
});

// Comando manual: hacer que el avatar hable
app.post('/api/speak', (req, res) => {
  const { text, emotion, language } = req.body;
  res.json({
    action:   'speak',
    text:     text || 'Hola a todos!',
    emotion:  emotion || 'happy',
    language: language || 'es',
  });
});

// Comando manual: buscar y mostrar un producto directamente
app.post('/api/showcase', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'query requerido' });

  res.json({ status: 'searching', query });

  // Ejecutar showcase en background
  _handleProductShowcase(query).catch(err => {
    console.error('[API/showcase] Error:', err.message);
  });
});

// Resetear historial de conversacion
app.post('/api/reset', (_req, res) => {
  conversationHistory.length = 0;
  res.json({ status: 'history cleared' });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`[OpenClaw] Agent gateway corriendo en puerto ${PORT}`);
  console.log(`[OpenClaw] Tier 1 (chat):     ${MODELS.chat}`);
  console.log(`[OpenClaw] Tier 2 (research):  ${MODELS.research}`);
  console.log(`[OpenClaw] Tier 3 (vision):    ${MODELS.vision}`);
});
