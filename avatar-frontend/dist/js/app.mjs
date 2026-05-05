import { TalkingHead } from 'talkinghead';

// Force preserveDrawingBuffer:true on every WebGL context created on this page.
// Without it, Chrome may clear the WebGL back-buffer before drawImage() copies it
// to the 2D mirror canvas, producing a blank frame.  Must run before TalkingHead
// constructs its Three.js WebGLRenderer.
{
  const _origGetCtx = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type, attrs) {
    if (type === 'webgl' || type === 'webgl2') {
      attrs = Object.assign({}, attrs, { preserveDrawingBuffer: true });
    }
    return _origGetCtx.call(this, type, attrs);
  };
}

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
  surprised: 'neutral',  // TalkingHead no tiene surprised — neutral evita cara triste
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

    // Modo stream: solo activo cuando la URL incluye ?key=live1234
    const _urlKey = new URLSearchParams(location.search).get('key');
    this._streamMode = _urlKey === 'live1234';

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
    this.productQrImg         = document.getElementById('product-qr-img');
    this.productQrBox         = document.getElementById('product-qr');
    this.productImageContainer = document.getElementById('product-image-container');
    this.productVideo      = document.getElementById('product-video');
    this.productOrigPrice  = document.getElementById('product-original-price');
    this.productTimer      = document.getElementById('product-timer');
    this.productTimerLabel = document.getElementById('product-timer-label');
    this.timerMin          = document.getElementById('timer-min');
    this.timerSec          = document.getElementById('timer-sec');
    this._promoInterval    = null;
    this._promoHideTimeout = null;

    // Screen share
    this.screenCanvas      = document.getElementById('screen-canvas');
    this.screensharePrompt = document.getElementById('screenshare-prompt');
    this._screenStream     = null;
    this._captureInterval  = null;
    this._autonomousMode   = false;
    this._screenshotTimeout = null;

    document.getElementById('screenshare-btn').addEventListener('click', () => this._startScreenShare());
  }

  async init() {
    this.setStatus('loading', 'Cargando avatar...');

    try {
      const avatarEl = document.getElementById('avatar');

      this.head = new TalkingHead(avatarEl, {
        ttsEndpoint: '/tts/api/tts',   // F5-TTS via nginx proxy
        lipsyncModules: ['en'],  // lipsync-es.mjs no existe en CDN @1.7 → solo 'en'
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
      this._setupAudioUnlock();
      this._setupWebGLMirror();

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

    // 1. Fondo CSS: solo si no hay fondo personalizado ni fondos SD cargados
    if (!this._customBg && this.sdBackgrounds.length === 0 && this.aiBg) {
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
        if (!this._customBg) this._applyBackground(this.sdBackgrounds[0]);
        console.log(`[BG] ${this.sdBackgrounds.length} fondos SD cargados`);
      }
    } catch {
      // SD no disponible — se usan gradientes CSS por emocion (ya aplicados)
    }
  }

  _rotateBackground() {
    if (this._customBg) return; // fondo personalizado activo, no rotar
    if (this.sdBackgrounds.length === 0) {
      if (this.aiBg) {
        this.aiBg.style.background = EMOTION_BACKGROUNDS[this.currentEmotion] || EMOTION_BACKGROUNDS.neutral;
      }
      this._loadSDBackgrounds();
      return;
    }
    this.bgIndex = (this.bgIndex + 1) % this.sdBackgrounds.length;
    this._applyBackground(this.sdBackgrounds[this.bgIndex]);
  }

  _applyCustomBackground(url) {
    const bgVideo = document.getElementById('bg-video');
    this._customBg = url || null;
    if (!url) {
      bgVideo.style.display = 'none';
      bgVideo.src = '';
      this.aiBg.style.backgroundImage = '';
      this.aiBg.style.background = EMOTION_BACKGROUNDS[this.currentEmotion] || EMOTION_BACKGROUNDS.neutral;
      return;
    }
    const isVideo = /\.(mp4|webm|mov|ogg)(\?|$)/i.test(url);
    if (isVideo) {
      bgVideo.src = url;
      bgVideo.style.display = 'block';
      bgVideo.load();
      bgVideo.play().catch(() => {});
      this.aiBg.style.backgroundImage = '';
    } else {
      bgVideo.style.display = 'none';
      bgVideo.src = '';
      this.aiBg.style.backgroundImage = `url('${url}')`;
      this.aiBg.style.backgroundSize = 'cover';
      this.aiBg.style.backgroundPosition = 'center';
    }
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
        if (!this._streamMode) break; // preview no habla
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
        // Siempre volver a happy al terminar para no quedarse con cara triste
        try { this.head.setMood('happy'); } catch(e) {}
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
        if (this._promoInterval) { clearInterval(this._promoInterval); this._promoInterval = null; }
        if (this._promoHideTimeout) { clearTimeout(this._promoHideTimeout); this._promoHideTimeout = null; }
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
        try { this.head.setMood('happy'); } catch(e) {}
        this.applyEmotionEffects('neutral');
        break;

      case 'set_background':
        this._applyCustomBackground(msg.url || null);
        break;

      case 'set_layout':
        document.body.classList.toggle('spotlight', msg.mode === 'spotlight');
        break;

      case 'screenshare_request':
        if (navigator.mediaDevices?.getDisplayMedia) {
          this.screensharePrompt.style.display = 'flex';
        }
        break;

      case 'screenshare_mode':
        this._screensharePreference = msg.mode;
        if (this._screenStream) {
          document.body.classList.remove('screenshare-presentation', 'screenshare-only');
          if (msg.mode === 'presentation') document.body.classList.add('screenshare-presentation');
          else if (msg.mode === 'only')     document.body.classList.add('screenshare-only');
        }
        break;

      case 'screenshare_stop':
        this._stopScreenShare();
        break;

      case 'show_screenshot': {
        if (!msg.image) break;
        // new Image() es universal: funciona en Chrome, CEF (TikTok), Safari.
        // fetch(data:...) puede fallar silenciosamente en browsers embebidos.
        const _img = new Image();
        _img.onload = () => {
          if (!document.body.classList.contains('screenshare-presentation') &&
              !document.body.classList.contains('screenshare-only')) {
            document.body.classList.add('screenshare-presentation');
          }
          this.screenCanvas.style.cssText = '';
          this.screenCanvas.width  = window.innerWidth;
          this.screenCanvas.height = window.innerHeight;
          const cw = this.screenCanvas.width, ch = this.screenCanvas.height;
          const scale = Math.min(cw / _img.naturalWidth, ch / _img.naturalHeight);
          const w = _img.naturalWidth * scale, h = _img.naturalHeight * scale;
          const x = (cw - w) / 2, y = (ch - h) / 2;
          this._slideImg = _img;
          this._slideDrawParams = { x, y, w, h, cw, ch };
          // Cancelar siempre el loop anterior y reiniciar — fuerza repaint en CEF
          if (this._slideRaf) { cancelAnimationFrame(this._slideRaf); this._slideRaf = null; }
          const loop = () => {
            if (!this._slideImg) return;
            const { x, y, w, h, cw, ch } = this._slideDrawParams;
            const ctx = this.screenCanvas.getContext('2d');
            ctx.fillStyle = '#111';
            ctx.fillRect(0, 0, cw, ch);
            ctx.drawImage(this._slideImg, x, y, w, h);
            this._slideRaf = requestAnimationFrame(loop);
          };
          this._slideRaf = requestAnimationFrame(loop);
          console.log('[Slide] mostrado:', _img.naturalWidth + 'x' + _img.naturalHeight);
        };
        _img.onerror = e => console.warn('[screenshot] error cargando imagen', e);
        _img.src = msg.image;
        if (this._screenshotTimeout) clearTimeout(this._screenshotTimeout);
        const dur = (msg.duration || 20) * 1000;
        this._screenshotTimeout = setTimeout(() => {
          this._screenshotTimeout = null;
          this._stopScreenShare();
        }, dur);
        break;
      }

      case 'capture_and_narrate':
        this._captureAndNarrate();
        break;

      case 'set_autonomous':
        this._autonomousMode = !!msg.enabled;
        if (this._autonomousMode && this._screenStream) {
          this._startScreenCapture();
        } else {
          this._stopScreenCapture();
        }
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

  // --- Countdown promo ---
  _startPromoTimer(seconds) {
    if (this._promoInterval) { clearInterval(this._promoInterval); this._promoInterval = null; }
    if (this._promoHideTimeout) { clearTimeout(this._promoHideTimeout); this._promoHideTimeout = null; }

    let remaining = seconds;
    const update = (s) => {
      this.timerMin.textContent = String(Math.floor(s / 60)).padStart(2, '0');
      this.timerSec.textContent = String(s % 60).padStart(2, '0');
    };

    this.productTimer.style.display = 'flex';
    this.productTimer.classList.remove('urgent');
    this.productTimerLabel.textContent = 'Oferta termina en';
    update(remaining);

    this._promoInterval = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(this._promoInterval);
        this._promoInterval = null;
        this.timerMin.textContent = '00';
        this.timerSec.textContent = '00';
        this.productTimerLabel.textContent = '¡Oferta terminada!';
        this.productTimer.classList.add('urgent');
        this._promoHideTimeout = setTimeout(() => {
          this._promoHideTimeout = null;
          this.productOverlay.style.display = 'none';
        }, 3000);
        return;
      }
      if (remaining <= 60) this.productTimer.classList.add('urgent');
      update(remaining);
    }, 1000);
  }

  // --- Mostrar producto ---
  showProduct(product) {
    if (!product) return;

    // Limpiar timer anterior e hide-timeout pendiente
    if (this._promoInterval) {
      clearInterval(this._promoInterval);
      this._promoInterval = null;
    }
    if (this._promoHideTimeout) {
      clearTimeout(this._promoHideTimeout);
      this._promoHideTimeout = null;
    }

    this.productName.textContent = product.name || '';

    // Precio original tachado (promo) o solo precio normal
    if (product.original_price) {
      this.productOrigPrice.textContent = product.original_price;
      this.productOrigPrice.style.display = 'block';
    } else {
      this.productOrigPrice.style.display = 'none';
    }

    this.productPrice.textContent = product.price || '';

    if (product.video) {
      this.productImage.style.display = 'none';
      this.productVideo.src = product.video;
      this.productVideo.style.display = 'block';
      this.productVideo.load();
      this.productVideo.play().catch(() => {});
      if (this.productImageContainer) this.productImageContainer.style.display = '';
    } else if (product.image) {
      this.productVideo.style.display = 'none';
      this.productImage.src = product.image;
      this.productImage.style.display = 'block';
      if (this.productImageContainer) this.productImageContainer.style.display = '';
    } else {
      this.productImage.style.display = 'none';
      this.productVideo.style.display = 'none';
      if (this.productImageContainer) this.productImageContainer.style.display = 'none';
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

    // Countdown de promo (si viene con timer)
    if (product.promo_seconds && product.promo_seconds > 0) {
      this._startPromoTimer(product.promo_seconds);
    } else {
      this.productTimer.style.display = 'none';
      this.productTimer.classList.remove('urgent');
    }

    this.productOverlay.style.display = document.body.classList.contains('spotlight') ? 'flex' : 'block';
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

  // --- Desbloqueo de audio: solo en modo stream ---
  _setupAudioUnlock() {
    const tryResume = () => {
      try { if (this.head?.audioCtx?.state === 'suspended') this.head.audioCtx.resume(); } catch(e) {}
    };

    // Intento inmediato (funciona en OBS/Chromium headless)
    tryResume();

    if (!this._streamMode) {
      // Modo preview: badge visual, sin audio ni voz
      const badge = document.createElement('div');
      badge.style.cssText = 'position:fixed;top:12px;right:12px;background:rgba(0,0,0,0.55);color:#666;padding:4px 10px;border-radius:6px;font-size:0.7rem;font-family:sans-serif;letter-spacing:0.05em;pointer-events:none;z-index:9999';
      badge.textContent = 'PREVIEW';
      document.body.appendChild(badge);
      return;
    }

    // Modo stream: desbloquear silenciosamente al primer clic
    let _unlocked = false;
    const unlock = async () => {
      if (_unlocked) return;
      _unlocked = true;
      tryResume();
      await new Promise(r => setTimeout(r, 300));
      try {
        await this.head.speakText('¡Bienvenidos! Soy tu influencer virtual. ¿En qué los puedo ayudar hoy?', {
          language: 'es',
          avatarMood: 'happy',
        });
      } catch(e) { console.warn('Auto-speak falló:', e); }
    };
    document.addEventListener('click', unlock, { once: true, passive: true });
  }

  // --- Screen Share ---
  async _startScreenShare() {
    this.screensharePrompt.style.display = 'none';
    try {
      this._screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false,
      });

      // Activar modo presentación — CSS (screenshare-presentation) maneja el layout PiP
      if (!document.body.classList.contains('screenshare-presentation') &&
          !document.body.classList.contains('screenshare-only')) {
        document.body.classList.add('screenshare-presentation');
      }
      this.screenCanvas.style.cssText = '';

      // Buffer full viewport — CSS maneja la posición y z-index
      this.screenCanvas.width  = window.innerWidth;
      this.screenCanvas.height = window.innerHeight;
      const ctx = this.screenCanvas.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, this.screenCanvas.width, this.screenCanvas.height);

      // Hidden video must be in DOM (not hidden via opacity — Chrome skips decoding
      // for opacity:0 elements). Positioned off-screen so it's invisible but active.
      const hiddenVideo = document.createElement('video');
      hiddenVideo.srcObject = this._screenStream;
      hiddenVideo.muted = true;
      hiddenVideo.playsInline = true;
      hiddenVideo.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;pointer-events:none';
      document.body.appendChild(hiddenVideo);
      this._proxyVideo = hiddenVideo;
      await hiddenVideo.play();

      const W = this.screenCanvas.width;
      const H = this.screenCanvas.height;

      // requestVideoFrameCallback: fires when a real frame is ready — more reliable
      // than readyState checks and works even when the tab is in the background.
      if (hiddenVideo.requestVideoFrameCallback) {
        const rVFC = () => {
          if (!this._screenStream) return;
          try { ctx.drawImage(hiddenVideo, 0, 0, W, H); } catch(e) { console.warn('draw:', e); }
          hiddenVideo.requestVideoFrameCallback(rVFC);
        };
        hiddenVideo.requestVideoFrameCallback(rVFC);
      } else {
        // Fallback: setInterval at 30fps (runs in background unlike RAF)
        this._proxyRaf = setInterval(() => {
          if (!this._screenStream) return;
          try {
            if (hiddenVideo.readyState >= 2) ctx.drawImage(hiddenVideo, 0, 0, W, H);
          } catch(e) {}
        }, 33);
      }

      this._screenStream.getVideoTracks()[0].addEventListener('ended', () => this._stopScreenShare());

    } catch (err) {
      console.warn('Screen share cancelado o error:', err);
    }
  }

  _captureAndNarrate() {
    const canvas = this.screenCanvas;
    if (!canvas || !canvas.width || !canvas.height) return;
    try {
      const off = document.createElement('canvas');
      const scale = Math.min(1, 1280 / canvas.width);
      off.width  = Math.round(canvas.width  * scale);
      off.height = Math.round(canvas.height * scale);
      off.getContext('2d').drawImage(canvas, 0, 0, off.width, off.height);
      const jpeg = off.toDataURL('image/jpeg', 0.85);
      fetch('/agent/narrate-frame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: jpeg }),
      }).catch(e => console.warn('[Narrate] POST error:', e));
    } catch(e) { console.warn('[Narrate] capture error:', e); }
  }

  _stopScreenShare() {
    this._stopScreenCapture();
    // _proxyRaf holds a setInterval ID (fallback path); rVFC stops when srcObject is nulled
    if (this._proxyRaf) { clearInterval(this._proxyRaf); this._proxyRaf = null; }
    if (this._proxyVideo) {
      this._proxyVideo.srcObject = null;
      if (this._proxyVideo.parentNode) this._proxyVideo.parentNode.removeChild(this._proxyVideo);
      this._proxyVideo = null;
    }
    if (this._screenStream) {
      this._screenStream.getTracks().forEach(t => t.stop());
      this._screenStream = null;
    }
    // Detener loop de redibujado de slides
    if (this._slideRaf) { cancelAnimationFrame(this._slideRaf); this._slideRaf = null; }
    if (this._slideBitmap) { this._slideBitmap.close(); this._slideBitmap = null; }
    this._slideImg = null;
    this._slideDrawParams = null;
    const ctx = this.screenCanvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, this.screenCanvas.width, this.screenCanvas.height);
    this.screenCanvas.style.cssText = '';
    document.body.classList.remove('screenshare-presentation', 'screenshare-only');
  }

  _startScreenCapture() {
    if (this._captureInterval) return;
    this._captureInterval = setInterval(() => {
      if (!this._screenStream || !this.screenCanvas.width) return;
      try {
        const scale  = Math.min(1, 1280 / this.screenCanvas.width);
        const canvas = document.createElement('canvas');
        canvas.width  = this.screenCanvas.width  * scale;
        canvas.height = this.screenCanvas.height * scale;
        canvas.getContext('2d').drawImage(this.screenCanvas, 0, 0, canvas.width, canvas.height);
        const jpeg = canvas.toDataURL('image/jpeg', 0.5);
        fetch('/agent/screenshot', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ image: jpeg }),
        }).catch(() => {});
      } catch (_) {}
    }, 10000);
  }

  _stopScreenCapture() {
    if (this._captureInterval) {
      clearInterval(this._captureInterval);
      this._captureInterval = null;
    }
  }

  // --- bitmaprenderer mirror: copia cada frame WebGL→ImageBitmap→canvas visible ---
  // Chrome (ANGLE) promueve canvases WebGL a DirectX swap chains que DirectComposition
  // convierte en hardware MPO overlay planes. TikTok Live Studio usa WGC para Window
  // Capture, que lee el DOM compositor y NO ve los planos MPO → frame congelado.
  //
  // Solución definitiva (investigación 2026-04-25):
  // 1. bitmaprenderer context: Chrome nunca promueve superficies ImageBitmap a MPO.
  // 2. createImageBitmap(webglCanvas): copia el frame del WebGL canvas (preserveDrawingBuffer
  //    asegura que el buffer no se haya borrado antes de esta llamada).
  // 3. transferFromImageBitmap: vuelca el bitmap al canvas visible sin crear contexto WebGL.
  //
  // Solución de respaldo (Solution B): isolation:isolate + mix-blend-mode:normal en CSS
  // obliga a Chrome a componer el grupo WebGL por software antes de enviarlo al DWM.
  _setupWebGLMirror() {
    const webglCanvas = this.avatarEl.querySelector('canvas');
    if (!webglCanvas) { console.warn('[Mirror] WebGL canvas not found'); return; }

    const mirror = document.getElementById('avatar-mirror');
    if (!mirror) { console.warn('[Mirror] #avatar-mirror not found'); return; }

    // Solution B: aplicar mix-blend-mode al canvas WebGL directamente para forzar
    // composición por software (evita que Chrome lo ponga en hardware MPO overlay).
    webglCanvas.style.mixBlendMode = 'normal';
    webglCanvas.style.willChange   = 'transform';
    webglCanvas.style.transform    = 'translateZ(0)';

    // Solution A (principal): bitmaprenderer — superficie que Chrome nunca pone en MPO
    const bitmapCtx = mirror.getContext('bitmaprenderer');

    const syncSize = () => {
      const w = webglCanvas.width  || window.innerWidth;
      const h = webglCanvas.height || window.innerHeight;
      if (mirror.width !== w || mirror.height !== h) {
        mirror.width  = w;
        mirror.height = h;
      }
    };
    new ResizeObserver(syncSize).observe(webglCanvas);
    syncSize();

    if (bitmapCtx) {
      // bitmaprenderer path: createImageBitmap → transferFromImageBitmap
      // Chrome trata esta superficie como bitmap plano, jamás como swap chain DirectX.
      let _pending = false;
      const loop = () => {
        this._mirrorRaf = requestAnimationFrame(loop);
        if (_pending || !webglCanvas.width) return;
        _pending = true;
        createImageBitmap(webglCanvas)
          .then(bitmap => { bitmapCtx.transferFromImageBitmap(bitmap); })
          .catch(() => {})
          .finally(() => { _pending = false; });
      };
      this._mirrorRaf = requestAnimationFrame(loop);
      console.log('[Mirror] bitmaprenderer activo (Solution A) — TikTok MPO fix');
    } else {
      // Fallback: 2d canvas con drawImage
      console.warn('[Mirror] bitmaprenderer no disponible, usando 2d fallback');
      const ctx = mirror.getContext('2d');
      const loop = () => {
        syncSize();
        try {
          ctx.clearRect(0, 0, mirror.width, mirror.height);
          ctx.drawImage(webglCanvas, 0, 0, mirror.width, mirror.height);
        } catch (_) {}
        this._mirrorRaf = requestAnimationFrame(loop);
      };
      this._mirrorRaf = requestAnimationFrame(loop);
    }
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

