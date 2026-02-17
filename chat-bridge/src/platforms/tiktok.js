const { WebcastPushConnection } = require('tiktok-live-connector');

class TikTokChatReader {
  constructor(username, sessionId, onMessage) {
    this.username = username;
    this.onMessage = onMessage;
    this.connected = false;

    const options = {};
    if (sessionId) {
      options.sessionId = sessionId;
    }

    this.connection = new WebcastPushConnection(username, options);

    // Manejar desconexion
    this.connection.on('disconnected', () => {
      console.log('[TikTok] Desconectado');
      this.connected = false;
    });

    this.connection.on('error', (err) => {
      console.error('[TikTok] Error:', err.message);
    });
  }

  async connect() {
    const state = await this.connection.connect();
    this.connected = true;
    console.log(`[TikTok] Conectado a room ${state.roomId} (${state.viewerCount} viewers)`);

    // Mensajes de chat
    this.connection.on('chat', (data) => {
      this.onMessage({
        platform: 'tiktok',
        user: data.uniqueId,
        text: data.comment,
        timestamp: Date.now(),
        type: 'chat',
      });
    });

    // Regalos
    this.connection.on('gift', (data) => {
      // Solo procesar cuando el combo de regalo termina
      if (data.giftType === 1 && !data.repeatEnd) return;

      this.onMessage({
        platform: 'tiktok',
        user: data.uniqueId,
        text: `envio ${data.giftName} x${data.repeatCount || 1}`,
        timestamp: Date.now(),
        type: 'gift',
        meta: {
          giftName: data.giftName,
          giftId: data.giftId,
          diamondCount: data.diamondCount,
          repeatCount: data.repeatCount || 1,
        },
      });
    });

    // Nuevos seguidores
    this.connection.on('social', (data) => {
      if (data.displayType === 'pm_mt_msg_viewer_follow') {
        this.onMessage({
          platform: 'tiktok',
          user: data.uniqueId,
          text: 'se ha unido como seguidor',
          timestamp: Date.now(),
          type: 'follow',
        });
      }
    });

    // Likes
    this.connection.on('like', (data) => {
      // Solo notificar likes grandes para no spamear
      if (data.likeCount >= 10) {
        this.onMessage({
          platform: 'tiktok',
          user: data.uniqueId,
          text: `dio ${data.likeCount} likes`,
          timestamp: Date.now(),
          type: 'like',
        });
      }
    });

    // Viewers count update
    this.connection.on('roomUser', (data) => {
      console.log(`[TikTok] Viewers: ${data.viewerCount}`);
    });
  }

  isConnected() {
    return this.connected;
  }

  disconnect() {
    this.connection.disconnect();
    this.connected = false;
  }
}

module.exports = { TikTokChatReader };
