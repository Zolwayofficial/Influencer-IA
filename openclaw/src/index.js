'use strict';

const express = require('express');
const fs      = require('fs');
const os      = require('os');
const yaml    = require('js-yaml');
const path    = require('path');
const multer  = require('multer');

// LLM router — Groq 3-tier
const { chatCompletion, visionCompletion, MODELS } = require('./router');

// Skills
const { searchProduct }                          = require('./skills/browser');
const { showProduct   }                          = require('./skills/showcase');
const { calculateImport, formatQuotationSpeech } = require('./skills/quotation');
const { screenshot: browserScreenshot }          = require('./skills/browser-control');
const { startPresentation, nextSlide, prevSlide, stopPresentation, getState: getPresentationState, setAutoAdvance } = require('./skills/presentation');

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
  "action": "speak" | "show_product" | "get_quotation" | "show_browser" | "describe_slide" | "next_slide" | "prev_slide" | "ignore",
  "text": "Lo que dira el avatar (1-3 oraciones cortas, en español)",
  "emotion": "neutral" | "happy" | "excited" | "surprised" | "thinking",
  "query": "(solo si show_product o get_quotation) URL o termino de busqueda del producto",
  "url": "(solo si show_browser) URL completa https://... a mostrar en pantalla",
  "quantity": 1,
  "duration": 20
}

Cuando usar cada action:
- "speak"          : respuesta normal al chat
- "show_product"   : cuando alguien pide ver/mostrar un producto especifico
                     Incluir "query" con la URL o nombre del producto.
- "get_quotation"  : cuando alguien pregunta cuanto cuesta importar, precio en Peru,
                     cuanto sale traer, cuanto es el costo total, precio Lima, etc.
                     Incluir "query" con el nombre del producto y "quantity" si especifica cantidad.
- "show_browser"   : cuando alguien pide ver una pagina web, tienda, o quiere que muestres
                     algo en pantalla. Solo usar si tienes una URL real (https://...).
                     Siempre usa "duration": 9999 (la pantalla no desaparece sola).
- "describe_slide" : cuando te piden exponer, describir, hablar de, o explicar la diapositiva actual.
                     Usaras vision IA para ver la diapositiva y describir su contenido en voz.
                     Palabras clave: "expón", "describe", "qué dice ahí", "explica esto", "habla de esto".
- "next_slide"     : cuando te piden avanzar, siguiente diapositiva, continuar la presentacion.
                     Palabras clave: "siguiente", "avanza", "próxima", "continua", "pasa la diapositiva".
- "prev_slide"     : cuando te piden volver atrás, diapositiva anterior.
                     Palabras clave: "anterior", "regresa", "atrás", "vuelve".
- "ignore"         : spam, irrelevante, repetido, sin contexto

Ejemplos:
  "muestra ese auricular"  → show_product, query: "auriculares bluetooth Amazon"
  "cuanto cuesta el iPhone 15 en Peru" → get_quotation, query: "iPhone 15", quantity: 1
  "cuanto sale traer 10 auriculares de China" → get_quotation, query: "auriculares bluetooth 1688", quantity: 10
  "precio importar laptop gaming" → get_quotation, query: "laptop gaming", quantity: 1
  "muestrame Amazon" → show_browser, url: "https://www.amazon.com", duration: 20
  "abre Alibaba" → show_browser, url: "https://www.alibaba.com", duration: 20
  "expón la diapositiva" → describe_slide
  "explica esto" → describe_slide
  "siguiente diapositiva" → next_slide
  "avanza" → next_slide
  "regresa" → prev_slide

Si el mensaje no merece respuesta (spam, ofensivo, sin sentido), usa "action": "ignore".
Para regalos y nuevos seguidores, siempre responde con emotion "surprised" o "excited".`;

// ---------------------------------------------------------------------------
// Estado global del agente
// ---------------------------------------------------------------------------
let autoShowcaseEnabled   = true;     // se puede activar/desactivar desde el panel
let currentMode           = 'agentic'; // 'conversational' | 'agentic' | 'autonomous'
let autonomousModeEnabled = false;     // true cuando currentMode === 'autonomous'
let latestScreenshot      = null;      // { data: base64jpeg, ts: Date.now() }

// Auto-browse product loop
let autoBrowseEnabled    = false;
let autoBrowseList       = [];          // [{ query: string, label?: string }]
let autoBrowseIndex      = 0;
let autoBrowseIntervalMs = 120_000;    // default 2 min
let autoBrowseTimer      = null;
let autoBrowseBusy       = false;
const AUTO_BROWSE_MIN_WAIT = 21_000;   // min wait inside loop (showcase hide + buffer)

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
    const screenshot = autonomousModeEnabled && latestScreenshot &&
      (Date.now() - latestScreenshot.ts < 30000) ? latestScreenshot.data : null;

    let raw;
    if (screenshot) {
      console.log('[Autónomo] Usando vision model con screenshot de pantalla');
      raw = await visionCompletion([
        { role: 'system', content: fullSystem + '\n\nMODO AUTÓNOMO ACTIVO: La imagen adjunta es captura en vivo de la pantalla que estás mostrando. Úsala para responder preguntas específicas: precios, características, disponibilidad, comparaciones.' },
        ...conversationHistory.slice(0, -1).slice(-6),
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: screenshot } },
          { type: 'text', text: userMessage },
        ]},
      ]);
    } else {
      raw = await chatCompletion(
        [{ role: 'system', content: fullSystem }, ...conversationHistory],
        { temperature: 0.8, maxTokens: 300 },
      );
    }

    addToHistory('assistant', raw);

    // Extraer JSON de la respuesta (puede venir con markdown)
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) throw new Error('No JSON en la respuesta');
    parsed = JSON.parse(jsonMatch[0]);

  } catch (err) {
    console.error('[LLM] Error procesando mensaje:', err.message);
    return { action: 'ignore', error: err.message };
  }

  // Modo conversacional: forzar solo hablar desde el CHAT (operador puede ejecutar libremente)
  if (currentMode === 'conversational' && parsed.action !== 'ignore' && msg.platform !== 'panel') {
    parsed.action = 'speak';
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

  // -------------------------------------------------------------------------
  // Manejar action: show_browser
  // -------------------------------------------------------------------------
  if (parsed.action === 'show_browser' && parsed.url) {
    console.log(`[OpenClaw] show_browser detectado, url: ${parsed.url}`);

    _handleBrowserShow(parsed.url, parsed.text, parsed.duration || 20).catch(err => {
      console.error('[OpenClaw] Error en show_browser:', err.message);
    });

    return {
      action:  'speak',
      text:    parsed.text || 'Un momento, abro esa pagina!',
      emotion: parsed.emotion || 'excited',
    };
  }

  // -------------------------------------------------------------------------
  // Manejar actions de presentación: describe_slide, next_slide, prev_slide
  // -------------------------------------------------------------------------
  if (['describe_slide', 'next_slide', 'prev_slide'].includes(parsed.action)) {
    console.log(`[OpenClaw] slide action detectada: ${parsed.action}`);
    // La presentation skill ya habla al avanzar — NO devolver ack con contenido inventado
    _handleSlideAction(parsed.action).catch(err => {
      console.error('[OpenClaw] Error en slide action:', err.message);
    });
    const ackText = {
      describe_slide: '',  // presentation skill habla con vision real
      next_slide:     '',  // presentation skill describe el nuevo slide
      prev_slide:     '',  // presentation skill describe el slide anterior
    };
    const ack = ackText[parsed.action];
    return ack ? { action: 'speak', text: ack, emotion: parsed.emotion || 'excited' } : { action: 'ignore' };
  }

  return parsed;
}

/**
 * Flujo completo de showcase (async, no bloquea processChat):
 * 1. Busca el producto con compound-beta
 * 2. Muestra el overlay en el avatar
 */
async function _handleProductShowcase(query) {
  const wasRunning = _pauseAutoBrowse();
  try {
    const product = await searchProduct(query);
    if (!product.found && product.error) {
      console.warn(`[Showcase] Producto no encontrado: ${product.error}`);
      return;
    }
    await showProduct(product, null);
  } finally {
    if (wasRunning) _resumeAutoBrowse();
  }
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

/**
 * Controla la presentación activa desde el agente:
 * - describe_slide: toma screenshot actual y describe con vision IA
 * - next_slide / prev_slide: avanza o retrocede y describe
 */
async function _handleSlideAction(action) {
  const { sendCommand } = require('./skills/showcase');
  const pState = getPresentationState();

  if (!pState.active) {
    await sendCommand({
      type:    'speak',
      text:    'No hay una presentación activa en este momento.',
      emotion: 'neutral',
    }).catch(() => {});
    return;
  }

  try {
    if (action === 'next_slide') {
      await nextSlide();
    } else if (action === 'prev_slide') {
      await prevSlide();
    } else {
      // describe_slide: tomar screenshot fresco y describir con vision
      const BROWSER_AGENT_URL = process.env.BROWSER_AGENT_URL || 'http://browser-agent:5002';
      const r = await fetch(`${BROWSER_AGENT_URL}/session/screenshot`, { method: 'POST' });
      if (!r.ok) throw new Error(`browser-agent screenshot → HTTP ${r.status}`);
      const data = await r.json();
      if (!data.image) throw new Error('Sin imagen del browser-agent');

      const { visionCompletion } = require('./router');
      const slideCtx = pState.totalSlides
        ? `diapositiva ${pState.slideNum} de ${pState.totalSlides}`
        : `diapositiva ${pState.slideNum}`;
      const speech = await visionCompletion([{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: data.image } },
          { type: 'text', text: `Eres un presentador virtual de una masterclass de importaciones. Esta es la ${slideCtx}. Describe en 2-3 oraciones cortas EN ESPAÑOL lo que muestra esta diapositiva, como si lo estuvieras explicando en vivo a tu audiencia de TikTok. Sé directo y energético. No digas "esta diapositiva muestra", empieza con el contenido. Escribe los números como palabras.` },
        ],
      }], { maxTokens: 200 });

      await sendCommand({ type: 'speak', text: speech.trim(), emotion: 'excited' });
    }
  } catch (err) {
    console.error(`[SlideAction] Error en ${action}:`, err.message);
    await sendCommand({
      type:    'speak',
      text:    'Hubo un problema al acceder a la presentación.',
      emotion: 'neutral',
    }).catch(() => {});
  }
}

/**
 * Captura screenshot de una URL y lo muestra en el canvas del avatar.
 */
async function _handleBrowserShow(url, speakText, duration) {
  const { sendCommand } = require('./skills/showcase');

  try {
    const result = await browserScreenshot(url);
    await sendCommand({
      type:     'show_screenshot',
      image:    result.image,
      title:    result.title,
      url:      url,
      duration: duration,
    });
    if (speakText) {
      await sendCommand({
        type:    'speak',
        text:    speakText,
        emotion: 'excited',
      });
    }
    console.log(`[BrowserShow] screenshot enviado: ${url} → "${result.title}"`);
  } catch (err) {
    console.error(`[BrowserShow] Error con ${url}:`, err.message);
    await sendCommand({
      type:    'speak',
      text:    `No pude abrir esa pagina, pero pueden buscarla directamente.`,
      emotion: 'neutral',
    }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Express API
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '20mb' }));

// ── Auto-browse helpers ───────────────────────────────────────────────────────

function _pauseAutoBrowse() {
  if (autoBrowseEnabled && autoBrowseTimer) {
    clearTimeout(autoBrowseTimer);
    autoBrowseTimer = null;
    return true;
  }
  return false;
}

function _resumeAutoBrowse(delayMs = autoBrowseIntervalMs) {
  if (autoBrowseEnabled) {
    autoBrowseTimer = setTimeout(_autoBrowseLoop, delayMs);
  }
}

async function _autoBrowseLoop() {
  if (!autoBrowseEnabled || !autoBrowseList.length) return;
  autoBrowseBusy = true;
  const item = autoBrowseList[autoBrowseIndex];
  autoBrowseIndex = (autoBrowseIndex + 1) % autoBrowseList.length;
  try {
    const product = await searchProduct(item.query);
    if (product.found) {
      await showProduct(product, null);
      const waitMs = Math.max(autoBrowseIntervalMs, AUTO_BROWSE_MIN_WAIT);
      await new Promise(r => setTimeout(r, waitMs));
    }
  } catch (err) {
    console.error('[AutoBrowse] Error:', err.message);
  }
  autoBrowseBusy = false;
  if (autoBrowseEnabled) autoBrowseTimer = setTimeout(_autoBrowseLoop, autoBrowseIntervalMs);
}

// Health check
app.get('/health', (_req, res) => {
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

// Toggle modo autónomo — el avatar ve la pantalla y responde con contexto visual
app.post('/api/autonomous', (req, res) => {
  const { enabled } = req.body;
  autonomousModeEnabled = enabled === true;
  if (!autonomousModeEnabled) latestScreenshot = null;
  console.log(`[OpenClaw] Modo autónomo ${autonomousModeEnabled ? 'ACTIVADO' : 'DESACTIVADO'}`);
  res.json({ autonomousModeEnabled });
});

// Cambiar modo del avatar: conversational | agentic | autonomous
app.post('/api/mode', (req, res) => {
  const { mode } = req.body;
  if (!['conversational', 'agentic', 'autonomous'].includes(mode))
    return res.status(400).json({ error: 'Modo inválido. Usar: conversational, agentic, autonomous' });
  currentMode           = mode;
  autonomousModeEnabled = mode === 'autonomous';
  if (!autonomousModeEnabled) latestScreenshot = null;
  setAutoAdvance(mode === 'autonomous');
  console.log(`[OpenClaw] Modo cambiado a: ${mode}`);
  res.json({ mode: currentMode });
});

// Ejecutar instrucción del operador como agente (LLM decide la acción)
app.post('/api/execute', async (req, res) => {
  const { instruction, emotion = 'neutral' } = req.body;
  if (!instruction) return res.status(400).json({ error: 'instruction requerida' });
  try {
    const result = await processChat({
      platform: 'panel', user: 'operador', text: instruction, type: 'direct', emotion,
    });
    res.json(result);
  } catch (err) {
    console.error('[API/execute]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Recibir screenshot desde el panel (para modo autónomo)
app.post('/api/screenshot', (req, res) => {
  const { image } = req.body;
  if (image && image.startsWith('data:image')) {
    latestScreenshot = { data: image, ts: Date.now() };
  }
  res.json({ ok: true });
});

// Estado actual del agente
app.get('/api/status', (_req, res) => {
  const pState = getPresentationState();
  const prevIdx = (autoBrowseIndex - 1 + autoBrowseList.length) % (autoBrowseList.length || 1);
  res.json({
    mode: currentMode,
    autoShowcaseEnabled,
    autonomousModeEnabled,
    autoBrowseEnabled,
    autoBrowse: {
      enabled:        autoBrowseEnabled,
      currentProduct: autoBrowseList[prevIdx]?.label || autoBrowseList[prevIdx]?.query || null,
      total:          autoBrowseList.length,
      intervalMs:     autoBrowseIntervalMs,
    },
    presentation: {
      active:      pState.active,
      slideNum:    pState.slideNum,
      totalSlides: pState.totalSlides,
      title:       pState.title,
    },
    historySize: conversationHistory.length,
  });
});

// Detener todo de una vez (presentación, auto-browse, modo autónomo, pantalla)
app.post('/api/stop-all', async (_req, res) => {
  autoBrowseEnabled = false;
  if (autoBrowseTimer) { clearTimeout(autoBrowseTimer); autoBrowseTimer = null; }
  autoBrowseBusy = false;
  await stopPresentation().catch(() => {});
  autonomousModeEnabled = false;
  if (currentMode === 'autonomous') currentMode = 'agentic';
  latestScreenshot = null;
  const { sendCommand } = require('./skills/showcase');
  await sendCommand({ type: 'screenshare_stop' }).catch(() => {});
  console.log('[OpenClaw] stop-all ejecutado');
  res.json({ ok: true });
});

// Auto-browse product loop
app.post('/api/autobrowse/start', (req, res) => {
  const { products, intervalMs } = req.body;
  if (!Array.isArray(products) || !products.length)
    return res.status(400).json({ error: 'products[] requerido' });
  if (autoBrowseTimer) clearTimeout(autoBrowseTimer);
  autoBrowseList       = products;
  autoBrowseIndex      = 0;
  autoBrowseEnabled    = true;
  autoBrowseIntervalMs = intervalMs || 120_000;
  _autoBrowseLoop();
  res.json({ ok: true, count: products.length, intervalMs: autoBrowseIntervalMs });
});

app.post('/api/autobrowse/stop', (_req, res) => {
  autoBrowseEnabled = false;
  if (autoBrowseTimer) { clearTimeout(autoBrowseTimer); autoBrowseTimer = null; }
  autoBrowseBusy = false;
  res.json({ ok: true, stopped: true });
});

app.get('/api/autobrowse/status', (_req, res) => {
  const prevIdx = (autoBrowseIndex - 1 + autoBrowseList.length) % (autoBrowseList.length || 1);
  res.json({
    enabled:        autoBrowseEnabled,
    busy:           autoBrowseBusy,
    currentProduct: autoBrowseList[prevIdx]?.label || autoBrowseList[prevIdx]?.query || null,
    nextProduct:    autoBrowseList[autoBrowseIndex]?.label || autoBrowseList[autoBrowseIndex]?.query || null,
    total:          autoBrowseList.length,
    intervalMs:     autoBrowseIntervalMs,
  });
});

// Resetear historial de conversacion
app.post('/api/reset', (_req, res) => {
  conversationHistory.length = 0;
  res.json({ status: 'history cleared' });
});

// ── Presentación ─────────────────────────────────────────────────────────────

app.post('/api/present/start', async (req, res) => {
  const { url, totalSlides } = req.body;
  if (!url) return res.status(400).json({ error: 'url requerida' });
  // Detener auto-browse si estaba corriendo (comparten browser-agent)
  autoBrowseEnabled = false;
  if (autoBrowseTimer) { clearTimeout(autoBrowseTimer); autoBrowseTimer = null; }
  // Return immediately — Canva puede tardar 30-90s en cargar
  res.json({ ok: true, status: 'starting' });
  setAutoAdvance(currentMode === 'autonomous');
  startPresentation(url, totalSlides || null).catch(err =>
    console.error('[API/present/start]', err.message)
  );
});

app.post('/api/present/next', async (_req, res) => {
  try {
    const result = await nextSlide();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/present/prev', async (_req, res) => {
  try {
    const result = await prevSlide();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/present/stop', async (_req, res) => {
  try {
    await stopPresentation();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/present/status', (_req, res) => {
  res.json(getPresentationState());
});

// Screenshot de la sesión activa de browser-agent (para modo autónomo)
app.post('/api/browser-screenshot', async (_req, res) => {
  const BROWSER_AGENT_URL = process.env.BROWSER_AGENT_URL || 'http://browser-agent:5002';
  try {
    const r = await fetch(`${BROWSER_AGENT_URL}/session/screenshot`, { method: 'POST' });
    if (!r.ok) return res.json({ image: null });
    const data = await r.json();
    if (data.image) latestScreenshot = { data: data.image, ts: Date.now() };
    res.json({ image: data.image || null });
  } catch {
    res.json({ image: null });
  }
});

// Narrar frame capturado por el avatar (modo screen share)
app.post('/api/narrate-frame', async (req, res) => {
  const { image } = req.body;
  if (!image || !image.startsWith('data:image')) {
    return res.status(400).json({ error: 'imagen requerida' });
  }
  res.json({ ok: true }); // responder inmediatamente — narración es async
  try {
    const { visionCompletion } = require('./router');
    const { sendCommand }      = require('./skills/showcase');
    const speech = await visionCompletion([{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: image } },
        {
          type: 'text',
          text: `Eres un presentador virtual de una masterclass de importaciones.
Describe en 2-3 oraciones cortas EN ESPAÑOL lo que muestra esta diapositiva,
como si lo estuvieras explicando en vivo a tu audiencia de TikTok.
Sé directo, energético y claro. No digas "esta diapositiva muestra",
empieza directamente con el contenido.
IMPORTANTE: escribe todos los números como palabras en español (uno, dos, veinte...), NUNCA como dígitos.`,
        },
      ],
    }], { maxTokens: 200 });
    const text = speech.trim();
    console.log(`[NarrateFrame] ${text.slice(0, 80)}…`);
    await sendCommand({ type: 'speak', text, emotion: 'excited' });
  } catch (err) {
    console.error('[NarrateFrame] Error:', err.message);
  }
});

// Mostrar página web desde el panel (one-shot screenshot)
app.post('/api/browser-show', async (req, res) => {
  const { url, duration = 25 } = req.body;
  if (!url) return res.status(400).json({ error: 'url requerida' });
  res.json({ status: 'capturing', url });
  _handleBrowserShow(url, null, duration).catch(err => {
    console.error('[API/browser-show]', err.message);
  });
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

  // Responde inmediato - mem0 tarda 2+ min por chunk (dedup Groq+Qdrant)
  res.json({ ok: true, source, chunks: chunks.length, status: 'processing' });

  const { addMemory } = require('./memory');
  let saved = 0;
  for (const chunk of chunks) {
    try {
      await addMemory(chunk, 'influencer', { type: 'knowledge', source });
      saved++;
      console.log('[Knowledge] ' + source + ': chunk ' + saved + '/' + chunks.length + ' OK');
    } catch (err) {
      console.error('[Knowledge] chunk failed:', err.message);
    }
  }
  console.log('[Knowledge] ' + source + ': done ' + saved + '/' + chunks.length);
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
