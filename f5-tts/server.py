"""
F5-TTS Server — Influencer 3D Powerhouse
Puerto 8882

Modos TTS:
  TTS_ENGINE=edge  (default) — edge-tts: Microsoft neural, instantaneo, gratis
  TTS_ENGINE=f5             — F5-TTS: voice cloning, lento en CPU

Endpoints:
  POST /api/tts  — Google TTS compatible (TalkingHead)
  GET  /health
"""

import asyncio
import base64
import io
import logging
import os
import subprocess
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path

import soundfile as sf
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
VOICES_DIR    = Path(os.environ.get("VOICES_DIR",    "/app/voices"))
MODELS_DIR    = Path(os.environ.get("MODELS_DIR",    "/app/models"))
DEFAULT_VOICE = os.environ.get("DEFAULT_VOICE",  "reference")
TTS_ENGINE    = os.environ.get("TTS_ENGINE",     "edge")   # "edge" | "f5"
EDGE_VOICE    = os.environ.get("EDGE_VOICE",     "es-ES-ElviraNeural")

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


async def _synthesize_edge(text: str) -> bytes:
    """edge-tts: genera MP3 en <1s usando Microsoft Azure TTS gratuito."""
    import edge_tts
    communicate = edge_tts.Communicate(text, EDGE_VOICE)
    audio = b""
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio += chunk["data"]
    return audio  # MP3


def _wav_to_ogg(wav_bytes: bytes) -> bytes:
    """Convierte bytes WAV → bytes OGG-OPUS usando ffmpeg."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_in:
        tmp_in.write(wav_bytes)
        tmp_in_path = tmp_in.name
    tmp_out_path = tmp_in_path.replace(".wav", ".ogg")
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", tmp_in_path, "-c:a", "libopus", "-b:a", "64k", tmp_out_path],
            capture_output=True, check=True, timeout=30
        )
        with open(tmp_out_path, "rb") as f:
            return f.read()
    finally:
        for p in (tmp_in_path, tmp_out_path):
            try:
                os.unlink(p)
            except OSError:
                pass


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
    """
    Logica comun para POST /tts y POST /api/tts.
    Acepta formato Google TTS (TalkingHead) o formato simple.
    Devuelve JSON { audioContent: base64_ogg } compatible con TalkingHead.
    """
    # Para F5-TTS verificar que el modelo este listo (edge-tts no lo necesita)
    if TTS_ENGINE != "edge":
        if model_error:
            raise HTTPException(status_code=500, detail=f"Error en modelo TTS: {model_error}")
        if not model_ready:
            raise HTTPException(status_code=503, detail="Modelo cargando, intenta en unos segundos.")

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Body JSON invalido.")

    # Aceptar formato Google TTS: { input: { text: "..." } }
    # O formato simple: { text: "..." }
    input_field = body.get("input", {})
    text = (input_field.get("text") or input_field.get("ssml") or body.get("text", "")).strip()
    if not text:
        raise HTTPException(status_code=400, detail="Campo 'text' o 'input.text' requerido.")

    voice = body.get("voice", DEFAULT_VOICE)
    if isinstance(voice, dict):
        voice = DEFAULT_VOICE  # TalkingHead manda objeto, ignorar
    speed = float(body.get("speed", 1.0))
    speed = max(0.5, min(speed, 2.0))

    log.info(f"TTS request: voice={voice} speed={speed} text='{text[:60]}{'...' if len(text)>60 else ''}'")

    if TTS_ENGINE == "edge":
        # edge-tts: rapido, Microsoft neural, devuelve MP3 directamente
        mp3_bytes = await _synthesize_edge(text)
        audio_b64 = base64.b64encode(mp3_bytes).decode("utf-8")
    else:
        # F5-TTS: voice cloning, lento en CPU
        if not model_ready:
            raise HTTPException(status_code=503, detail="Modelo F5-TTS aun cargando.")
        async with _tts_lock:
            loop = asyncio.get_event_loop()
            wav_bytes = await loop.run_in_executor(None, _synthesize, text, voice, speed)
        ogg_bytes = await asyncio.get_event_loop().run_in_executor(None, _wav_to_ogg, wav_bytes)
        audio_b64 = base64.b64encode(ogg_bytes).decode("utf-8")

    return JSONResponse({"audioContent": audio_b64, "timepoints": []})


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
