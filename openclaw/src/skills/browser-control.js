'use strict';

const BROWSER_AGENT_URL = process.env.BROWSER_AGENT_URL || 'http://browser-agent:5002';
const TIMEOUT_MS = 25_000;

async function _post(path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BROWSER_AGENT_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`browser-agent ${path} → HTTP ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Captura un screenshot de una URL.
 * Retorna { image: "data:image/png;base64,...", title, url } o lanza error.
 */
async function screenshot(url) {
  return _post('/screenshot', { url });
}

/**
 * Navega a una URL y retorna screenshot + texto extraído.
 * Retorna { image, title, text, url }.
 */
async function navigate(url) {
  return _post('/navigate', { url });
}

/**
 * Extrae texto de una URL (opcionalmente con selector CSS).
 * Retorna { text, title, url }.
 */
async function extractText(url, selector = 'body') {
  return _post('/extract', { url, selector });
}

module.exports = { screenshot, navigate, extractText };
