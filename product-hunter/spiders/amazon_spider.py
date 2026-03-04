"""
Amazon Spider — Búsqueda de productos en Amazon.com
Adaptado de agente-buscador-y-comprador/agents/hunter/hunter/spiders/amazon_spider.py
Uso: solo búsqueda de precios para el avatar influencer (no arbitraje).
"""

import re
import logging
from parsel import Selector
from .base_spider import fetch

log = logging.getLogger("hunter.amazon")

AMAZON_SEARCH_URL = "https://www.amazon.com/s"


async def search_amazon(query: str, limit: int = 5) -> list:
    """Busca productos en Amazon.com y retorna los más relevantes."""
    try:
        html = await fetch(
            AMAZON_SEARCH_URL,
            params={"k": query, "language": "es_US"},
            referer="https://www.amazon.com/",
        )
        sel     = Selector(text=html)
        results = _parse_search_results(sel)
        log.info(f"Amazon: {len(results)} resultados para '{query}'")
        return results[:limit]
    except Exception as exc:
        log.error(f"Amazon error para '{query}': {exc}")
        return []


def _parse_search_results(sel: Selector) -> list:
    results = []
    cards   = sel.css('div[data-component-type="s-search-result"]')

    for card in cards:
        asin  = card.attrib.get("data-asin", "")
        title = card.css("h2 span::text").get("").strip()
        price = card.css("span.a-price-whole::text").get()
        cents = card.css("span.a-price-fraction::text").get("00")
        image = card.css("img.s-image::attr(src)").get()
        stars = card.css("span.a-icon-alt::text").get()
        url   = f"https://www.amazon.com/dp/{asin}" if asin else None

        if not title or not asin:
            continue

        price_str = None
        price_usd = None
        if price:
            price_clean = price.replace(",", "").strip()
            price_str   = f"${price_clean}.{cents} USD"
            try:
                price_usd = float(f"{price_clean}.{cents}")
            except ValueError:
                pass

        results.append({
            "name":      title,
            "price":     price_str or "Ver en Amazon",
            "price_usd": price_usd,
            "weight_kg": None,   # Amazon no expone peso en resultados
            "image":     image,
            "features":  [],
            "rating":    stars,
            "store":     "amazon",
            "url":       url,
            "found":     True,
        })

    return results
