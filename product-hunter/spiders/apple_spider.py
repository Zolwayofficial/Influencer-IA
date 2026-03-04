"""
Apple Spider — Scraping de precios Apple.com
Soporta: iPhone, iPad, MacBook, AirPods, Apple Watch, Mac Mini, iMac

Nota: Apple.com no tiene Cloudflare agresivo, httpx es suficiente.
"""

import re
import logging
from parsel import Selector
from .base_spider import fetch

log = logging.getLogger("hunter.apple")

# Apple store Perú / Chile / EEUU
APPLE_STORES = {
    "pe": "https://www.apple.com/pe",
    "cl": "https://www.apple.com/cl",
    "us": "https://www.apple.com",
}

PRODUCT_URLS = {
    "iphone":      "/shop/buy-iphone",
    "ipad":        "/shop/buy-ipad",
    "macbook":     "/shop/buy-mac/macbook",
    "mac mini":    "/shop/buy-mac/mac-mini",
    "imac":        "/shop/buy-mac/imac",
    "airpods":     "/shop/buy-airpods",
    "apple watch": "/shop/buy-watch",
}


async def search_apple(query: str, limit: int = 5) -> list:
    """
    Busca un producto Apple y retorna una lista de resultados con precio.
    Prioriza tienda Perú, fallback a Chile, fallback a EEUU.
    """
    q = query.lower()

    # Identificar URL de categoría
    category_path = None
    for keyword, path in PRODUCT_URLS.items():
        if keyword in q:
            category_path = path
            break

    results = []

    for region, base in APPLE_STORES.items():
        if category_path:
            url = base + category_path
        else:
            # Búsqueda genérica: usar página de búsqueda de Apple (limitada)
            url = f"{base}/search/{query.replace(' ', '+')}"

        try:
            html = await fetch(url, referer=base + "/")
            sel  = Selector(text=html)
            items = _parse_apple_page(sel, base, region)
            if items:
                results.extend(items[:limit])
                log.info(f"Apple {region}: {len(items)} resultados para '{query}'")
                break  # con Perú es suficiente
        except Exception as exc:
            log.warning(f"Apple {region} falló: {exc}")
            continue

    # Deduplicar por nombre
    seen = set()
    unique = []
    for r in results:
        key = r.get("name", "")[:40]
        if key not in seen:
            seen.add(key)
            unique.append(r)

    return unique[:limit]


def _parse_apple_page(sel: Selector, base: str, region: str) -> list:
    """Extrae productos de una página de categoría Apple."""
    results = []

    # Selector para tarjetas de producto en apple.com
    cards = sel.css("div.rf-serp-productcard, div.as-productcard-content, li.rf-personcol, div[data-autom='product-grid-item']")

    for card in cards:
        name  = card.css("h3.rf-serp-productname::text, h2.as-productcard-productname::text, *[data-autom='sku-title']::text").get()
        price = card.css("span.rf-serp-productstartingprice::text, div.as-productcard-price::text, span[data-autom='product-price']::text").get()
        url   = card.css("a::attr(href)").get()

        if not name:
            continue

        name  = name.strip()
        price = price.strip() if price else None
        url   = (base + url) if (url and url.startswith("/")) else url

        price_usd = _extract_price_usd(price, region)

        results.append({
            "name":       name,
            "price":      price or "Ver en Apple",
            "price_usd":  price_usd,
            "weight_kg":  _estimate_weight(name),
            "image":      None,
            "features":   [f"Oficial Apple {region.upper()}", "Garantía Apple"],
            "rating":     None,
            "store":      "apple",
            "url":        url or base,
            "found":      True,
        })

    return results


def _extract_price_usd(price_str: str, region: str) -> float | None:
    """Extrae el valor numérico del precio y lo convierte a USD aproximado."""
    if not price_str:
        return None
    nums = re.findall(r"[\d,.]+", price_str.replace(",", ""))
    if not nums:
        return None
    try:
        val = float(nums[0].replace(",", ""))
        # Conversiones aproximadas
        if region == "pe":   return round(val / 3.80, 2)   # PEN → USD
        if region == "cl":   return round(val / 950.0, 2)  # CLP → USD
        return val  # USD directo
    except ValueError:
        return None


def _estimate_weight(name: str) -> float:
    """Peso aproximado en kg según el producto."""
    n = name.lower()
    if "macbook pro 16" in n: return 2.2
    if "macbook pro 14" in n: return 1.6
    if "macbook air"    in n: return 1.2
    if "imac"           in n: return 4.5
    if "mac mini"       in n: return 0.7
    if "ipad pro"       in n: return 0.7
    if "ipad"           in n: return 0.5
    if "iphone"         in n: return 0.2
    if "apple watch"    in n: return 0.1
    if "airpods"        in n: return 0.05
    return 0.5
