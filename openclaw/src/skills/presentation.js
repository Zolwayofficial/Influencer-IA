'use strict';

/**
 * Skill de presentación — controla slides de Canva/PDF en el stream.
 * Usa browser-agent para navegación y llama-4-scout para describir cada slide.
 */

const { visionCompletion } = require('../router');
const { sendCommand }       = require('./showcase');

const BROWSER_AGENT = process.env.BROWSER_AGENT_URL || 'http://browser-agent:5002';
const TIMEOUT_MS    = 150_000; // Canva puede tardar 90-120s en cargar (cold start)

// Estado global de la presentación activa
const state = {
  active:      false,
  url:         null,
  slideNum:    0,
  totalSlides: null,
  title:       null,
  autoAdvance: true,   // avanza sola al terminar de hablar cada slide
};

let _autoAdvanceTimer = null;

async function _post(path, body = {}) {
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BROWSER_AGENT}${path}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  ctrl.signal,
    });
    if (!res.ok) throw new Error(`browser-agent ${path} → HTTP ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(t);
  }
}

const NUM_ES = ['','uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez','once','doce','trece','catorce','quince','dieciséis','diecisiete','dieciocho','diecinueve','veinte','veintiuno','veintidós','veintitrés','veinticuatro','veinticinco','veintiséis','veintisiete','veintiocho','veintinueve','treinta'];
function numEs(n) { return (n >= 1 && n <= 30) ? NUM_ES[n] : String(n); }

async function _describeSlide(imageDataUrl, slideNum, totalSlides) {
  const slideCtx = totalSlides
    ? `diapositiva ${numEs(slideNum)} de ${numEs(totalSlides)}`
    : `diapositiva ${numEs(slideNum)}`;
  try {
    const speech = await visionCompletion([
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: imageDataUrl },
          },
          {
            type: 'text',
            text: `Eres un presentador virtual de una masterclass de importaciones.
Esta es la ${slideCtx}.
Describe en 2-3 oraciones cortas EN ESPAÑOL lo que muestra esta diapositiva,
como si lo estuvieras explicando en vivo a tu audiencia de TikTok.
Sé directo, energético y claro. No digas "esta diapositiva muestra",
empieza directamente con el contenido.
IMPORTANTE: escribe todos los números como palabras en español (uno, dos, veinte...), NUNCA como dígitos.`,
          },
        ],
      },
    ], { maxTokens: 200 });
    return speech.trim();
  } catch (err) {
    console.error('[Presentation] Error vision:', err.message);
    return `Continuamos con la ${slideCtx} de nuestra masterclass.`;
  }
}

/**
 * Muestra una imagen en el canvas del avatar y hace que hable.
 */
async function _showAndSpeak(result, slideNum, totalSlides) {
  // Cancelar auto-avance pendiente del slide anterior
  if (_autoAdvanceTimer) { clearTimeout(_autoAdvanceTimer); _autoAdvanceTimer = null; }

  // 1. Mostrar slide en canvas
  await sendCommand({
    type:     'show_screenshot',
    image:    result.image,
    title:    result.title,
    duration: 999,  // presentación: no auto-cerrar
  });

  // 2. Generar y hablar descripción con IA vision
  const speech = await _describeSlide(result.image, slideNum, totalSlides);
  console.log(`[Presentation] Slide ${slideNum}: ${speech.slice(0, 80)}…`);

  await sendCommand({
    type:    'speak',
    text:    speech,
    emotion: 'excited',
  });

  // 3. Auto-avance: pasar al siguiente slide tras terminar de hablar
  if (state.autoAdvance && state.active) {
    const words = speech.split(/\s+/).length;
    const speakMs = words * 286 + 4000;  // ~286ms/palabra + 4s buffer
    const hasMore = !totalSlides || slideNum < totalSlides;
    if (hasMore) {
      console.log(`[Presentation] Auto-avance en ${Math.round(speakMs / 1000)}s (slide ${slideNum}→${slideNum + 1})`);
      _autoAdvanceTimer = setTimeout(async () => {
        _autoAdvanceTimer = null;
        if (state.active && state.autoAdvance) {
          try { await nextSlide(); }
          catch (err) {
            if (err.message?.includes('última') || err.message?.includes('last')) {
              console.log('[Presentation] Fin de presentación.');
            } else {
              console.error('[Presentation] Auto-avance error:', err.message);
            }
          }
        }
      }, speakMs);
    } else {
      console.log('[Presentation] Última diapositiva — fin de auto-avance.');
    }
  }

  return speech;
}

// ─────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────

async function startPresentation(url, totalSlides = null) {
  // Si ya hay una presentación activa, detenerla primero
  if (state.active) {
    console.log('[Presentation] Ya hay una activa — deteniéndola antes de iniciar nueva.');
    await stopPresentation();
  }
  // Convertir link de edición de Canva a link de vista pública (no requiere login)
  const viewUrl = url.replace(/\/edit(\?.*)?$/, '/view');
  console.log(`[Presentation] Iniciando: ${viewUrl}`);
  const result = await _post('/session/start', { url: viewUrl });

  state.active      = true;
  state.url         = url;
  state.slideNum    = 1;
  state.totalSlides = totalSlides;
  state.title       = result.title;

  const speech = await _showAndSpeak(result, 1, totalSlides);
  return { slide: 1, title: result.title, speech };
}

async function nextSlide() {
  if (!state.active) throw new Error('No hay presentación activa.');
  state.slideNum++;
  const result = await _post('/session/key', { key: 'ArrowRight' });
  const speech = await _showAndSpeak(result, state.slideNum, state.totalSlides);
  return { slide: state.slideNum, title: result.title, speech };
}

async function prevSlide() {
  if (!state.active) throw new Error('No hay presentación activa.');
  state.slideNum = Math.max(1, state.slideNum - 1);
  const result = await _post('/session/key', { key: 'ArrowLeft' });
  const speech = await _showAndSpeak(result, state.slideNum, state.totalSlides);
  return { slide: state.slideNum, title: result.title, speech };
}

async function stopPresentation() {
  if (!state.active) return;
  if (_autoAdvanceTimer) { clearTimeout(_autoAdvanceTimer); _autoAdvanceTimer = null; }
  await _post('/session/end');
  await sendCommand({ type: 'screenshare_stop' });
  state.active   = false;
  state.slideNum = 0;
  state.url      = null;
  console.log('[Presentation] Detenida.');
}

function getState() {
  return { ...state };
}

module.exports = { startPresentation, nextSlide, prevSlide, stopPresentation, getState };
