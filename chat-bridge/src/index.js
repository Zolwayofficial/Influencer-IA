const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const Redis = require('ioredis');
const { TikTokChatReader } = require('./platforms/tiktok');
const { YouTubeChatReader } = require('./platforms/youtube');

const PORT = process.env.PORT || 4000;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const OPENCLAW_WEBHOOK_URL = process.env.OPENCLAW_WEBHOOK_URL;

// --- Express + WebSocket Server ---
const app = express();
const server = http.createServer(app);
app.use(express.json({ limit: '20mb' }));

// WebSocket server para enviar comandos al Avatar Frontend
const wss = new WebSocket.Server({ noServer: true });
const avatarClients = new Set();

server.on('upgrade', (request, socket, head) => {
  if (request.url === '/ws/commands') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  avatarClients.add(ws);
  console.log(`[WS] Avatar client conectado (total: ${avatarClients.size})`);

  ws.on('close', () => {
    avatarClients.delete(ws);
    console.log(`[WS] Avatar client desconectado (total: ${avatarClients.size})`);
  });
});

// Enviar comando a todos los clientes del avatar
function broadcastToAvatar(command) {
  const data = JSON.stringify(command);
  for (const client of avatarClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

// --- Redis para deduplicacion y cola ---
const redis = new Redis(REDIS_URL, {
  retryDelayOnFailover: 1000,
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

redis.on('error', (err) => console.error('[Redis] Error:', err.message));
redis.on('connect', () => console.log('[Redis] Conectado'));

// Deduplicacion: evitar procesar el mismo mensaje dos veces
async function isDuplicate(msgId) {
  try {
    const exists = await redis.set(`msg:${msgId}`, '1', 'EX', 60, 'NX');
    return exists === null; // null = ya existia = duplicado
  } catch {
    return false; // si Redis falla, procesar de todos modos
  }
}

// --- Rate Limiter simple ---
const rateLimiter = {
  lastProcessed: 0,
  minInterval: 3000, // Minimo 3 segundos entre respuestas del avatar

  canProcess() {
    const now = Date.now();
    if (now - this.lastProcessed >= this.minInterval) {
      this.lastProcessed = now;
      return true;
    }
    return false;
  }
};

// --- Procesamiento central de mensajes ---
async function processMessage(msg) {
  const msgId = `${msg.platform}-${msg.user}-${msg.timestamp}`;

  if (await isDuplicate(msgId)) return;

  // Siempre mostrar en el overlay de chat del avatar
  broadcastToAvatar({
    type: 'chat_message',
    user: msg.user,
    text: msg.text,
    msgType: msg.type, // 'chat', 'gift', 'follow'
  });

  // Guardar en Redis para historial (ultimos 100 mensajes)
  try {
    await redis.lpush('chat:history', JSON.stringify(msg));
    await redis.ltrim('chat:history', 0, 99);
  } catch { /* ignorar errores de Redis */ }

  // Enviar a OpenClaw para que decida si responder
  // Solo si el rate limiter lo permite (evitar spam de respuestas)
  if (rateLimiter.canProcess() && OPENCLAW_WEBHOOK_URL) {
    try {
      const res = await fetch(OPENCLAW_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: msg.platform,
          user: msg.user,
          text: msg.text,
          type: msg.type,
          timestamp: msg.timestamp,
        }),
      });

      if (res.ok) {
        const response = await res.json();
        // Si OpenClaw responde, enviar al avatar
        if (response.action === 'speak' && response.text) {
          const cmd = {
            type:     'speak',
            text:     response.text,
            emotion:  response.emotion  || 'neutral',
            language: response.language || 'es',
          };
          if (response.animation) cmd.animation = response.animation;
          broadcastToAvatar(cmd);
        } else if (response.action === 'show_product') {
          broadcastToAvatar({
            type: 'speak_and_show',
            text: response.text,
            product: response.product,
          });
        }
      }
    } catch (err) {
      console.error('[OpenClaw] Error enviando mensaje:', err.message);
    }
  }
}

// --- Iniciar lectores de chat ---
let tiktokReader = null;
let youtubeReader = null;

async function startTikTok() {
  const username = process.env.TIKTOK_USERNAME;
  const sessionId = process.env.TIKTOK_SESSION_ID;
  if (!username) {
    console.log('[TikTok] No configurado (TIKTOK_USERNAME vacio)');
    return;
  }

  tiktokReader = new TikTokChatReader(username, sessionId, processMessage);
  try {
    await tiktokReader.connect();
    console.log(`[TikTok] Conectado al live de @${username}`);
  } catch (err) {
    console.error('[TikTok] Error conectando:', err.message);
    // Reintentar en 30 segundos
    setTimeout(startTikTok, 30000);
  }
}

async function startYouTube() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  const videoId = process.env.YOUTUBE_VIDEO_ID;
  if (!apiKey || !videoId) {
    console.log('[YouTube] No configurado (YOUTUBE_API_KEY o YOUTUBE_VIDEO_ID vacio)');
    return;
  }

  youtubeReader = new YouTubeChatReader(apiKey, videoId, processMessage);
  try {
    await youtubeReader.connect();
    console.log(`[YouTube] Conectado al live chat del video ${videoId}`);
  } catch (err) {
    console.error('[YouTube] Error conectando:', err.message);
    setTimeout(startYouTube, 30000);
  }
}

// --- API REST ---

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    tiktok: tiktokReader?.isConnected() ?? false,
    youtube: youtubeReader?.isConnected() ?? false,
    avatarClients: avatarClients.size,
  });
});

// Enviar comando manual al avatar (para testing o desde N8N)
app.post('/api/command', (req, res) => {
  const type = req.body?.type || '?';
  if (type === 'show_screenshot') {
    console.log(`[Command] ${type} → ${avatarClients.size} cliente(s) WS (imagen: ${req.body?.image?.length || 0} chars)`);
  } else {
    console.log(`[Command] ${type} → ${avatarClients.size} cliente(s) WS`);
  }
  broadcastToAvatar(req.body);
  res.json({ sent: true });
});

// Simular mensaje de chat (para testing)
app.post('/api/test-message', (req, res) => {
  const { user, text, platform } = req.body;
  processMessage({
    platform: platform || 'test',
    user: user || 'TestUser',
    text: text || 'Hola!',
    type: 'chat',
    timestamp: Date.now(),
  });
  res.json({ processed: true });
});

// Obtener historial de chat reciente
app.get('/api/chat/history', async (req, res) => {
  try {
    const messages = await redis.lrange('chat:history', 0, 49);
    res.json(messages.map(m => JSON.parse(m)));
  } catch {
    res.json([]);
  }
});

// Actualizar YouTube video ID en caliente (para cambiar de stream)
app.post('/api/youtube/set-video', async (req, res) => {
  const { videoId } = req.body;
  if (!videoId) return res.status(400).json({ error: 'videoId required' });

  if (youtubeReader) youtubeReader.stop();
  process.env.YOUTUBE_VIDEO_ID = videoId;
  await startYouTube();
  res.json({ videoId, status: 'reconnecting' });
});

// --- Arranque ---
async function main() {
  try {
    await redis.connect();
  } catch (err) {
    console.warn('[Redis] No disponible, continuando sin deduplicacion:', err.message);
  }

  server.listen(PORT, () => {
    console.log(`[Chat Bridge] Escuchando en puerto ${PORT}`);
  });

  // Iniciar lectores en paralelo
  startTikTok();
  startYouTube();
}

main().catch(console.error);
