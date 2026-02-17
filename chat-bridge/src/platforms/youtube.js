const { google } = require('googleapis');

class YouTubeChatReader {
  constructor(apiKey, videoId, onMessage) {
    this.apiKey = apiKey;
    this.videoId = videoId;
    this.onMessage = onMessage;
    this.connected = false;
    this.liveChatId = null;
    this.pageToken = null;
    this.pollTimer = null;
    this.youtube = google.youtube({ version: 'v3', auth: apiKey });
  }

  async connect() {
    // Paso 1: Obtener el liveChatId del video
    const videoRes = await this.youtube.videos.list({
      part: ['liveStreamingDetails'],
      id: [this.videoId],
    });

    const items = videoRes.data.items;
    if (!items || items.length === 0) {
      throw new Error(`Video ${this.videoId} no encontrado`);
    }

    const liveDetails = items[0].liveStreamingDetails;
    if (!liveDetails || !liveDetails.activeLiveChatId) {
      throw new Error(`Video ${this.videoId} no tiene live chat activo`);
    }

    this.liveChatId = liveDetails.activeLiveChatId;
    this.connected = true;
    console.log(`[YouTube] Live chat ID: ${this.liveChatId}`);

    // Paso 2: Comenzar polling
    this.poll();
  }

  async poll() {
    if (!this.connected) return;

    try {
      const params = {
        liveChatId: this.liveChatId,
        part: ['snippet', 'authorDetails'],
        maxResults: 200,
      };

      if (this.pageToken) {
        params.pageToken = this.pageToken;
      }

      const res = await this.youtube.liveChatMessages.list(params);
      const data = res.data;

      this.pageToken = data.nextPageToken;
      const pollingInterval = data.pollingIntervalMillis || 5000;

      // Procesar mensajes nuevos
      if (data.items) {
        for (const item of data.items) {
          const snippet = item.snippet;
          const author = item.authorDetails;

          // Solo procesar mensajes de texto (no system messages)
          if (snippet.type === 'textMessageEvent') {
            this.onMessage({
              platform: 'youtube',
              user: author.displayName,
              text: snippet.displayMessage,
              timestamp: new Date(snippet.publishedAt).getTime(),
              type: 'chat',
              meta: {
                channelId: author.channelId,
                isModerator: author.isChatModerator,
                isOwner: author.isChatOwner,
                isSponsor: author.isChatSponsor,
              },
            });
          } else if (snippet.type === 'superChatEvent') {
            this.onMessage({
              platform: 'youtube',
              user: author.displayName,
              text: snippet.superChatDetails?.userComment || 'Super Chat!',
              timestamp: new Date(snippet.publishedAt).getTime(),
              type: 'gift',
              meta: {
                amount: snippet.superChatDetails?.amountDisplayString,
                tier: snippet.superChatDetails?.tier,
              },
            });
          } else if (snippet.type === 'newSponsorEvent') {
            this.onMessage({
              platform: 'youtube',
              user: author.displayName,
              text: 'se hizo miembro del canal',
              timestamp: new Date(snippet.publishedAt).getTime(),
              type: 'follow',
            });
          }
        }
      }

      // Programar siguiente poll
      this.pollTimer = setTimeout(() => this.poll(), pollingInterval);

    } catch (err) {
      console.error('[YouTube] Error en polling:', err.message);

      // Si es error de quota o auth, esperar mas tiempo
      if (err.code === 403 || err.code === 401) {
        console.error('[YouTube] Error de autorizacion/quota. Reintentando en 60s...');
        this.pollTimer = setTimeout(() => this.poll(), 60000);
      } else {
        // Error generico, reintentar en 10s
        this.pollTimer = setTimeout(() => this.poll(), 10000);
      }
    }
  }

  isConnected() {
    return this.connected;
  }

  stop() {
    this.connected = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    console.log('[YouTube] Chat reader detenido');
  }
}

module.exports = { YouTubeChatReader };
