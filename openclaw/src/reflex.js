'use strict';

/**
 * Reflex Layer — OpenClaw
 *
 * Respuestas instantáneas (<50ms) para eventos predecibles.
 * Evitan llamar al LLM para: follows, gifts, saludos, risas, hype.
 * Si no hay match, retorna null → el mensaje va al LLM normalmente.
 */

const RULES = [
  {
    type:     'follow',
    msgTypes: ['follow', 'sub', 'subscribe'],
    emotions: ['excited', 'surprised'],
    texts: [
      '¡Gracias por seguirme! ¡Bienvenido a la familia! 🎉',
      '¡Nuevo seguidor! ¡Qué emoción! Gracias por estar aquí!',
      '¡Bienvenido al live! Me alegra mucho tenerte aquí!',
    ],
    animation: 'wave',
  },
  {
    type:     'gift',
    msgTypes: ['gift', 'donation', 'super_chat', 'bits'],
    patterns: [/regalo/i, /gift/i, /donaci[oó]n/i, /coins/i, /rosas/i, /roses/i, /diamante/i, /diamond/i, /bits/i],
    emotions: ['excited'],
    texts: [
      '¡Muchas gracias por el regalo! ¡Me emocionas demasiado! 💝',
      '¡Eres increíble! ¡Gracias por el apoyo!',
      '¡No puede ser! ¡Gracias! ¡Eres lo máximo!',
    ],
    animation: 'wave',
  },
  {
    type:     'greeting',
    patterns: [/^(hola|hello|hi|hey|buenas|saludos|qu[eé]\s*tal)[!\s🙋]*$/i],
    emotions: ['happy'],
    texts: [
      '¡Hola! ¡Qué bueno que estás aquí! 👋',
      '¡Bienvenido! ¡Gracias por unirte al live!',
      '¡Hola hola! ¡Me alegra verte por aquí!',
    ],
  },
  {
    type:     'laugh',
    patterns: [/^(ja{2,}|je{2,}|lol|xd|haha|hehe)[!\s😂🤣]*$/i, /^[😂🤣]+$/u],
    emotions: ['happy'],
    texts: [
      '¡Jajaja! ¡Me contagias la risa! 😄',
      '¡Jeje! ¡Eso estuvo gracioso!',
    ],
  },
  {
    type:     'hype',
    patterns: [/^(🔥+|fire|fuego|increíble|amazing|🙌+|👏+|wow|épico)[!\s]*$/i, /^[🔥🙌👏]+$/u],
    emotions: ['excited'],
    texts: [
      '¡Gracias! ¡Ustedes son lo mejor! 🔥',
      '¡Ese apoyo me da energía para seguir!',
    ],
  },
  {
    type:     'love',
    patterns: [/^(te quiero|i love you|te amo)[!\s❤️💕]*$/i, /^[❤️💕💖💗💓🥰😍]+$/u],
    emotions: ['happy'],
    texts: [
      '¡Aww, gracias! ¡Los quiero mucho a todos! ❤️',
      '¡Qué hermoso! ¡Gracias por tanto cariño!',
    ],
  },
];

/**
 * Verifica si el mensaje tiene una respuesta de reflex.
 * @param {object} msg - {text, type, user, platform}
 * @returns {object|null} - {action, text, emotion, animation?} o null
 */
function reflexCheck(msg) {
  const text  = (msg.text  || '').trim();
  const mType = (msg.type  || 'chat').toLowerCase();

  // 1. Eventos especiales por tipo (follow, gift, donation, etc.)
  for (const rule of RULES) {
    if (rule.msgTypes && rule.msgTypes.includes(mType)) {
      console.log(`[Reflex] Hit tipo '${rule.type}' para ${msg.user}`);
      return _build(rule);
    }
  }

  // 2. Texto corto con patrón conocido (saludos, risas, hype, etc.)
  if (text.length > 60) return null; // mensajes largos → LLM

  for (const rule of RULES) {
    if (rule.patterns && rule.patterns.some(p => p.test(text))) {
      console.log(`[Reflex] Hit patrón '${rule.type}' para: "${text}"`);
      return _build(rule);
    }
  }

  return null; // sin match → procesar con LLM
}

function _build(rule) {
  const text    = rule.texts[Math.floor(Math.random() * rule.texts.length)];
  const emotion = rule.emotions[Math.floor(Math.random() * rule.emotions.length)];
  const res     = { action: 'speak', text, emotion };
  if (rule.animation) res.animation = rule.animation;
  return res;
}

module.exports = { reflexCheck };
