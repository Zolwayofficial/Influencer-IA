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
from playwright.async_api import async_playwright, Browser, Page, expect

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
_browser_slide = 1  # slide actual en el browser (se resetea en session/start)


async def _get_browser() -> Browser:
    global _playwright, _browser
    if _browser is None or not _browser.is_connected():
        if _playwright is None:
            _playwright = await async_playwright().start()
        _browser = await _playwright.chromium.launch(
            headless=HEADLESS,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--use-angle=gl",   # WebGL via OpenGL — necesario para Canva en headless
                "--headless=new",   # headless moderno: más fiel al headed browser
            ],
        )
        log.info(f"Chromium lanzado (headless={HEADLESS})")
    return _browser


async def _page_screenshot(page: Page, jpeg: bool = False) -> str:
    await page.wait_for_timeout(800)
    if jpeg:
        data = await page.screenshot(full_page=False, type="jpeg", quality=80, timeout=60_000)
        return "data:image/jpeg;base64," + base64.b64encode(data).decode()
    png = await page.screenshot(full_page=False, timeout=60_000)
    return "data:image/png;base64," + base64.b64encode(png).decode()


async def _navigate_slide(page: Page, direction: str) -> None:
    """Avanza (next) o retrocede (prev) un slide en Canva.
    Canva carga en modo editor (sidebar con thumbnails de páginas).
    Estrategia: click en el thumbnail del slide objetivo en el sidebar.
    """
    global _browser_slide

    new_slide = _browser_slide + (1 if direction == "next" else -1)
    new_slide = max(1, new_slide)

    # Los "Page options" buttons (uno por página visible en el sidebar)
    page_btns_loc = page.locator("button[aria-label='Page options']")

    # Scroll el sidebar para revelar el thumbnail objetivo si no está visible
    # El sidebar ocupa el lado izquierdo — intentar scroll con wheel
    try:
        if direction == "next":
            await page.mouse.move(80, 540)
            await page.mouse.wheel(0, 300)
        else:
            await page.mouse.move(80, 540)
            await page.mouse.wheel(0, -300)
        await page.wait_for_timeout(300)
    except Exception:
        pass

    count = await page_btns_loc.count()
    log.info(f"_navigate_slide: {count} page thumbnails visibles, objetivo=slide {new_slide}")

    if count > 0:
        # Calcular qué índice clickear dentro de los visibles
        # El índice 0 = primera página visible en el sidebar
        # Si vamos hacia adelante: último visible; hacia atrás: primero visible
        idx = (count - 1) if direction == "next" else 0
        target_btn = page_btns_loc.nth(idx)

        try:
            # Obtener bounding box del botón "Page options" y clickear a su izquierda
            # (el thumbnail está a la izquierda del botón "...")
            box = await target_btn.bounding_box()
            if box:
                thumb_x = max(10, box["x"] - 40)  # clickear al centro del thumbnail
                thumb_y = box["y"] + box["height"] / 2
                await page.mouse.click(thumb_x, thumb_y)
                _browser_slide = new_slide
                log.info(f"_navigate_slide: thumbnail click at ({thumb_x:.0f}, {thumb_y:.0f}) → slide {new_slide}")
                return
        except Exception as e:
            log.warning(f"_navigate_slide: bounding_box click falló: {e}")

        # Fallback: click con force en el padre del botón
        try:
            parent = target_btn.locator("..")
            await parent.click(force=True)
            _browser_slide = new_slide
            log.info(f"_navigate_slide: parent click → slide {new_slide}")
            return
        except Exception as e:
            log.warning(f"_navigate_slide: parent click falló: {e}")

    # Último recurso: dispatchEvent en documento
    key     = "ArrowRight" if direction == "next" else "ArrowLeft"
    keycode = 39 if direction == "next" else 37
    await page.evaluate(f"""() => {{
        const e = new KeyboardEvent('keydown', {{
            key: '{key}', code: '{key}',
            keyCode: {keycode}, which: {keycode},
            bubbles: true
        }});
        document.dispatchEvent(e);
    }}""")
    log.info(f"_navigate_slide: dispatchEvent({key}) fallback")


async def _wait_for_slide_change(page: Page, prev_val: str | None, timeout_ms: int = 3000) -> None:
    """Espera a que div[role='slider'] cambie su aria-valuenow, con fallback a wait fijo."""
    try:
        slider = page.locator("div[role='slider']").first
        if await slider.count() == 0:
            raise Exception("no slider")
        await expect(slider).not_to_have_attribute(
            "aria-valuenow", prev_val or "", timeout=timeout_ms
        )
    except Exception:
        await page.wait_for_timeout(1500)


@asynccontextmanager
async def lifespan(_app: FastAPI):
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


app = FastAPI(title="browser-agent", version="2.1.0", lifespan=lifespan)


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
    global _session_page, _browser_slide
    _browser_slide = 1
    url = body.get("url")
    if not url:
        raise HTTPException(400, "Campo 'url' requerido.")
    async with _session_lock:
        browser = await _get_browser()
        if _session_page:
            try: await _session_page.close()
            except Exception: pass
        _session_page = await browser.new_page(
            viewport={"width": 1920, "height": 1080}, user_agent=UA
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
            # Diagnóstico: listar todos los buttons con aria-label para entender el DOM de Canva
            try:
                all_btns = await _session_page.locator("button[aria-label]").all()
                labels = [await b.get_attribute("aria-label") for b in all_btns[:20]]
                log.info(f"session/start DOM buttons: {labels}")
                all_roles = await _session_page.locator("[role='slider']").all()
                log.info(f"session/start DOM sliders: {len(all_roles)}")
            except Exception as de:
                log.info(f"session/start diagnóstico error: {de}")
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
            direction = "next" if key in ("ArrowRight", "Right") else "prev"

            # Leer slide actual antes de navegar (para verificar que cambió)
            prev_val = None
            try:
                slider = _session_page.locator("div[role='slider']").first
                if await slider.count() > 0:
                    prev_val = await slider.get_attribute("aria-valuenow")
            except Exception:
                pass

            await _navigate_slide(_session_page, direction)
            await _wait_for_slide_change(_session_page, prev_val)
            img   = await _page_screenshot(_session_page, jpeg=True)
            title = await _session_page.title()
            log.info(f"session/key: '{key}' (slide anterior: {prev_val})")
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
