import { TalkingHead } from 'talkinghead';

// Emociones → gradientes CSS de fondo (fallback sin SD)
const EMOTION_BACKGROUNDS = {
  neutral:   'linear-gradient(135deg, #0d0d1a 0%, #111127 40%, #0a0a18 100%)',
  happy:     'linear-gradient(135deg, #1a1200 0%, #2a1e00 40%, #150f00 100%)',
  excited:   'linear-gradient(135deg, #1a0800 0%, #2d1000 40%, #180500 100%)',
  surprised: 'linear-gradient(135deg, #001520 0%, #001f30 40%, #000f1a 100%)',
  thinking:  'linear-gradient(135deg, #050520 0%, #08083a 40%, #030318 100%)',
  love:      'linear-gradient(135deg, #1a0010 0%, #2d0020 40%, #180010 100%)',
};

// Emociones → mood de TalkingHead
const EMOTION_MOODS = {
  neutral:   'neutral',
  happy:     'happy',
  excited:   'happy',
  surprised: 'sad',    // TalkingHead usa sad para expresión de sorpresa
  thinking:  'neutral',
  love:      'happy',
};

const BG_ROTATE_INTERVAL = 3 * 60 * 1000; // rotar fondo cada 3 minutos

class InfluencerApp {
  constructor() {
    this.head = null;
    this.ws = null;
    this.reconnectDelay = 3000;
    this.maxChatMessages = 25;
    this.currentEmotion = 'neutral';

    // Background system
    this.sdBackgrounds = [];  // URLs de fondos generados por Stable Diffusion
    this.bgIndex = 0;
    this.bgRotateTimer = null;

    // DOM refs
    this.productOverlay  = document.getElementById('product-overlay');
    this.productName     = document.getElementById('product-name');
    this.productPrice    = document.getElementById('product-price');
    this.productImage    = document.getElementById('product-image');
    this.productFeatures = document.getElementById('product-features');
    this.chatMessages    = document.getElementById('chat-messages');
    this.statusIndicator = document.getElementById('status-indicator');
    this.statusText      = document.getElementById('status-text');
    this.aiBg            = document.getElementById('ai-background');
    this.ambientFx       = document.getElementById('ambient-fx');
    this.avatarEl        = document.getElementById('avatar');
    this.productQrImg    = document.getElementById('product-qr-img');
    this.productQrBox    = document.getElementById('product-qr');
  }

  async init() {
    this.setStatus('loading', 'Cargando avatar...');

    try {
      const avatarEl = document.getElementById('avatar');

      this.head = new TalkingHead(avatarEl, {
        ttsEndpoint: '/tts/api/tts',   // F5-TTS via nginx proxy
        lipsyncModules: ['es', 'en'],  // español primero
        cameraView: 'upper',
        cameraRotateEnable: false,
        cameraZoomEnable: false,
        avatarMood: 'happy',
        avatarMute: false,
        markedOptions: { mangle: false, headerIds: false },
      });

      // Cargar el avatar GLB
      await this.head.showAvatar(
        {
          url: '/models/avatar.glb',
          body: 'F',
          avatarMood: 'happy',
        },
        null
      );

        this.setStatus('connected', 'Avatar listo');
      this.applyEmotionEffects('neutral');

    } catch (err) {
      console.error('Error inicializando avatar:', err);
      this.setStatus('error', 'Error cargando avatar: ' + err.message);
    }

    // Sistema de fondos AI (async — no bloquea el arranque)
    this.initBackgroundSystem();

    // Conectar WebSocket independientemente del estado del avatar
    this.connectWebSocket();
  }

  // ---------------------------------------------------------------------------
  // FASE 4 — Efectos visuales por emocion
  // ---------------------------------------------------------------------------

  /**
   * Aplica efectos visuales (ambient light + CSS filter en avatar) segun emocion.
   * Se llama en cada speak/speak_and_show con la emocion del mensaje.
   */
  applyEmotionEffects(emotion) {
    const e = emotion || 'neutral';
    if (e === this.currentEmotion) return;
    this.currentEmotion = e;

    // 1. Fondo CSS: solo si no hay fondos SD cargados
    if (this.sdBackgrounds.length === 0 && this.aiBg) {
      this.aiBg.style.background = EMOTION_BACKGROUNDS[e] || EMOTION_BACKGROUNDS.neutral;
    }

    // 2. Capa de luz ambient: clase CSS que define --ambient-color
    if (this.ambientFx) {
      this.ambientFx.className = `emotion-${e}`;
      // Pulso extra para excited / surprised
      if (e === 'excited' || e === 'surprised') {
        this.ambientFx.classList.add('pulsing');
        this.ambientFx.addEventListener('animationend', () => {
          this.ambientFx.classList.remove('pulsing');
        }, { once: true });
      }
    }

    // 3. Filtro CSS sobre el canvas del avatar
    if (this.avatarEl) {
      this.avatarEl.className = `emotion-${e}`;
    }
  }

  // ---------------------------------------------------------------------------
  // FASE 4 — Sistema de fondos AI (Stable Diffusion)
  // ---------------------------------------------------------------------------

  /**
   * Carga la lista de fondos generados por Stable Diffusion.
   * Si el servicio no esta disponible, usa los gradientes CSS como fallback.
   */
  async initBackgroundSystem() {
    await this._loadSDBackgrounds();

    // Rotar fondo cada BG_ROTATE_INTERVAL ms
    this.bgRotateTimer = setInterval(() => this._rotateBackground(), BG_ROTATE_INTERVAL);
  }

  async _loadSDBackgrounds() {
    try {
      const res = await fetch('/backgrounds/list.json');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.backgrounds) && data.backgrounds.length > 0) {
        this.sdBackgrounds = data.backgrounds;
        this._applyBackground(this.sdBackgrounds[0]);
        console.log(`[BG] ${this.sdBackgrounds.length} fondos SD cargados`);
      }
    } catch {
      // SD no disponible — se usan gradientes CSS por emocion (ya aplicados)
    }
  }

  _rotateBackground() {
    if (this.sdBackgrounds.length === 0) {
      // Sin fondos SD: re-aplicar gradiente de emocion actual
      if (this.aiBg) {
        this.aiBg.style.background = EMOTION_BACKGROUNDS[this.currentEmotion] || EMOTION_BACKGROUNDS.neutral;
      }
      // Intentar recargar fondos SD por si ya se generaron
      this._loadSDBackgrounds();
      return;
    }
    this.bgIndex = (this.bgIndex + 1) % this.sdBackgrounds.length;
    this._applyBackground(this.sdBackgrounds[this.bgIndex]);
  }

  _applyBackground(url) {
    if (!this.aiBg || !url) return;
    this.aiBg.classList.add('fading');
    this.aiBg.addEventListener('animationend', () => {
      this.aiBg.style.backgroundImage = `url('${url}')`;
      this.aiBg.style.background = '';
      this.aiBg.classList.remove('fading');
    }, { once: true });
  }

  // --- WebSocket: recibe comandos del Chat Bridge / OpenClaw ---
  connectWebSocket() {
    const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${location.host}/ws/commands`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket conectado');
      this.setStatus('connected', 'En vivo');
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleCommand(msg);
      } catch (err) {
        console.error('Error procesando mensaje WS:', err);
      }
    };

    this.ws.onclose = () => {
      console.log('WebSocket desconectado, reconectando...');
      this.setStatus('disconnected', 'Reconectando...');
      setTimeout(() => this.connectWebSocket(), this.reconnectDelay);
    };

    this.ws.onerror = (err) => {
      console.error('Error WebSocket:', err);
      this.ws.close();
    };
  }

  // --- Manejo de comandos ---
  async handleCommand(msg) {
    switch (msg.type) {

      case 'speak':
        this.applyEmotionEffects(msg.emotion || 'neutral');
        // Si viene con animación (ej: wave para follows/gifts), ejecutar antes de hablar
        if (msg.animation) {
          try {
            await this.head.playAnimation(`/animations/${msg.animation}.fbx`, { loop: false });
          } catch { /* animación opcional */ }
        }
        await this.head.speakText(msg.text, {
          language:   msg.language || 'es',
          avatarMood: EMOTION_MOODS[msg.emotion] || msg.emotion || 'neutral',
        });
        // Volver a neutral tras emociones intensas
        if (msg.emotion === 'excited' || msg.emotion === 'surprised') {
          setTimeout(() => this.applyEmotionEffects('neutral'), 4000);
        }
        break;

      case 'emote':
        // Reproducir animacion (wave, point, nod, etc.)
        if (msg.animation) {
          try {
            await this.head.playAnimation(`/animations/${msg.animation}.fbx`, {
              loop: msg.loop || false,
            });
          } catch (err) {
            console.warn(`Animacion '${msg.animation}' no encontrada, ignorando`);
          }
        }
        if (msg.mood) {
          this.head.setMood(msg.mood);
        }
        break;

      case 'show_product':
        this.showProduct(msg.product);
        break;

      case 'hide_product':
        this.productOverlay.style.display = 'none';
        break;

      case 'chat_message':
        this.addChatMessage(msg.user, msg.text, msg.msgType || 'chat');
        break;

      case 'speak_and_show':
        this.applyEmotionEffects('excited');
        this.showProduct(msg.product);
        try { await this.head.playAnimation('/animations/pointing.fbx'); }
        catch { /* pointing.fbx opcional */ }
        await this.head.speakText(msg.text, {
          language: msg.language || 'es',
          avatarMood: 'excited',
        });
        this.applyEmotionEffects('neutral');
        break;

      case 'set_mood':
        this.head.setMood(msg.mood);
        break;

      case 'stop_speaking':
        this.head.stopSpeaking();
        break;

      default:
        console.warn('Comando desconocido:', msg.type);
    }
  }

  // --- Mostrar producto ---
  showProduct(product) {
    if (!product) return;

    this.productName.textContent = product.name || '';
    this.productPrice.textContent = product.price || '';

    if (product.image) {
      this.productImage.src = product.image;
      this.productImage.style.display = 'block';
    } else {
      this.productImage.style.display = 'none';
    }

    this.productFeatures.innerHTML = '';
    if (product.features && Array.isArray(product.features)) {
      product.features.forEach(feature => {
        const li = document.createElement('li');
        li.textContent = feature;
        this.productFeatures.appendChild(li);
      });
    }

    if (product.qr_url && this.productQrImg) {
      this.productQrImg.src = product.qr_url;
      this.productQrBox.style.display = 'flex';
    } else if (this.productQrBox) {
      this.productQrBox.style.display = 'none';
    }

    this.productOverlay.style.display = 'block';
  }

  // --- Chat en vivo ---
  addChatMessage(user, text, msgType) {
    const msgEl = document.createElement('div');
    msgEl.className = `chat-msg ${msgType}`;
    msgEl.innerHTML = `<span class="chat-user">${this.escapeHtml(user)}:</span><span class="chat-text">${this.escapeHtml(text)}</span>`;

    this.chatMessages.appendChild(msgEl);

    // Limitar cantidad de mensajes visibles
    while (this.chatMessages.children.length > this.maxChatMessages) {
      this.chatMessages.removeChild(this.chatMessages.firstChild);
    }

    // Auto-scroll al ultimo mensaje
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }

  // --- Estado del stream ---
  setStatus(state, text) {
    this.statusIndicator.className = '';
    if (state === 'connected') {
      this.statusIndicator.classList.add('connected');
    }
    this.statusText.textContent = text;
  }

  // --- Utilidades ---
  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

// --- Iniciar aplicacion ---
const app = new InfluencerApp();
app.init().catch(console.error);

// --- Activar audio al primer click (autoplay policy del navegador) ---
const audioGate = document.getElementById('audio-gate');
if (audioGate) {
  const unlock = () => {
    // Resumir el AudioContext interno de TalkingHead
    try {
      if (app.head?.audioCtx?.state === 'suspended') {
        app.head.audioCtx.resume();
      }
    } catch(e) {}
    // Crear y resumir un AudioContext temporal para desbloquear el navegador
    try {
      const tmpCtx = new AudioContext();
      tmpCtx.resume().then(() => tmpCtx.close());
    } catch(e) {}
    audioGate.style.display = 'none';
  };
  audioGate.addEventListener('click',      unlock, { once: true });
  audioGate.addEventListener('touchstart', unlock, { once: true });
}
