/**
 * HeadTTS Server
 *
 * Servidor TTS que genera audio + visemas para TalkingHead.
 * Usa el modelo Kokoro 82M (ONNX) para sintesis de voz con
 * timestamps de fonemas y visemas Oculus.
 *
 * Endpoints:
 *   WS  /ws       - WebSocket para TalkingHead (streaming TTS)
 *   GET /health   - Health check
 *   POST /api/tts - REST endpoint para generar audio
 *
 * Nota: Este es un wrapper simplificado. Para produccion,
 * se recomienda usar el paquete completo de HeadTTS:
 * https://github.com/met4citizen/HeadTTS
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const PORT = 3001;

const app = express();
app.use(express.json());
const server = http.createServer(app);

// --- WebSocket Server para TalkingHead ---
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  if (request.url === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  console.log('[HeadTTS] Cliente TalkingHead conectado');

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);

      if (msg.type === 'tts') {
        // TalkingHead envia: { type: 'tts', text: '...', voice: '...', language: '...' }
        const result = await synthesize(msg.text, msg.voice, msg.language);

        // Responder con audio + visemas
        ws.send(JSON.stringify({
          type: 'tts_result',
          audio: result.audio,         // Base64 encoded WAV
          words: result.words,         // [{ word, start, end }]
          visemes: result.visemes,     // [{ visemeId, start, duration }]
          duration: result.duration,   // Total duration in ms
        }));
      }
    } catch (err) {
      console.error('[HeadTTS] Error procesando mensaje:', err.message);
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  });

  ws.on('close', () => {
    console.log('[HeadTTS] Cliente desconectado');
  });
});

// --- Mapeo de fonemas a visemas Oculus ---
// Los 15 visemas Oculus estándar
const PHONEME_TO_VISEME = {
  // Silencio
  'sil': 0, 'sp': 0, 'spn': 0,
  // PP (labios cerrados)
  'p': 1, 'b': 1, 'm': 1,
  // FF (labio inferior contra dientes superiores)
  'f': 2, 'v': 2,
  // TH
  'T': 3, 'D': 3,
  // DD (lengua detras de dientes)
  't': 4, 'd': 4, 'n': 4, 'l': 4,
  // KK (parte trasera de la lengua)
  'k': 5, 'g': 5, 'N': 5,
  // CH
  'tS': 6, 'dZ': 6, 'S': 6, 'Z': 6,
  // SS
  's': 7, 'z': 7,
  // NN
  'n~': 8, 'J': 8,
  // RR
  'r': 9, 'R': 9, 'r\\': 9,
  // AA (boca abierta)
  'a': 10, 'A': 10, 'a:': 10,
  // EE (boca ancha)
  'e': 11, 'E': 11, 'e:': 11,
  // II (boca mas ancha)
  'i': 12, 'I': 12, 'i:': 12,
  // OO (boca redondeada)
  'o': 13, 'O': 13, 'o:': 13,
  // UU (boca mas redondeada)
  'u': 14, 'U': 14, 'u:': 14,
};

// --- Modelo TTS ---
// En produccion, aqui se cargaria el modelo Kokoro ONNX.
// Por ahora, usamos una implementacion placeholder que
// genera visemas basadas en el texto (para testing).
// Reemplazar con el modelo real al desplegar.

let modelLoaded = false;

async function loadModel() {
  try {
    // TODO: Cargar modelo Kokoro ONNX
    // const ort = require('onnxruntime-node');
    // model = await ort.InferenceSession.create('./models/kokoro-82m.onnx');
    console.log('[HeadTTS] Modelo placeholder activo');
    console.log('[HeadTTS] Para produccion, descargar modelo Kokoro de:');
    console.log('[HeadTTS] https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX');
    modelLoaded = true;
  } catch (err) {
    console.error('[HeadTTS] Error cargando modelo:', err.message);
  }
}

async function synthesize(text, voice, language) {
  // Placeholder: genera visemas estimadas basadas en el texto
  // En produccion, el modelo Kokoro genera audio real + timestamps

  const wordsArray = text.split(/\s+/).filter(w => w.length > 0);
  const avgWordDuration = 350; // ms por palabra (estimado)
  const totalDuration = wordsArray.length * avgWordDuration;

  const words = [];
  const visemes = [];
  let currentTime = 0;

  for (const word of wordsArray) {
    const wordStart = currentTime;
    const wordDuration = Math.max(200, word.length * 80);

    words.push({
      word,
      start: wordStart,
      end: wordStart + wordDuration,
    });

    // Generar visemas para cada caracter del word
    const charDuration = wordDuration / word.length;
    for (let i = 0; i < word.length; i++) {
      const char = word[i].toLowerCase();
      let visemeId = 0; // sil por defecto

      // Mapeo simplificado caracter -> visema
      if ('aáà'.includes(char)) visemeId = 10;
      else if ('eéè'.includes(char)) visemeId = 11;
      else if ('iíì'.includes(char)) visemeId = 12;
      else if ('oóò'.includes(char)) visemeId = 13;
      else if ('uúù'.includes(char)) visemeId = 14;
      else if ('pbm'.includes(char)) visemeId = 1;
      else if ('fv'.includes(char)) visemeId = 2;
      else if ('tdnl'.includes(char)) visemeId = 4;
      else if ('kgq'.includes(char)) visemeId = 5;
      else if ('szc'.includes(char)) visemeId = 7;
      else if ('r'.includes(char)) visemeId = 9;

      visemes.push({
        visemeId,
        start: wordStart + (i * charDuration),
        duration: charDuration,
      });
    }

    currentTime += wordDuration + 100; // 100ms pausa entre palabras
  }

  return {
    audio: '', // Base64 WAV (vacio en placeholder)
    words,
    visemes,
    duration: totalDuration,
  };
}

// --- REST Endpoints ---

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    modelLoaded,
    wsClients: wss.clients.size,
  });
});

app.post('/api/tts', async (req, res) => {
  const { text, voice, language } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });

  try {
    const result = await synthesize(text, voice, language);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Arranque ---
async function main() {
  await loadModel();

  server.listen(PORT, () => {
    console.log(`[HeadTTS] Servidor escuchando en puerto ${PORT}`);
    console.log(`[HeadTTS] WebSocket: ws://localhost:${PORT}/ws`);
    console.log(`[HeadTTS] REST API: http://localhost:${PORT}/api/tts`);
  });
}

main().catch(console.error);
