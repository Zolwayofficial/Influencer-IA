"""
Alibaba Spider — Búsqueda de productos en Alibaba.com (precios mayoristas).
Adaptado de agente-buscador-y-comprador/agents/hunter/hunter/spiders/alibaba_spider.py
Uso: buscar precio FOB de proveedor para calcular importación.
"""

import re
import logging
from parsel import Selector
from .base_spider import fetch

log = logging.getLogger("hunter.alibaba")

ALIBABA_SEARCH_URL = "https://www.alibaba.com/trade/search"


async def search_alibaba(query: str, limit: int = 5) -> list:
    """Busca productos en Alibaba.com."""
    try:
        html = await fetch(
            ALIBABA_SEARCH_URL,
            params={"SearchText": query, "language": "es"},
            referer="https://www.alibaba.com/",
        )
        sel     = Selector(text=html)
        results = _parse_results(sel)
        log.info(f"Alibaba: {len(results)} resultados para '{query}'")
        return results[:limit]
    except Exception as exc:
        log.error(f"Alibaba error para '{query}': {exc}")
        return []


def _parse_results(sel: Selector) -> list:
    results = []
    cards   = sel.css("div.organic-list-item, div.J-offer-wrapper")

    for card in cards:
        title    = card.css("h2.offer-title::text, a.title::text").get("").strip()
        price    = card.css("div.price-range::text, span.price::text").get("").strip()
        moq      = card.css("div.moq::text, span.unit::text").get("").strip()
        image    = card.css("img::attr(src)").get()
        url      = card.css("a.title::attr(href), a::attr(href)").get()

        if not title:
            continue

        if url and url.startswith("//"):
            url = "https:" + url

        price_usd = _parse_price_usd(price)

        features = []
        if moq:    features.append(f"MOQ: {moq}")
        if price:  features.append(f"Precio FOB: {price}")

        results.append({
            "name":      title,
            "price":     price or "Consultar",
            "price_usd": price_usd,
            "weight_kg": None,
            "image":     image,
            "features":  features,
            "rating":    None,
            "store":     "alibaba",
            "url":       url or "https://www.alibaba.com",
            "found":     True,
        })

    return results


def _parse_price_usd(price_str: str) -> float | None:
    if not price_str:
        return None
    nums = re.findall(r"[\d.]+", price_str.replace(",", ""))
    if nums:
        try:
            return float(nums[0])
        except ValueError:
            pass
    return None
