"""
F5-TTS Server — Influencer 3D Powerhouse
Puerto 8882 (compatible con el slot de HeadTTS en nginx)

Endpoints:
  POST /tts         — Sintetiza texto → devuelve WAV
  POST /api/tts     — Alias (compatible con TalkingHead ttsEndpoint)
  GET  /health      — Estado del servicio y modelo
  GET  /voices      — Lista voces disponibles
"""

import asyncio
import io
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
VOICES_DIR   = Path(os.environ.get("VOICES_DIR",   "/app/voices"))
MODELS_DIR   = Path(os.environ.get("MODELS_DIR",   "/app/models"))
DEFAULT_VOICE = os.environ.get("DEFAULT_VOICE", "reference")

# Pasos de difusion: mas alto = mejor calidad, mas lento
# CPU: usar 8-16 para velocidad razonable; GPU: 32 para maxima calidad
NFE_STEP = int(os.environ.get("NFE_STEP", "16"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [F5-TTS] %(message)s")
log = logging.getLogger("f5tts")

# ---------------------------------------------------------------------------
# Estado global del motor TTS
# ---------------------------------------------------------------------------
tts_engine   = None
model_ready  = False
model_error  = None
_tts_lock    = asyncio.Lock()  # F5-TTS no es thread-safe, usar lock


def _load_model():
    """Carga el modelo F5-TTS. Descarga ~300MB la primera vez."""
    global tts_engine, model_ready, model_error
    try:
        log.info("Cargando modelo F5-TTS... (primera vez descarga ~300MB)")
        from f5_tts.api import F5TTS
        tts_engine  = F5TTS()
        model_ready = True
        log.info("Modelo F5-TTS cargado y listo.")
    except Exception as exc:
        model_error = str(exc)
        log.error(f"Error cargando modelo F5-TTS: {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Cargar modelo en background para no bloquear el arranque del servidor
    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, _load_model)
    yield


app = FastAPI(title="F5-TTS", version="1.0.0", lifespan=lifespan)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_voice_files(voice_name: str):
    """
    Busca {voice_name}.wav y {voice_name}.txt en VOICES_DIR.
    Retorna (wav_path, transcript) o lanza HTTPException.
    """
    wav_path = VOICES_DIR / f"{voice_name}.wav"
    txt_path = VOICES_DIR / f"{voice_name}.txt"

    if not wav_path.exists():
        raise HTTPException(
            status_code=503,
            detail=(
                f"Voz '{voice_name}' no encontrada. "
                f"Coloca '{voice_name}.wav' y '{voice_name}.txt' "
                f"en el volumen /app/voices/ y reinicia el contenedor."
            ),
        )

    transcript = txt_path.read_text(encoding="utf-8").strip() if txt_path.exists() else ""
    if not transcript:
        log.warning(f"Archivo de transcripcion '{voice_name}.txt' no encontrado o vacio. "
                    "La calidad de clonacion puede ser menor.")
        # Usar un transcript generico si no hay archivo
        transcript = "Hola, bienvenidos a mi canal de productos de importacion."

    return wav_path, transcript


def _synthesize(text: str, voice_name: str, speed: float) -> bytes:
    """
    Ejecuta inferencia F5-TTS y devuelve bytes WAV.
    Esta funcion es SINCRONA — llamarla siempre bajo _tts_lock.
    """
    if not model_ready:
        raise HTTPException(status_code=503, detail="Modelo TTS aun cargando, intenta en unos segundos.")

    wav_path, ref_text = _get_voice_files(voice_name)

    t0 = time.perf_counter()
    wav, sr, _ = tts_engine.infer(
        ref_file=str(wav_path),
        ref_text=ref_text,
        gen_text=text,
        speed=speed,
        nfe_step=NFE_STEP,
        show_info=lambda x: None,
    )
    elapsed = time.perf_counter() - t0
    duration = len(wav) / sr if sr > 0 else 0
    rtf = elapsed / duration if duration > 0 else 0
    log.info(f"TTS: {len(text)} chars → {duration:.1f}s audio | {elapsed:.1f}s generacion | RTF={rtf:.1f}x")

    buf = io.BytesIO()
    sf.write(buf, wav, sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

async def _handle_tts(request: Request) -> Response:
    """Logica comun para POST /tts y POST /api/tts."""
    if model_error:
        raise HTTPException(status_code=500, detail=f"Error en modelo TTS: {model_error}")
    if not model_ready:
        raise HTTPException(status_code=503, detail="Modelo cargando, intenta en unos segundos.")

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Body JSON invalido.")

    text = body.get("text", "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Campo 'text' requerido y no puede estar vacio.")

    voice = body.get("voice", DEFAULT_VOICE)
    speed = float(body.get("speed", 1.0))
    speed = max(0.5, min(speed, 2.0))  # clamp [0.5, 2.0]

    log.info(f"TTS request: voice={voice} speed={speed} text='{text[:60]}{'...' if len(text)>60 else ''}'")

    # Serializar inferencias para evitar condiciones de carrera
    async with _tts_lock:
        loop = asyncio.get_event_loop()
        wav_bytes = await loop.run_in_executor(None, _synthesize, text, voice, speed)

    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={"X-Audio-Duration": "0"},
    )


@app.post("/tts")
async def tts(request: Request):
    return await _handle_tts(request)


@app.post("/api/tts")
async def api_tts(request: Request):
    """Alias /api/tts para compatibilidad con TalkingHead ttsEndpoint."""
    return await _handle_tts(request)


@app.get("/health")
async def health():
    return JSONResponse({
        "status":      "ok" if model_ready else ("error" if model_error else "loading"),
        "model_ready": model_ready,
        "model_error": model_error,
        "nfe_step":    NFE_STEP,
        "voices_dir":  str(VOICES_DIR),
        "voices":      [p.stem for p in VOICES_DIR.glob("*.wav")],
    })


@app.get("/voices")
async def voices():
    return JSONResponse({
        "voices":  [p.stem for p in VOICES_DIR.glob("*.wav")],
        "default": DEFAULT_VOICE,
    })
