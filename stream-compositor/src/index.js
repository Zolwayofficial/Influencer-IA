const express = require('express');
const { spawn } = require('child_process');
const { Client: MinioClient } = require('minio');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 5000;
const DISPLAY = process.env.DISPLAY || ':99';
const WIDTH = process.env.STREAM_WIDTH || '1920';
const HEIGHT = process.env.STREAM_HEIGHT || '1080';
const FPS = process.env.STREAM_FPS || '30';
const BITRATE = process.env.STREAM_BITRATE || '4000k';
const RTMP_TARGET = process.env.MEDIAMTX_RTMP || 'rtmp://mediamtx:1935/live/influencer';

// MinIO client para subir grabaciones
const minio = new MinioClient({
  endPoint: process.env.MINIO_ENDPOINT?.split(':')[0] || 'minio',
  port: parseInt(process.env.MINIO_ENDPOINT?.split(':')[1] || '9000'),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || '',
  secretKey: process.env.MINIO_SECRET_KEY || '',
});
const BUCKET = process.env.MINIO_BUCKET || 'recordings';

// Estado
let streamProcess = null;
let recordProcess = null;
let isStreaming = false;
let isRecording = false;
let streamStartTime = null;
let currentRecordingFile = null;

const app = express();
app.use(express.json());

// --- FFmpeg args builder (SEGURO: sin shell=true) ---
function buildFFmpegArgs(output, extraOutputArgs = []) {
  return [
    // Input: captura X11
    '-f', 'x11grab',
    '-framerate', FPS,
    '-video_size', `${WIDTH}x${HEIGHT}`,
    '-i', DISPLAY,
    // Input: audio de PulseAudio
    '-f', 'pulse',
    '-i', 'virtual_sink.monitor',
    // Video encoding
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-profile:v', 'high',
    '-level', '4.2',
    '-g', String(parseInt(FPS) * 2), // keyframe cada 2 seg
    '-b:v', BITRATE,
    '-maxrate', BITRATE,
    '-bufsize', String(parseInt(BITRATE) * 2) + 'k',
    // Audio encoding
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    '-af', 'aresample=async=1',
    // Extra args
    ...extraOutputArgs,
    // Output
    output,
  ];
}

// --- Streaming ---
function startStreaming() {
  if (isStreaming) return { error: 'Already streaming' };

  const args = buildFFmpegArgs(RTMP_TARGET, ['-f', 'flv']);
  streamProcess = spawn('ffmpeg', args);
  isStreaming = true;
  streamStartTime = Date.now();

  streamProcess.stderr.on('data', (data) => {
    const line = data.toString();
    // Solo loguear lineas de progreso relevantes
    if (line.includes('frame=') || line.includes('Error') || line.includes('error')) {
      process.stdout.write(`[Stream] ${line}`);
    }
  });

  streamProcess.on('close', (code) => {
    console.log(`[Stream] FFmpeg terminado con codigo ${code}`);
    isStreaming = false;
    streamProcess = null;
    streamStartTime = null;
  });

  streamProcess.on('error', (err) => {
    console.error('[Stream] Error spawning FFmpeg:', err.message);
    isStreaming = false;
    streamProcess = null;
  });

  console.log(`[Stream] Iniciado -> ${RTMP_TARGET}`);
  return { status: 'streaming', target: RTMP_TARGET };
}

function stopStreaming() {
  if (!isStreaming || !streamProcess) return { error: 'Not streaming' };

  streamProcess.stdin.write('q'); // Graceful quit
  setTimeout(() => {
    if (streamProcess) {
      streamProcess.kill('SIGTERM');
    }
  }, 5000);

  return { status: 'stopping' };
}

// --- Recording ---
function startRecording(filename) {
  if (isRecording) return { error: 'Already recording' };

  const recordFile = filename || `recording_${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`;
  const recordPath = `/tmp/${recordFile}`;
  currentRecordingFile = recordPath;

  const args = buildFFmpegArgs(recordPath, [
    '-f', 'mp4',
    '-movflags', '+faststart',
  ]);

  recordProcess = spawn('ffmpeg', args);
  isRecording = true;

  recordProcess.stderr.on('data', (data) => {
    const line = data.toString();
    if (line.includes('frame=') && line.includes('time=')) {
      // Log cada ~10 seg
    }
  });

  recordProcess.on('close', async (code) => {
    console.log(`[Record] FFmpeg terminado con codigo ${code}`);
    isRecording = false;

    // Subir a MinIO si el archivo existe
    if (currentRecordingFile && fs.existsSync(currentRecordingFile)) {
      try {
        const objectName = path.basename(currentRecordingFile);
        await ensureBucket();
        await minio.fPutObject(BUCKET, objectName, currentRecordingFile, {
          'Content-Type': 'video/mp4',
        });
        console.log(`[Record] Subido a MinIO: ${BUCKET}/${objectName}`);
        // Limpiar archivo temporal
        fs.unlinkSync(currentRecordingFile);
      } catch (err) {
        console.error('[Record] Error subiendo a MinIO:', err.message);
      }
    }

    recordProcess = null;
    currentRecordingFile = null;
  });

  console.log(`[Record] Iniciado -> ${recordPath}`);
  return { status: 'recording', file: recordFile };
}

function stopRecording() {
  if (!isRecording || !recordProcess) return { error: 'Not recording' };

  recordProcess.stdin.write('q');
  setTimeout(() => {
    if (recordProcess) {
      recordProcess.kill('SIGTERM');
    }
  }, 5000);

  return { status: 'stopping', file: currentRecordingFile };
}

async function ensureBucket() {
  const exists = await minio.bucketExists(BUCKET);
  if (!exists) {
    await minio.makeBucket(BUCKET);
    console.log(`[MinIO] Bucket '${BUCKET}' creado`);
  }
}

// --- API REST ---

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    streaming: isStreaming,
    recording: isRecording,
    uptime: streamStartTime ? Math.floor((Date.now() - streamStartTime) / 1000) : 0,
    config: {
      resolution: `${WIDTH}x${HEIGHT}`,
      fps: FPS,
      bitrate: BITRATE,
    },
  });
});

app.post('/api/stream/start', (req, res) => {
  const result = startStreaming();
  res.json(result);
});

app.post('/api/stream/stop', (req, res) => {
  const result = stopStreaming();
  res.json(result);
});

app.post('/api/record/start', (req, res) => {
  const result = startRecording(req.body.filename);
  res.json(result);
});

app.post('/api/record/stop', (req, res) => {
  const result = stopRecording();
  res.json(result);
});

// Iniciar stream + recording simultaneamente
app.post('/api/go-live', (req, res) => {
  const streamResult = startStreaming();
  const recordResult = startRecording(req.body.filename);
  res.json({ stream: streamResult, record: recordResult });
});

// Detener todo
app.post('/api/stop-all', (req, res) => {
  const streamResult = stopStreaming();
  const recordResult = stopRecording();
  res.json({ stream: streamResult, record: recordResult });
});

// Listar grabaciones en MinIO
app.get('/api/recordings', async (req, res) => {
  try {
    await ensureBucket();
    const objects = [];
    const stream = minio.listObjects(BUCKET, '', true);
    stream.on('data', (obj) => objects.push({
      name: obj.name,
      size: obj.size,
      lastModified: obj.lastModified,
    }));
    stream.on('end', () => res.json(objects));
    stream.on('error', (err) => res.status(500).json({ error: err.message }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Arranque ---
app.listen(PORT, () => {
  console.log(`[Compositor] API escuchando en puerto ${PORT}`);
  console.log(`[Compositor] Config: ${WIDTH}x${HEIGHT}@${FPS}fps, ${BITRATE}`);
  console.log(`[Compositor] RTMP target: ${RTMP_TARGET}`);
});
