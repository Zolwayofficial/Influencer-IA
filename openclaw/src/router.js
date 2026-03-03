/**
 * OpenClaw LLM Router
 * Enruta cada tarea al tier de Groq correcto segun el tipo de trabajo.
 *
 * Tier 1 — Chat rapido   : llama-3.1-8b-instant  (14,400 req/dia, ~200ms)
 * Tier 2 — Research/web  : compound-beta          (250 req/dia, tokens ILIMITADOS/dia)
 * Tier 3 — Vision        : llama-4-scout          (1,000 req/dia, multimodal)
 *
 * Todos los tiers usan la misma GROQ_API_KEY con distintos model IDs.
 * Redis lleva contadores diarios por tier para monitoreo de limites.
 */

'use strict';

const { OpenAI } = require('openai');
const Redis = require('ioredis');

const GROQ_BASE = 'https://api.groq.com/openai/v1';
const GROQ_KEY  = process.env.GROQ_API_KEY || '';

// Un solo cliente HTTP apunta a la misma base; solo cambia el model ID por llamada.
const groq = new OpenAI({ apiKey: GROQ_KEY, baseURL: GROQ_BASE });

const MODELS = {
  // Tier 1: respuestas de chat al stream (rapido, alto volumen)
  chat:     'llama-3.1-8b-instant',
  // Tier 2: investigacion de productos con busqueda web integrada
  research: 'compound-beta',
  // Tier 3: analisis de imagenes / capturas de pantalla
  vision:   'meta-llama/llama-4-scout-17b-16e-instruct',
};

// Redis para tracking de uso diario (no bloquea si Redis no esta disponible)
let redis = null;
try {
  redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379', {
    lazyConnect: true,
    enableOfflineQueue: false,
    retryStrategy: () => null, // no reintentar si no esta disponible
  });
  redis.connect().catch(() => { redis = null; });
} catch { redis = null; }

async function _trackUsage(tier) {
  if (!redis) return;
  try {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const key = `groq:usage:${tier}:${today}`;
    await redis.incr(key);
    await redis.expire(key, 172800); // 48h para cubrir zona horaria
  } catch { /* no-op */ }
}

// ---------------------------------------------------------------------------
// Tier 1 — Chat rapido
// Uso: responder mensajes del stream en tiempo real
// ---------------------------------------------------------------------------
async function chatCompletion(messages, { temperature = 0.8, maxTokens = 300 } = {}) {
  await _trackUsage('t1_chat');
  const res = await groq.chat.completions.create({
    model: MODELS.chat,
    messages,
    temperature,
    max_tokens: maxTokens,
  });
  return res.choices[0]?.message?.content || '';
}

// ---------------------------------------------------------------------------
// Tier 2 — Research con web search (compound-beta)
// Uso: buscar productos en Amazon/Alibaba/1688, investigar precios, comparar
// compound-beta tiene acceso a internet integrado, no requiere tools externas.
// ---------------------------------------------------------------------------
async function researchCompletion(messages, { temperature = 0.3 } = {}) {
  await _trackUsage('t2_research');
  const res = await groq.chat.completions.create({
    model: MODELS.research,
    messages,
    temperature,
    // compound-beta no acepta max_tokens — usa su propia gestion de tokens
  });
  return res.choices[0]?.message?.content || '';
}

// ---------------------------------------------------------------------------
// Tier 3 — Vision (analisis de imagenes)
// Uso: analizar capturas de pantalla de productos, comparar imagenes
// messages puede incluir content type image_url
// ---------------------------------------------------------------------------
async function visionCompletion(messages, { temperature = 0.5, maxTokens = 500 } = {}) {
  await _trackUsage('t3_vision');
  const res = await groq.chat.completions.create({
    model: MODELS.vision,
    messages,
    temperature,
    max_tokens: maxTokens,
  });
  return res.choices[0]?.message?.content || '';
}

module.exports = { chatCompletion, researchCompletion, visionCompletion, MODELS };
