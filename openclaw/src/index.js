const express = require('express');
const { OpenAI } = require('openai');
const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');

const PORT = process.env.OC_GATEWAY_PORT || 3000;

// --- Load config ---
let config = {};
try {
  const configPath = path.join(__dirname, '..', 'config', 'config.yml');
  const raw = fs.readFileSync(configPath, 'utf8');
  // Replace env vars in config
  const resolved = raw.replace(/\$\{(\w+)(?::-([^}]*))?\}/g, (_, key, fallback) => {
    return process.env[key] || fallback || '';
  });
  config = yaml.load(resolved);
} catch (err) {
  console.warn('[Config] Error loading config.yml:', err.message);
}

// --- OpenAI-compatible client (Qwen API) ---
const client = new OpenAI({
  apiKey: process.env.OC_OPENAI_API_KEY || process.env.DASHSCOPE_API_KEY || '',
  baseURL: process.env.OC_OPENAI_BASE_URL || process.env.LLM_API_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
});

const model = process.env.OC_DEFAULT_MODEL || process.env.LLM_MODEL || 'qwen-plus';

// --- System prompt from config ---
const identity = config.identity || {};
const systemPrompt = `${identity.description || 'Eres un influencer virtual.'}

Personalidad:
${(identity.personality || []).map(p => `- ${p}`).join('\n')}

Reglas:
${(identity.rules || []).map(r => `- ${r}`).join('\n')}

IMPORTANTE: Responde SIEMPRE en formato JSON con esta estructura:
{
  "action": "speak" | "show_product" | "ignore",
  "text": "lo que dirá el avatar (1-3 oraciones cortas)",
  "emotion": "neutral" | "happy" | "excited" | "surprised" | "thinking",
  "language": "es"
}

Si el mensaje no merece respuesta (spam, repetido, irrelevante), usa "action": "ignore".
Para regalos y nuevos seguidores, siempre responde con emocion "surprised" o "excited".`;

// --- Conversation memory (last N messages) ---
const conversationHistory = [];
const MAX_HISTORY = 20;

function addToHistory(role, content) {
  conversationHistory.push({ role, content });
  if (conversationHistory.length > MAX_HISTORY) {
    conversationHistory.shift();
  }
}

// --- Process chat message ---
async function processChat(msg) {
  const userMessage = `[${msg.platform}] ${msg.user} (${msg.type}): ${msg.text}`;
  addToHistory('user', userMessage);

  try {
    const completion = await client.chat.completions.create({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversationHistory,
      ],
      temperature: 0.8,
      max_tokens: 300,
    });

    const raw = completion.choices[0]?.message?.content || '';
    addToHistory('assistant', raw);

    // Parse JSON response
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch {
      // If JSON parse fails, treat as plain text
      return {
        action: 'speak',
        text: raw.replace(/```json|```/g, '').trim(),
        emotion: 'neutral',
        language: 'es',
      };
    }

    return { action: 'ignore' };
  } catch (err) {
    console.error('[LLM] Error:', err.message);
    return { action: 'ignore', error: err.message };
  }
}

// --- Express API ---
const app = express();
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    model: model,
    historySize: conversationHistory.length,
  });
});

// Webhook: receives messages from chat-bridge
app.post('/webhook/chat', async (req, res) => {
  const msg = req.body;
  console.log(`[Chat] ${msg.platform}/${msg.user}: ${msg.text}`);

  const response = await processChat(msg);
  console.log(`[Response] ${response.action}: ${response.text || '(ignored)'}`);

  res.json(response);
});

// Manual command: make avatar speak
app.post('/api/speak', async (req, res) => {
  const { text, emotion, language } = req.body;
  res.json({
    action: 'speak',
    text: text || 'Hola a todos!',
    emotion: emotion || 'happy',
    language: language || 'es',
  });
});

// Reset conversation
app.post('/api/reset', (req, res) => {
  conversationHistory.length = 0;
  res.json({ status: 'history cleared' });
});

// --- Start ---
app.listen(PORT, () => {
  console.log(`[OpenClaw] Agent gateway running on port ${PORT}`);
  console.log(`[OpenClaw] Model: ${model}`);
  console.log(`[OpenClaw] API: ${client.baseURL}`);
});
