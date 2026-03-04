"""
1688 Spider — Búsqueda en 1688.com (fabricantes chinos, precios CNY).
Adaptado de agente-buscador-y-comprador/agents/hunter/hunter/spiders/china_1688_spider.py
Uso: obtener precio de fábrica en CNY y convertir a USD.
"""

import re
import logging
from parsel import Selector
from .base_spider import fetch

log = logging.getLogger("hunter.1688")

SEARCH_URL = "https://s.1688.com/selloffer/offer_search.htm"
CNY_TO_USD = 0.138  # Tasa aproximada CNY → USD


async def search_1688(query: str, limit: int = 5) -> list:
    """Busca productos en 1688.com."""
    try:
        html = await fetch(
            SEARCH_URL,
            params={"keywords": query},
            referer="https://www.1688.com/",
        )
        sel     = Selector(text=html)
        results = _parse_results(sel)
        log.info(f"1688: {len(results)} resultados para '{query}'")
        return results[:limit]
    except Exception as exc:
        log.error(f"1688 error para '{query}': {exc}")
        return []


def _parse_results(sel: Selector) -> list:
    results = []
    cards   = sel.css("div.sm-offer-item, div.offer-item")

    for card in cards:
        title    = card.css("span.offer-title::text, a.title::text").get("").strip()
        price    = card.css("div.price b::text, span.price::text").get("").strip()
        image    = card.css("img::attr(src)").get()
        url      = card.css("a::attr(href)").get()
        moq      = card.css("div.moq::text").get("").strip()

        if not title:
            continue

        if url and url.startswith("//"):
            url = "https:" + url

        price_cny = _parse_price_cny(price)
        price_usd = round(price_cny * CNY_TO_USD, 2) if price_cny else None

        features = []
        if moq:       features.append(f"MOQ: {moq}")
        if price_cny: features.append(f"Precio fábrica: ¥{price_cny} CNY (~${price_usd} USD)")
        features.append("Directo de fábrica China")

        results.append({
            "name":      title,
            "price":     f"¥{price} CNY" if price else "Consultar",
            "price_usd": price_usd,
            "weight_kg": None,
            "image":     image,
            "features":  features,
            "rating":    None,
            "store":     "1688",
            "url":       url or "https://www.1688.com",
            "found":     True,
        })

    return results


def _parse_price_cny(price_str: str) -> float | None:
    if not price_str:
        return None
    nums = re.findall(r"[\d.]+", price_str.replace(",", ""))
    if nums:
        try:
            return float(nums[0])
        except ValueError:
            pass
    return None
