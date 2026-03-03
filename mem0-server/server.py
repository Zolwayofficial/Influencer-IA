"""
Mem0 Server — Influencer 3D Powerhouse
Memoria persistente e ilimitada para el agente OpenClaw.

Tecnologia:
  - Mem0 (Apache 2.0): capa de memoria para agentes IA
  - Qdrant: vector store (ya existe en el stack)
  - sentence-transformers/all-MiniLM-L6-v2: embeddings (~90MB, 100% local)

Endpoints:
  POST /memories/add      — Guardar un recuerdo
  POST /memories/search   — Buscar recuerdos relevantes
  GET  /memories/{uid}    — Listar todos los recuerdos de un usuario
  DELETE /memories/{mid}  — Eliminar un recuerdo especifico
  DELETE /memories/user/{uid} — Borrar TODOS los recuerdos de un usuario
  GET  /health            — Estado del servicio
"""

import logging
import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s [Mem0] %(message)s")
log = logging.getLogger("mem0server")

# ---------------------------------------------------------------------------
# Config desde entorno
# ---------------------------------------------------------------------------
QDRANT_HOST    = os.environ.get("QDRANT_HOST",    "qdrant")
QDRANT_PORT    = int(os.environ.get("QDRANT_PORT", "6333"))
COLLECTION     = os.environ.get("MEM0_COLLECTION", "influencer_mem0")
DEFAULT_USER   = os.environ.get("DEFAULT_USER",    "influencer")
EMBED_MODEL    = os.environ.get("EMBED_MODEL",     "all-MiniLM-L6-v2")
GROQ_API_KEY   = os.environ.get("GROQ_API_KEY",    "")

# ---------------------------------------------------------------------------
# Estado global
# ---------------------------------------------------------------------------
mem0_client = None
mem0_ready  = False
mem0_error  = None


def _init_mem0():
    global mem0_client, mem0_ready, mem0_error
    try:
        from mem0 import Memory

        config = {
            "llm": {
                "provider": "groq",
                "config": {
                    "model":   "llama-3.1-8b-instant",
                    "api_key": GROQ_API_KEY,
                },
            },
            "vector_store": {
                "provider": "qdrant",
                "config": {
                    "host":            QDRANT_HOST,
                    "port":            QDRANT_PORT,
                    "collection_name": COLLECTION,
                    "embedding_model_dims": 384,  # all-MiniLM-L6-v2
                },
            },
            "embedder": {
                "provider": "huggingface",
                "config": {
                    "model": EMBED_MODEL,
                },
            },
            # Historial local en SQLite (ligero, no necesita PostgreSQL)
            "history_db_path": "/app/data/mem0_history.db",
        }

        log.info(f"Inicializando Mem0 → Qdrant {QDRANT_HOST}:{QDRANT_PORT} coleccion='{COLLECTION}'")
        log.info(f"Embedder: {EMBED_MODEL} (descarga ~90MB la primera vez)")

        mem0_client = Memory.from_config(config)
        mem0_ready  = True
        log.info("Mem0 listo. Memoria persistente activada.")

    except Exception as exc:
        mem0_error = str(exc)
        log.error(f"Error inicializando Mem0: {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, _init_mem0)
    yield


app = FastAPI(title="Mem0 Server", version="1.0.0", lifespan=lifespan)


def _require_ready():
    if not mem0_ready:
        detail = f"Mem0 cargando: {mem0_error}" if mem0_error else "Mem0 cargando, intenta en unos segundos."
        raise HTTPException(status_code=503, detail=detail)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class AddRequest(BaseModel):
    text: str
    user_id: str = DEFAULT_USER
    metadata: dict[str, Any] = {}


class SearchRequest(BaseModel):
    query: str
    user_id: str = DEFAULT_USER
    limit: int = 5


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.post("/memories/add")
async def add_memory(req: AddRequest):
    """
    Guarda un recuerdo para el usuario.
    Mem0 deduplica automaticamente y merge recuerdos similares.
    """
    _require_ready()
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="'text' no puede estar vacio.")

    try:
        result = mem0_client.add(
            req.text,
            user_id=req.user_id,
            metadata=req.metadata,
        )
        log.info(f"Memoria guardada: user={req.user_id} text='{req.text[:60]}'")
        return JSONResponse({"status": "ok", "result": result})
    except Exception as exc:
        log.error(f"Error guardando memoria: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/memories/search")
async def search_memories(req: SearchRequest):
    """
    Busca recuerdos relevantes para la query dada.
    Retorna lista de {memory, score, id, metadata}.
    """
    _require_ready()
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="'query' no puede estar vacio.")

    try:
        results = mem0_client.search(
            req.query,
            user_id=req.user_id,
            limit=req.limit,
        )
        # Normalizar formato (Mem0 puede retornar dicts o objetos)
        memories = []
        for r in results:
            if isinstance(r, dict):
                memories.append(r)
            else:
                memories.append({"memory": str(r), "score": 1.0})

        log.info(f"Busqueda: user={req.user_id} query='{req.query[:40]}' → {len(memories)} resultados")
        return JSONResponse({"memories": memories})
    except Exception as exc:
        log.error(f"Error buscando memorias: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/memories/{user_id}")
async def get_all_memories(user_id: str):
    """Lista todos los recuerdos de un usuario."""
    _require_ready()
    try:
        all_mems = mem0_client.get_all(user_id=user_id)
        return JSONResponse({"user_id": user_id, "count": len(all_mems), "memories": all_mems})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.delete("/memories/{memory_id}")
async def delete_memory(memory_id: str):
    """Elimina un recuerdo especifico por ID."""
    _require_ready()
    try:
        mem0_client.delete(memory_id)
        return JSONResponse({"status": "deleted", "id": memory_id})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.delete("/memories/user/{user_id}")
async def delete_user_memories(user_id: str):
    """Borra TODOS los recuerdos de un usuario. Usar con cuidado."""
    _require_ready()
    try:
        mem0_client.delete_all(user_id=user_id)
        log.warning(f"Borradas TODAS las memorias de user={user_id}")
        return JSONResponse({"status": "deleted_all", "user_id": user_id})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/health")
async def health():
    return JSONResponse({
        "status":     "ok" if mem0_ready else ("error" if mem0_error else "loading"),
        "mem0_ready": mem0_ready,
        "mem0_error": mem0_error,
        "qdrant":     f"{QDRANT_HOST}:{QDRANT_PORT}",
        "collection": COLLECTION,
        "embedder":   EMBED_MODEL,
    })
