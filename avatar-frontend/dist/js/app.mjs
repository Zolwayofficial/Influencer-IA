import { TalkingHead } from 'talkinghead';

class InfluencerApp {
  constructor() {
    this.head = null;
    this.ws = null;
    this.reconnectDelay = 3000;
    this.maxChatMessages = 25;

    // DOM refs
    this.productOverlay = document.getElementById('product-overlay');
    this.productName = document.getElementById('product-name');
    this.productPrice = document.getElementById('product-price');
    this.productImage = document.getElementById('product-image');
    this.productFeatures = document.getElementById('product-features');
    this.chatMessages = document.getElementById('chat-messages');
    this.statusIndicator = document.getElementById('status-indicator');
    this.statusText = document.getElementById('status-text');
  }

  async init() {
    this.setStatus('loading', 'Cargando avatar...');

    try {
      const avatarEl = document.getElementById('avatar');

      // Inicializar TalkingHead con HeadTTS oficial como backend de TTS
      // HeadTTS corre en puerto 8882, proxied via Nginx en /tts/ws
      const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ttsUrl = `${wsProtocol}//${location.host}/tts/ws`;

      this.head = new TalkingHead(avatarEl, {
        ttsEndpoint: ttsUrl,
        ttsApikey: '',
        lipsyncModules: ['en'],
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
          ttsVoice: 'af_bella',
          ttsLang: 'en-us',
        },
        {}
      );

      this.setStatus('connected', 'Avatar listo');

    } catch (err) {
      console.error('Error inicializando avatar:', err);
      this.setStatus('error', 'Error cargando avatar: ' + err.message);
    }

    // Conectar WebSocket independientemente del estado del avatar
    this.connectWebSocket();
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
        // TalkingHead maneja TTS + lip-sync internamente via HeadTTS
        await this.head.speakText(msg.text, {
          language: msg.language || 'es',
          avatarMood: msg.emotion || 'neutral',
        });
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
        // Mostrar producto y hablar de el simultaneamente
        this.showProduct(msg.product);
        try { await this.head.playAnimation('/animations/pointing.fbx'); }
        catch { /* pointing.fbx opcional */ }
        await this.head.speakText(msg.text, {
          language: msg.language || 'es',
          avatarMood: 'excited',
        });
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
