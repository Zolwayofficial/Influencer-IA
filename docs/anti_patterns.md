# Anti-Patterns

Catálogo vivo de errores y casi-fallas detectadas en el proyecto. Cada IA que opere bajo FactorIA debe leer este archivo antes de cualquier tarea Full y nunca repetir un anti-patrón documentado aquí.

Estado: active
Última actualización: 2026-05-05

## Como Funciona

Cuando una IA comete un error, o cuando el humano detecta un patrón malo en una sugerencia de IA, se agrega aquí. La próxima IA que lea este archivo no debe proponer la misma cosa, aunque "suene razonable".

## Catálogo

### AP-001 — CSS identity filters sobre WebGL canvas

- Categoría: arquitectura / performance
- Qué se hizo mal: Se usaron `filter: brightness(1.0) saturate(1.0)` en `#avatar.emotion-neutral`. Chrome optimiza filtros de valor identidad (1.0) como si fueran `filter: none`, lo que hace que el canvas WebGL de Three.js quede en un hardware MPO overlay plane. TikTok Live Studio (que usa BitBlt para captura) no puede capturar MPO planes → frame negro en el stream.
- Por qué está mal aquí: El avatar DEBE ser capturado por TikTok Live Studio. Cualquier optimización que mueva el canvas a un MPO layer rompe la captura.
- Cómo evitarlo:
  - Base `#avatar`: usar `filter: contrast(1.0001)` (valor sub-perceptual, no optimizable por Chrome).
  - Todas las clases emotion: agregar `contrast(1.0001)` al final de cada filtro.
  - NUNCA usar valores exactamente 1.0 en `brightness()` o `saturate()` solos sobre canvases WebGL.
- Detectado: 2026-04-25
- Tarea relacionada: fix avatar WebGL congelado en TikTok

---

### AP-002 — `<video>` para screen share proxy

- Categoría: arquitectura
- Qué se hizo mal: Se usó `<video id="screen-video">` como proxy del stream de pantalla compartida. El elemento `<video>` con contenido de screen capture usa MPO (hardware overlay) en Chrome → TikTok Studio no puede capturarlo.
- Por qué está mal aquí: Mismo problema que AP-001: TikTok Live Studio no puede capturar MPO planes.
- Cómo evitarlo: Usar siempre `<canvas id="screen-canvas">` para proxying de pantalla. Canvas nunca usa hardware overlay planes. Ver `avatar-frontend/dist/index.html`.
- Detectado: 2026-04-20 (commit 47bc7de)
- Tarea relacionada: screen share canvas proxy fix

---

### AP-003 — `opacity: 0` en video/canvas proxy

- Categoría: performance / arquitectura
- Qué se hizo mal: Se intentó ocultar el elemento proxy con `opacity: 0`. Chrome omite el decode del video cuando opacity es 0, dejando el proxy en blanco.
- Por qué está mal aquí: El proxy invisible necesita estar activo (decodificando) para que el canvas mirror funcione.
- Cómo evitarlo: Usar posicionamiento off-screen (`position: absolute; left: -9999px`) en vez de `opacity: 0`. El elemento existe en el DOM, decodifica, pero no es visible al usuario.
- Detectado: 2026-04-20
- Tarea relacionada: screen share canvas proxy fix

---

### AP-004 — edge-tts en VPS Contabo ⚠️ ESTADO CONTRADICTORIO — VERIFICAR

- Categoría: stack
- Qué se hizo mal: Se intentó usar edge-tts como motor TTS. Está bloqueado en el VPS Contabo (probablemente por bloqueo de Microsoft a IPs de datacenter).
- Por qué está mal aquí: El VPS no puede conectar a los endpoints de edge-tts → silencio total en el stream.
- Contradicción conocida: docker-compose.yml línea 459 muestra `TTS_ENGINE: "edge"` como configuración activa. Puede significar que (a) el compose fue escrito/actualizado después del incidente y edge-tts ya no está bloqueado en este VPS, (b) el compose es aspiracional y aún falla en runtime, o (c) el bloqueo fue intermitente. **No resolver esta contradicción hasta verificar en VPS con `curl http://localhost:8882/tts -d '{"text":"test"}'` o revisando logs del container f5-tts.**
- Acción provisional: Si se necesita TTS funcional garantizado antes de verificar → usar `TTS_ENGINE: "f5"` (voice cloning lento en CPU) o arrancar brain compose con HeadTTS Kokoro.
- Detectado: 2026-04-20
- Contradicción documentada: 2026-05-05 (al leer docker-compose.yml)
- Tarea relacionada: TTS engine switch

---

### AP-005 — ssh/scp estándar desde Windows hacia el VPS

- Categoría: proceso / deploy
- Qué se hizo mal: Se intentó usar `ssh` y `scp` estándar desde Windows para conectar al VPS.
- Por qué está mal aquí: La clave `id_rsa_vps` no está en `authorized_keys` del VPS. La autenticación por clave no funciona desde el entorno Windows de desarrollo.
- Cómo evitarlo: SIEMPRE usar `plink` / `pscp` con contraseña y `-hostkey "ssh-ed25519 255 SHA256:IWp19p3PCPMAqvwZsTGP1Dfr+2iYoRtr0N+maxHm9V4"`. Ver `docs/deployment.md`.
- Detectado: sesión 2026-04-20
- Tarea relacionada: deploy workflow

---

### AP-006 — Reiniciar avatar-frontend container tras cambio de archivos

- Categoría: proceso / deploy
- Qué se hizo mal: Se ejecutó `docker restart influencer-avatar-frontend` (o equivalente) tras subir cambios a `dist/`.
- Por qué está mal aquí: El container de avatar-frontend usa bind-mount sobre el directorio `dist/`. Nginx sirve los archivos directamente del filesystem. Reiniciar el container es innecesario y agrega tiempo de downtime.
- Cómo evitarlo: Subir archivos con pscp y verificar que se reflejan inmediatamente. No reiniciar el container.
- Detectado: 2026-04-20
- Tarea relacionada: deploy workflow

---

### AP-007 — No reiniciar openclaw tras cambios en index.js o skills/

- Categoría: proceso / deploy
- Qué se hizo mal: Se editaron archivos de OpenClaw (index.js o skills/) sin reiniciar el container, asumiendo que los cambios se aplicarían en caliente.
- Por qué está mal aquí: OpenClaw es un proceso Node.js que carga los archivos al iniciar. Sin restart, los cambios no tienen efecto.
- Cómo evitarlo: SIEMPRE `docker restart influencer-openclaw` tras cualquier cambio en `openclaw/index.js` o `openclaw/skills/`.
- Detectado: sesión 2026-04-27
- Tarea relacionada: deploy workflow

## Reglas

- Nunca borres entradas. Si dejaron de aplicar, márcalas como `[OBSOLETO desde YYYY-MM-DD]` y deja la razón.
- Si un anti-patrón se vuelve regla en el stack, muévelo a `docs/stack.md` y deja un puntero aquí.
- Cierre de tarea Full debe revisar si emergió un anti-patrón nuevo. Si sí, regístralo antes de marcar `done`.

---

## Troubleshooting (TS-XXX)

Bugs raros donde el fix correcto solo se encontró tras investigación profunda. Formato distinto al AP: no "no hagas X" sino "si ves síntoma A, el diagnóstico real es B, el fix verificado es C, no pierdas tiempo en D/E/F".

### Formato

```txt
- ID: TS-XXX
- Síntoma observado: qué ve el usuario / operador
- Diagnóstico real: causa raíz verificada
- Fix verificado: qué cambio exacto resolvió el problema
- Intentos descartados: qué se probó que NO funcionó (evitar repetir)
- Costo del descubrimiento: tiempo / tokens / sesiones invertidas
- Fecha: YYYY-MM-DD
```

---

### TS-001 — Avatar WebGL congelado en TikTok Live Studio

- Síntoma observado: El avatar se ve en el browser (`avatar.virtufan.com`) pero aparece como frame estático o negro en TikTok Live Studio al capturar la ventana de Chromium.
- Diagnóstico real: CSS `#avatar.emotion-neutral { filter: brightness(1.0) saturate(1.0) }` → Chrome optimiza filtros de valor identidad (1.0) como si fueran `filter: none` → el canvas WebGL de Three.js queda en un hardware MPO (Media Presentation Overlay) plane → TikTok Live Studio usa BitBlt para captura, que no puede acceder a MPO planes.
- Fix verificado:
  - En `style.css`, `#avatar` base: agregar `filter: contrast(1.0001)` (valor sub-perceptual, no optimizable).
  - Todas las clases `.emotion-*`: agregar `contrast(1.0001)` al final de cada filtro.
  - En `index.html`: `#capture-keepalive` div con `z-index: 5`, `width: 2px`, `height: 2px`, animación CSS `@keyframes _ka` que oscila opacity entre 0.0010 y 0.0012 a 0.4s.
- Intentos descartados: `will-change: transform`, `transform: translateZ(0)`, cambiar z-index del avatar, reiniciar compositor, cambiar resolución de captura en TikTok Studio, actualizar Chromium.
- Costo del descubrimiento: ~1 sesión completa de debugging (varias horas).
- Fecha: 2026-04-25

---

### TS-002 — Screen share del avatar capturado como frame negro por TikTok Live Studio

- Síntoma observado: La pantalla compartida (Canva u otra pestaña) aparece en el browser correctamente dentro del avatar, pero TikTok Live Studio captura un frame completamente negro donde debería estar la pantalla compartida.
- Diagnóstico real: `<video id="screen-video">` con stream de `getDisplayMedia()` usa MPO (hardware overlay) en Chrome → BitBlt de TikTok Studio no puede capturar MPO planes (mismo problema raíz que TS-001 pero en el elemento de video, no en el canvas WebGL).
- Fix verificado: Reemplazar `<video id="screen-video">` por `<canvas id="screen-canvas">`. Dibujar cada frame del stream en el canvas via `requestAnimationFrame`. Canvas nunca usa hardware overlay planes.
  - Trampas del fix: `opacity: 0` en el video proxy hace que Chrome omita el decode → usar posicionamiento off-screen (`position: absolute; left: -9999px`) en su lugar.
- Intentos descartados: cambiar `z-index` del video, usar `mix-blend-mode`, cambiar la fuente de captura en TikTok Studio, usar `captureStream()` del canvas directamente.
- Costo del descubrimiento: ~1 sesión de debugging. Fix en commit 47bc7de.
- Fecha: 2026-04-20
