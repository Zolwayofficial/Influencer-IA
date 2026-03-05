'use strict';

const express = require('express');
const fs      = require('fs');
const os      = require('os');
const yaml    = require('js-yaml');
const path    = require('path');
const multer  = require('multer');

// LLM router — Groq 3-tier
const { chatCompletion, MODELS } = require('./router');

// Skills
const { searchProduct }                          = require('./skills/browser');
const { showProduct   }                          = require('./skills/showcase');
const { calculateImport, formatQuotationSpeech } = require('./skills/quotation');

// Reflex layer — respuestas instantáneas sin LLM
const { reflexCheck } = require('./reflex');

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
  "action": "speak" | "show_product" | "get_quotation" | "ignore",
  "text": "Lo que dira el avatar (1-3 oraciones cortas, en español)",
  "emotion": "neutral" | "happy" | "excited" | "surprised" | "thinking",
  "query": "(solo si show_product o get_quotation) URL o termino de busqueda del producto",
  "quantity": 1
}

Cuando usar cada action:
- "speak"         : respuesta normal al chat
- "show_product"  : cuando alguien pide ver/mostrar un producto especifico
                    Incluir "query" con la URL o nombre del producto.
- "get_quotation" : cuando alguien pregunta cuanto cuesta importar, precio en Peru,
                    cuanto sale traer, cuanto es el costo total, precio Lima, etc.
                    Incluir "query" con el nombre del producto y "quantity" si especifica cantidad.
- "ignore"        : spam, irrelevante, repetido, sin contexto

Ejemplos:
  "muestra ese auricular"  → show_product, query: "auriculares bluetooth Amazon"
  "cuanto cuesta el iPhone 15 en Peru" → get_quotation, query: "iPhone 15", quantity: 1
  "cuanto sale traer 10 auriculares de China" → get_quotation, query: "auriculares bluetooth 1688", quantity: 10
  "precio importar laptop gaming" → get_quotation, query: "laptop gaming", quantity: 1

Si el mensaje no merece respuesta (spam, ofensivo, sin sentido), usa "action": "ignore".
Para regalos y nuevos seguidores, siempre responde con emotion "surprised" o "excited".`;

// ---------------------------------------------------------------------------
// Estado global del agente
// ---------------------------------------------------------------------------
let autoShowcaseEnabled = true; // se puede activar/desactivar desde el panel

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
  // -------------------------------------------------------------------------
  // Reflex layer: respuesta instantánea para eventos predecibles (sin LLM)
  // -------------------------------------------------------------------------
  const reflexResponse = reflexCheck(msg);
  if (reflexResponse) {
    // Guardar en historial para mantener contexto
    addToHistory('user',      `[${msg.platform || 'unknown'}] ${msg.user || 'viewer'}: ${msg.text}`);
    addToHistory('assistant', reflexResponse.text);
    return reflexResponse;
  }

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
    if (!autoShowcaseEnabled) {
      console.log('[OpenClaw] show_product bloqueado (autoShowcase desactivado)');
      parsed.action = 'speak';
      return parsed;
    }

    console.log(`[OpenClaw] show_product detectado, query: ${parsed.query}`);

    // Investigar el producto (async, no bloquea la respuesta al webhook)
    _handleProductShowcase(parsed.query).catch(err => {
      console.error('[OpenClaw] Error en showcase:', err.message);
    });

    return {
      action:  'speak',
      text:    parsed.text || 'Un momento, voy a buscar ese producto!',
      emotion: parsed.emotion || 'excited',
    };
  }

  // -------------------------------------------------------------------------
  // Manejar action: get_quotation
  // -------------------------------------------------------------------------
  if (parsed.action === 'get_quotation' && parsed.query) {
    console.log(`[OpenClaw] get_quotation detectado, query: ${parsed.query} qty: ${parsed.quantity || 1}`);

    _handleQuotation(parsed.query, parsed.quantity || 1).catch(err => {
      console.error('[OpenClaw] Error en quotation:', err.message);
    });

    return {
      action:  'speak',
      text:    parsed.text || 'Un momento, calculo el costo de importacion!',
      emotion: 'thinking',
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

  await showProduct(product, null);
}

/**
 * Flujo completo de cotización de importación (async, no bloquea processChat):
 * 1. Busca precio del producto con compound-beta
 * 2. Calcula costo de importación a Lima (SUNAT + flete)
 * 3. Hace que el avatar diga el desglose en voz
 */
async function _handleQuotation(query, quantity) {
  const { sendCommand } = require('./skills/showcase');

  // 1. Buscar precio del producto
  const product = await searchProduct(query);
  if (!product.found || !product.price_usd) {
    console.warn(`[Quotation] No se pudo obtener precio para: ${query}`);
    await sendCommand({
      type:    'speak',
      text:    `No encontre el precio de ${query}. Intenta con una URL directa o nombre mas especifico.`,
      emotion: 'neutral',
    });
    return;
  }

  // 2. Calcular importación
  const q = calculateImport({
    fobUsd:       product.price_usd,
    weightKg:     product.weight_kg || 0.5,
    productTitle: product.name || query,
    quantity:     quantity || 1,
  });

  const speech = formatQuotationSpeech(q);
  console.log(`[Quotation] ${product.name} — Landed: $${q.totalLandedUsd} USD | Ruta: ${q.route}`);

  // 3. Avatar habla el desglose + muestra tarjeta de producto enriquecida
  await showProduct(
    {
      ...product,
      name:     product.name,
      price:    `$${q.totalLandedUsd} USD en Lima (S/ ${q.totalLandedPen})`,
      features: [
        `FOB: $${q.fobUsd} USD`,
        `Flete + seguro: $${(q.freightUsd + q.insuranceUsd).toFixed(2)} USD`,
        q.totalTaxesUsd > 0 ? `Impuestos SUNAT: $${q.totalTaxesUsd} USD` : 'Sin impuestos (de minimis)',
        `Ruta: ${q.route}`,
        q.restriction !== 'NONE' ? `⚠️ Requiere: ${q.restriction}` : `Partida: ${q.hsCode}`,
      ],
    },
    speech,
  );
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

// Toggle showcase automatico — activar o desactivar desde el panel de control
app.post('/api/autoshowcase', (req, res) => {
  const { enabled } = req.body;
  autoShowcaseEnabled = enabled !== false; // true por defecto si no se especifica
  console.log(`[OpenClaw] autoShowcase ${autoShowcaseEnabled ? 'ACTIVADO' : 'DESACTIVADO'}`);
  res.json({ autoShowcaseEnabled });
});

// Estado actual del agente
app.get('/api/status', (_req, res) => {
  res.json({ autoShowcaseEnabled, historySize: conversationHistory.length });
});

// Resetear historial de conversacion
app.post('/api/reset', (_req, res) => {
  conversationHistory.length = 0;
  res.json({ status: 'history cleared' });
});

// ---------------------------------------------------------------------------
// Knowledge upload — PDF, Excel, Word, TXT → Mem0
// ---------------------------------------------------------------------------
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 20 * 1024 * 1024 } });

app.post('/api/knowledge', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibio archivo.' });

  const tmpPath = req.file.path;
  const source  = req.file.originalname || 'upload';
  const ext     = path.extname(source).toLowerCase();

  let text = '';
  try {
    if (ext === '.txt' || ext === '.md') {
      text = fs.readFileSync(tmpPath, 'utf8');

    } else if (ext === '.pdf') {
      const pdfParse = require('pdf-parse');
      const buf = fs.readFileSync(tmpPath);
      const data = await pdfParse(buf);
      text = data.text;

    } else if (ext === '.xlsx' || ext === '.xls') {
      const XLSX = require('xlsx');
      const wb = XLSX.readFile(tmpPath);
      const lines = [];
      wb.SheetNames.forEach(name => {
        const ws  = wb.Sheets[name];
        const csv = XLSX.utils.sheet_to_csv(ws);
        if (csv.trim()) lines.push(`[Hoja: ${name}]\n${csv}`);
      });
      text = lines.join('\n\n');

    } else if (ext === '.docx' || ext === '.doc') {
      const mammoth = require('mammoth');
      const result  = await mammoth.extractRawText({ path: tmpPath });
      text = result.value;

    } else {
      fs.unlinkSync(tmpPath);
      return res.status(400).json({ error: 'Formato no soportado. Usa PDF, Excel, Word o TXT.' });
    }

    fs.unlinkSync(tmpPath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    return res.status(500).json({ error: `Error al leer archivo: ${err.message}` });
  }

  if (!text.trim()) return res.json({ ok: true, source, chunks: 0 });

  // Chunk text ~800 chars with 100-char overlap
  const CHUNK = 800, OVERLAP = 100;
  const chunks = [];
  let pos = 0;
  while (pos < text.length) {
    chunks.push(text.slice(pos, pos + CHUNK));
    pos += CHUNK - OVERLAP;
  }

  const { addMemory } = require('./memory');
  let saved = 0;
  for (const chunk of chunks) {
    try {
      await addMemory(chunk, 'influencer', { type: 'knowledge', source });
      saved++;
    } catch (err) {
      console.error('[Knowledge] Error guardando chunk:', err.message);
    }
  }

  console.log(`[Knowledge] ${source}: ${saved}/${chunks.length} chunks guardados en Mem0`);
  res.json({ ok: true, source, chunks: saved });
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
