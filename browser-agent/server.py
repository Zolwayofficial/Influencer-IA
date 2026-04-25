"""
browser-agent — Control autónomo de navegador
Puerto 5002

Modos:
  One-shot: /screenshot /navigate /extract  (cada llamada abre y cierra su propia página)
  Session:  /session/start /session/key /session/screenshot /session/end
            (una página persistente — ideal para presentaciones)
"""

import asyncio
import base64
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from playwright.async_api import async_playwright, Browser, Page

logging.basicConfig(level=logging.INFO, format="%(asctime)s [browser-agent] %(message)s")
log = logging.getLogger("browser_agent")

PORT     = int(os.environ.get("PORT", "5002"))
HEADLESS = os.environ.get("HEADLESS", "true").lower() != "false"
UA       = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36"

_playwright  = None
_browser: Browser | None = None
_session_page: Page | None = None
_oneshot_lock = asyncio.Lock()
_session_lock = asyncio.Lock()


async def _get_browser() -> Browser:
    global _playwright, _browser
    if _browser is None or not _browser.is_connected():
        if _playwright is None:
            _playwright = await async_playwright().start()
        _browser = await _playwright.chromium.launch(
            headless=HEADLESS,
            args=["--no-sandbox", "--disable-setuid-sandbox",
                  "--disable-dev-shm-usage", "--disable-gpu"],
        )
        log.info(f"Chromium lanzado (headless={HEADLESS})")
    return _browser


async def _page_screenshot(page: Page, jpeg: bool = False) -> str:
    await page.wait_for_timeout(800)
    if jpeg:
        data = await page.screenshot(full_page=False, type="jpeg", quality=80)
        return "data:image/jpeg;base64," + base64.b64encode(data).decode()
    png = await page.screenshot(full_page=False)
    return "data:image/png;base64," + base64.b64encode(png).decode()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await _get_browser()
    yield
    global _browser, _playwright, _session_page
    if _session_page:
        try: await _session_page.close()
        except Exception: pass
    if _browser:
        await _browser.close()
    if _playwright:
        await _playwright.stop()


app = FastAPI(title="browser-agent", version="2.0.0", lifespan=lifespan)


# ─────────────────────────────────────────────────────────
# ONE-SHOT
# ─────────────────────────────────────────────────────────

@app.post("/screenshot")
async def screenshot(body: dict):
    url = body.get("url")
    if not url:
        raise HTTPException(400, "Campo 'url' requerido.")
    async with _oneshot_lock:
        browser = await _get_browser()
        page = await browser.new_page(viewport={"width": 1280, "height": 720}, user_agent=UA)
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=20_000)
            title = await page.title()
            img   = await _page_screenshot(page)
            log.info(f"screenshot: {url} → '{title}'")
            return JSONResponse({"image": img, "title": title, "url": url})
        except Exception as e:
            log.error(f"Error screenshot {url}: {e}")
            raise HTTPException(500, str(e))
        finally:
            await page.close()


@app.post("/navigate")
async def navigate(body: dict):
    url = body.get("url")
    if not url:
        raise HTTPException(400, "Campo 'url' requerido.")
    async with _oneshot_lock:
        browser = await _get_browser()
        page = await browser.new_page(viewport={"width": 1280, "height": 720}, user_agent=UA)
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=20_000)
            title = await page.title()
            text  = " ".join((await page.inner_text("body")).split())[:2000]
            img   = await _page_screenshot(page)
            return JSONResponse({"image": img, "title": title, "text": text, "url": url})
        except Exception as e:
            raise HTTPException(500, str(e))
        finally:
            await page.close()


@app.post("/extract")
async def extract(body: dict):
    url      = body.get("url")
    selector = body.get("selector", "body")
    if not url:
        raise HTTPException(400, "Campo 'url' requerido.")
    async with _oneshot_lock:
        browser = await _get_browser()
        page = await browser.new_page(user_agent=UA)
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=20_000)
            text  = " ".join((await page.inner_text(selector)).split())[:3000]
            title = await page.title()
            return JSONResponse({"text": text, "title": title, "url": url})
        except Exception as e:
            raise HTTPException(500, str(e))
        finally:
            await page.close()


# ─────────────────────────────────────────────────────────
# SESSION — página persistente para presentaciones
# ─────────────────────────────────────────────────────────

@app.post("/session/start")
async def session_start(body: dict):
    global _session_page
    url = body.get("url")
    if not url:
        raise HTTPException(400, "Campo 'url' requerido.")
    async with _session_lock:
        browser = await _get_browser()
        if _session_page:
            try: await _session_page.close()
            except Exception: pass
        _session_page = await browser.new_page(
            viewport={"width": 1280, "height": 720}, user_agent=UA
        )
        try:
            await _session_page.goto(url, wait_until="domcontentloaded", timeout=60_000)
            # If Canva redirected us to an edit URL (requires login), switch to view URL
            final_url = _session_page.url
            if "canva.com" in final_url and "/edit" in final_url:
                view_url = final_url.split("/edit")[0] + "/view"
                log.info(f"session/start: Canva edit URL detectada, redirigiendo a view: {view_url}")
                await _session_page.goto(view_url, wait_until="domcontentloaded", timeout=60_000)
            # Wait for Canva presentation to fully render
            await _session_page.wait_for_timeout(3000)
            title = await _session_page.title()
            img   = await _page_screenshot(_session_page, jpeg=True)
            log.info(f"session/start: {url} → '{title}' (final: {_session_page.url})")
            return JSONResponse({"image": img, "title": title, "url": _session_page.url, "active": True})
        except Exception as e:
            log.error(f"Error session/start: {e}")
            raise HTTPException(500, str(e))


@app.post("/session/key")
async def session_key(body: dict):
    global _session_page
    key = body.get("key", "ArrowRight")
    if not _session_page:
        raise HTTPException(400, "No hay sesión activa. Llama /session/start primero.")
    async with _session_lock:
        try:
            await _session_page.keyboard.press(key)
            img   = await _page_screenshot(_session_page, jpeg=True)
            title = await _session_page.title()
            log.info(f"session/key: '{key}'")
            return JSONResponse({"image": img, "title": title, "key": key})
        except Exception as e:
            raise HTTPException(500, str(e))


@app.post("/session/screenshot")
async def session_screenshot_endpoint():
    global _session_page
    if not _session_page:
        raise HTTPException(400, "No hay sesión activa.")
    async with _session_lock:
        img   = await _page_screenshot(_session_page)
        title = await _session_page.title()
        return JSONResponse({"image": img, "title": title})


@app.post("/session/click")
async def session_click(body: dict):
    global _session_page
    if not _session_page:
        raise HTTPException(400, "No hay sesión activa.")
    async with _session_lock:
        try:
            selector = body.get("selector")
            if selector:
                await _session_page.click(selector, timeout=5000)
            else:
                await _session_page.mouse.click(body.get("x", 640), body.get("y", 360))
            img = await _page_screenshot(_session_page)
            return JSONResponse({"image": img})
        except Exception as e:
            raise HTTPException(500, str(e))


@app.post("/session/end")
async def session_end():
    global _session_page
    async with _session_lock:
        if _session_page:
            try: await _session_page.close()
            except Exception: pass
            _session_page = None
        log.info("session/end: cerrada")
        return JSONResponse({"active": False})


# ─────────────────────────────────────────────────────────
# STATUS / HEALTH
# ─────────────────────────────────────────────────────────

@app.get("/status")
async def status():
    return JSONResponse({
        "browser_connected": _browser is not None and _browser.is_connected(),
        "session_active": _session_page is not None,
        "headless": HEADLESS,
    })


@app.get("/health")
async def health():
    connected = _browser is not None and _browser.is_connected()
    return JSONResponse({"status": "ok" if connected else "starting", "browser": connected})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
