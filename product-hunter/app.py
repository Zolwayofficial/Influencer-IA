"""
Product Hunter — Microservicio de scraping para Influencer-IA
Puerto 5001

Endpoints:
  GET /search?q=<query>&source=<amazon|alibaba|1688|apple>&limit=5
  GET /health
"""

import logging
from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse

from spiders.amazon_spider import search_amazon
from spiders.alibaba_spider import search_alibaba
from spiders.china_1688_spider import search_1688
from spiders.apple_spider import search_apple

logging.basicConfig(level=logging.INFO, format="%(asctime)s [Hunter] %(message)s")
log = logging.getLogger("hunter")

app = FastAPI(title="Product Hunter", version="1.0.0")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/search")
async def search(
    q:      str            = Query(..., description="Termino de busqueda o URL"),
    source: str            = Query("auto", description="amazon | alibaba | 1688 | apple | auto"),
    limit:  int            = Query(5, ge=1, le=20),
):
    """
    Busca productos en la fuente indicada.
    Si source=auto, elige la fuente mas adecuada segun las keywords del query.
    """
    src = _resolve_source(q, source)
    log.info(f"Buscando '{q}' en {src} (limit={limit})")

    try:
        if src == "amazon":
            results = await search_amazon(q, limit)
        elif src == "alibaba":
            results = await search_alibaba(q, limit)
        elif src == "1688":
            results = await search_1688(q, limit)
        elif src == "apple":
            results = await search_apple(q, limit)
        else:
            results = await search_amazon(q, limit)  # fallback

        return JSONResponse({"source": src, "query": q, "results": results})

    except Exception as exc:
        log.error(f"Error buscando '{q}' en {src}: {exc}")
        return JSONResponse({"source": src, "query": q, "results": [], "error": str(exc)}, status_code=200)


def _resolve_source(query: str, source: str) -> str:
    """Detecta la fuente correcta si source='auto'."""
    if source != "auto":
        return source

    q = query.lower()
    apple_keywords = ["iphone", "ipad", "macbook", "apple watch", "airpods", "mac mini", "imac"]
    if any(kw in q for kw in apple_keywords):
        return "apple"
    if "alibaba" in q or "bulk" in q or "wholesale" in q or "moq" in q:
        return "alibaba"
    if "1688" in q or "china" in q or "proveedor" in q or "fabricante" in q:
        return "1688"
    return "amazon"  # default
