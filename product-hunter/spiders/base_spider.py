"""
Base Spider — cliente HTTP compartido con anti-detección básica.
Adaptado de agente-buscador-y-comprador/shared/browser/stealth_browser.py
"""

import httpx
import random

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
]

TIMEOUT = 15.0


def _get_headers(referer: str = "") -> dict:
    return {
        "User-Agent":      random.choice(USER_AGENTS),
        "Accept-Language": "es-PE,es;q=0.9,en;q=0.8",
        "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer":         referer,
    }


async def fetch(url: str, params: dict = None, referer: str = "") -> str:
    """GET asíncrono con headers anti-detección."""
    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
        resp = await client.get(url, params=params, headers=_get_headers(referer))
        resp.raise_for_status()
        return resp.text
