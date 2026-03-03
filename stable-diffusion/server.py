"""
Stable Diffusion Background Generator — Influencer 3D Powerhouse
Genera fondos AI para el stream de forma asincrona (no tiempo real).

Modelo: runwayml/stable-diffusion-v1-5 (CPU, ~4GB RAM, ~60-120s/imagen)
Estrategia: pre-genera N backgrounds al arrancar, luego uno nuevo cada X horas.
Los fondos se guardan en /app/backgrounds/ y se sirven via nginx.

Endpoints:
  GET  /health         — Estado del servicio
  GET  /backgrounds    — Lista de fondos generados
  POST /generate       — Solicitar generacion manual (encola, no bloquea)
"""

import asyncio
import json
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s [SD] %(message)s")
log = logging.getLogger("sd")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
MODEL_ID         = os.environ.get("SD_MODEL", "runwayml/stable-diffusion-v1-5")
BG_DIR           = Path(os.environ.get("BG_DIR", "/app/backgrounds"))
MODELS_DIR       = Path(os.environ.get("MODELS_DIR", "/app/models"))
STARTUP_COUNT    = int(os.environ.get("STARTUP_COUNT", "5"))   # fondos al inicio
REGEN_INTERVAL   = int(os.environ.get("REGEN_HOURS", "4")) * 3600  # nuevo fondo cada 4h
INFERENCE_STEPS  = int(os.environ.get("INFERENCE_STEPS", "20"))    # CPU: 20 pasos

# Prompts tematicos para influencer de importacion
PROMPTS = [
    "futuristic technology product showcase studio, neon blue and purple ambient lighting, dark background, cinematic, 8k",
    "modern minimalist tech studio background, gradient purple to dark blue, professional product display, clean aesthetic",
    "cyberpunk import products backdrop, holographic elements, neon glow, dark atmosphere, high tech showroom",
    "sleek e-commerce product studio, warm golden accent lights, dark elegant background, luxury feel, professional",
    "digital marketplace background, floating product cards, neon accents, deep space aesthetic, futuristic retail",
    "asian import warehouse converted studio, industrial chic, neon signs, product spotlight, dramatic lighting",
    "tech product launch background, abstract geometric shapes, gradient blue black, modern corporate aesthetic",
    "influencer live stream background, ring light glow, purple blue gradient, professional setup, cinematic",
]

NEGATIVE_PROMPT = (
    "text, watermark, logo, ugly, blurry, low quality, people, faces, hands, "
    "oversaturated, cartoon, anime, painting"
)

# ---------------------------------------------------------------------------
# Estado global
# ---------------------------------------------------------------------------
pipeline     = None
model_ready  = False
model_error  = None
gen_queue    = asyncio.Queue()   # cola de generacion


def _load_pipeline():
    """Carga el pipeline SD. Descarga ~4GB la primera vez."""
    global pipeline, model_ready, model_error
    try:
        from diffusers import StableDiffusionPipeline
        import torch

        log.info(f"Cargando modelo {MODEL_ID} en CPU... (primera vez ~4GB de descarga)")
        pipe = StableDiffusionPipeline.from_pretrained(
            MODEL_ID,
            torch_dtype=torch.float32,   # CPU requiere float32
            safety_checker=None,         # desactivar para fondos generales
            requires_safety_checker=False,
            cache_dir=str(MODELS_DIR),
        )
        pipe = pipe.to("cpu")

        # Optimizaciones CPU
        pipe.enable_attention_slicing()

        pipeline    = pipe
        model_ready = True
        log.info("Modelo SD cargado y listo.")

    except Exception as exc:
        model_error = str(exc)
        log.error(f"Error cargando modelo SD: {exc}")


def _generate_image(prompt: str, output_path: Path) -> bool:
    """Genera una imagen y la guarda. Retorna True si tuvo exito."""
    if not model_ready:
        return False
    try:
        import torch
        t0 = time.perf_counter()
        log.info(f"Generando fondo: '{prompt[:60]}...'")

        with torch.no_grad():
            result = pipeline(
                prompt=prompt,
                negative_prompt=NEGATIVE_PROMPT,
                width=768,
                height=432,        # 16:9 para streaming
                num_inference_steps=INFERENCE_STEPS,
                guidance_scale=7.5,
            )

        img = result.images[0]
        img.save(output_path, "JPEG", quality=92)
        elapsed = time.perf_counter() - t0
        log.info(f"Fondo generado en {elapsed:.0f}s → {output_path.name}")
        return True

    except Exception as exc:
        log.error(f"Error generando imagen: {exc}")
        return False


def _update_list_json():
    """Actualiza backgrounds/list.json con los fondos disponibles."""
    images = sorted(BG_DIR.glob("*.jpg"), key=lambda p: p.stat().st_mtime)
    urls   = [f"/backgrounds/{p.name}" for p in images]
    (BG_DIR / "list.json").write_text(json.dumps({"backgrounds": urls}, indent=2))
    log.info(f"list.json actualizado: {len(urls)} fondos disponibles")


async def _generation_worker():
    """Worker que procesa la cola de generacion uno a la vez."""
    prompt_cycle = iter(PROMPTS * 100)  # ciclo infinito de prompts

    # Generar fondos iniciales al arrancar
    for _ in range(STARTUP_COUNT):
        prompt = next(prompt_cycle)
        fname  = BG_DIR / f"bg_{uuid.uuid4().hex[:8]}.jpg"
        loop   = asyncio.get_event_loop()
        ok     = await loop.run_in_executor(None, _generate_image, prompt, fname)
        if ok:
            _update_list_json()

    # Bucle: generar un nuevo fondo cada REGEN_INTERVAL segundos
    while True:
        await asyncio.sleep(REGEN_INTERVAL)
        prompt = next(prompt_cycle)
        fname  = BG_DIR / f"bg_{uuid.uuid4().hex[:8]}.jpg"
        loop   = asyncio.get_event_loop()
        ok     = await loop.run_in_executor(None, _generate_image, prompt, fname)
        if ok:
            # Mantener solo los ultimos 10 fondos
            _cleanup_old(max_keep=10)
            _update_list_json()


def _cleanup_old(max_keep: int = 10):
    """Elimina los fondos mas antiguos si hay mas de max_keep."""
    images = sorted(BG_DIR.glob("*.jpg"), key=lambda p: p.stat().st_mtime)
    for old in images[:-max_keep]:
        old.unlink(missing_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    BG_DIR.mkdir(parents=True, exist_ok=True)

    # Cargar modelo en thread (no bloquea el server)
    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, _load_pipeline)

    # Esperar a que el modelo cargue, luego arrancar el worker de generacion
    async def _wait_and_start():
        while not model_ready and not model_error:
            await asyncio.sleep(5)
        if model_ready:
            await _generation_worker()

    asyncio.create_task(_wait_and_start())
    yield


app = FastAPI(title="Stable Diffusion BG", version="1.0.0", lifespan=lifespan)


@app.get("/health")
async def health():
    images = list(BG_DIR.glob("*.jpg"))
    return JSONResponse({
        "status":        "ok" if model_ready else ("error" if model_error else "loading"),
        "model_ready":   model_ready,
        "model_error":   model_error,
        "model":         MODEL_ID,
        "backgrounds":   len(images),
        "inference_steps": INFERENCE_STEPS,
    })


@app.get("/backgrounds")
async def backgrounds():
    images = sorted(BG_DIR.glob("*.jpg"), key=lambda p: p.stat().st_mtime)
    return JSONResponse({
        "backgrounds": [f"/backgrounds/{p.name}" for p in images],
        "count":       len(images),
    })


@app.post("/generate")
async def generate_manual():
    """Dispara la generacion de un fondo extra (manual, para testing)."""
    if not model_ready:
        return JSONResponse({"status": "model_not_ready"}, status_code=503)

    import random
    prompt = random.choice(PROMPTS)
    fname  = BG_DIR / f"bg_{uuid.uuid4().hex[:8]}.jpg"

    async def _bg_gen():
        loop = asyncio.get_event_loop()
        ok = await loop.run_in_executor(None, _generate_image, prompt, fname)
        if ok:
            _update_list_json()

    asyncio.create_task(_bg_gen())
    return JSONResponse({"status": "queued", "prompt": prompt[:60]})
