# Decision Log

Registra decisiones que no deben rediscutirse sin nueva evidencia.

## Reglas

- Una decisión por ADR.
- Las ADRs no se editan; se superan con una ADR nueva que cite la anterior como `Supersedes ADR-XXX`.
- Toda decisión técnica en código debe poder rastrearse a un ADR.
- Cada alternativa descartada lleva su **why-not** explícito.

---

## ADR-000 — Adoptar FactorIA v8

Estado: accepted
Fecha: 2026-05-05
Decisores: Billy (humano) + Claude Sonnet 4.6

### Contexto

El proyecto tenía problemas de desorden entre sesiones: errores que se repetían (AP-001 del avatar), decisiones sin registro del porqué, contexto que se perdía entre conversaciones con Claude Code.

### Decisión

Adoptar FactorIA v8 como protocolo de operación del proyecto Influencer-IA.

### Alternativas Consideradas

- Sin protocolo: Why-not: error recurrence documentado (bug WebGL MPO se podría repetir), stack drift posible al agregar dependencias.
- Solo CLAUDE.md con notas: Why-not: no tiene validador, no tiene SSOT de stack, no tiene mapa de capabilities.
- FactorIA v8: Why-yes: SSOT explícito, anti-bias, validador CLI, capability map, anti-cascade, anti-patterns catalog.

### Consecuencias

- Más docs que mantener. Compensado por menos tokens en corrección repetida y menos reinvención.
- Sesiones futuras arrancan con contexto completo leyendo 6 archivos de boot.

### Reversibilidad

Alta: los docs quedan útiles aun si se abandona el protocolo.

### Cuando Revisarla

Si en 60 días el costo de errores recurrentes no baja o el overhead de mantener docs supera el beneficio.

---

## ADR-001 — Canvas en vez de video para screen share proxy

Estado: accepted
Fecha: 2026-04-20
Decisores: Billy (humano) + Claude Sonnet (sesión 2026-04-20)

### Contexto

TikTok Live Studio captura la ventana del browser via BitBlt (GDI). Los elementos `<video>` con stream de pantalla usan MPO (hardware overlay plane) en Chrome, que BitBlt no puede capturar → frame negro en el stream.

### Decisión

Usar `<canvas id="screen-canvas">` para proxying de pantalla compartida en vez de `<video>`.

### Alternativas Consideradas

- `<video id="screen-video">`: Why-not: usa MPO hardware overlay en Chrome → TikTok Studio no puede capturarlo.
- `<canvas>`: Why-yes: canvas nunca usa hardware overlay planes; siempre queda en el compositor software que BitBlt puede capturar.

### Consecuencias

- Fix permanente para la captura en TikTok Studio.
- Canvas requiere lógica extra para dibujar cada frame del stream (requestAnimationFrame loop).

### Evidencia

Commit 47bc7de — canvas proxy funcional verificado en TikTok Live Studio.

### Reversibilidad

Baja: revertir a video rompería la captura de nuevo.

### Cuando Revisarla

Si Chrome cambia el comportamiento de compositing de canvas elements o si TikTok Studio cambia su método de captura.

---

## ADR-002 — gTTS en vez de edge-tts como motor TTS

Estado: accepted
Fecha: 2026-04-20
Decisores: Billy (humano) + Claude Sonnet (sesión 2026-04-20)

### Contexto

edge-tts estaba configurado como motor TTS original. Al desplegarlo en VPS Contabo, los requests a los endpoints de Microsoft fallaban silenciosamente (probablemente bloqueo de IPs de datacenter).

### Decisión

Cambiar a gTTS (Google TTS) como motor TTS. Configurado via `TTS_ENGINE: "gtts"` en docker-compose.yml.

### Alternativas Consideradas

- edge-tts: Why-not: bloqueado en VPS Contabo. IPs de datacenter bloqueadas por Microsoft.
- Kokoro / HeadTTS: en el momento se asumió incorrectamente que requería GPU. El VPS tiene 64GB RAM y HeadTTS solo requiere 4GB/2vCPU — es viable. HeadTTS ya está en el repo (`headtts/`). Pendiente de activar.
- gTTS: Why-yes: fix rápido funcional mientras se evalúa activar HeadTTS.

### Consecuencias

- Voz con acento Google (no natural). Aceptable para MVP.
- **Deuda técnica activa**: migrar a Kokoro/HeadTTS — el VPS ya lo soporta, el código ya está. Solo falta configurar y activar.

### Reversibilidad

Alta: cambiar `TTS_ENGINE` en docker-compose.yml y reiniciar.

### Cuando Revisarla

Si se amplía el VPS a ≥16GB RAM con GPU, evaluar Kokoro/HeadTTS para voz más natural.

---

## ADR-003 — plink/pscp en vez de ssh/scp estándar para deploy desde Windows

Estado: accepted
Fecha: 2026-04-20
Decisores: Billy (humano) + Claude Sonnet (sesión 2026-04-20)

### Contexto

El entorno de desarrollo es Windows. La clave `id_rsa_vps` no está en `authorized_keys` del VPS Contabo. La autenticación por clave SSH estándar no funciona desde el entorno Windows local.

### Decisión

Usar siempre `plink` (SSH) y `pscp` (SCP) de PuTTY con autenticación por contraseña y `-hostkey` explícito.

### Alternativas Consideradas

- ssh/scp estándar de Windows: Why-not: falla silenciosamente; clave no está en authorized_keys.
- Agregar clave al VPS: Why-not: no se hizo en el setup inicial; riesgo de lockout si se hace mal.
- plink/pscp con contraseña: Why-yes: funciona inmediatamente, sin cambios en el VPS.

### Consecuencias

- Deploy workflow depende de PuTTY instalado en Windows.
- Contraseña en comandos de script (riesgo menor en uso personal).

### Reversibilidad

Alta: agregar clave SSH al VPS en cualquier momento y cambiar scripts.

### Cuando Revisarla

Si se agrega la clave SSH al VPS o si se adopta un CI/CD pipeline.

---

## ADR-004 — filter: contrast(1.0001) para prevenir MPO en canvas WebGL

Estado: accepted
Fecha: 2026-04-25
Decisores: Billy (humano) + Claude Sonnet (sesión 2026-04-25)

### Contexto

Chrome optimiza filtros CSS con valores de identidad exactos (`brightness(1.0)`, `saturate(1.0)`) como si fueran `filter: none`. Esto mueve el canvas WebGL de Three.js a un hardware MPO overlay plane. TikTok Live Studio (BitBlt) no puede capturar MPO planes → avatar congelado en el stream.

### Decisión

Agregar `filter: contrast(1.0001)` como base en `#avatar` y en todas las clases de emoción en style.css. El valor es sub-perceptual pero Chrome no puede optimizarlo.

### Alternativas Consideradas

- `will-change: transform`: Why-not: no garantiza que Chrome no mueva el canvas a MPO en todas las versiones.
- `transform: translateZ(0)`: Why-not: crea stacking context pero no previene MPO en todos los casos documentados.
- `filter: contrast(1.0001)`: Why-yes: Chrome no puede optimizar un filtro con valor no-identidad; garantiza que el canvas queda en composite software layer.

### Consecuencias

- Diferencia visual imperceptible (0.01% de contraste extra).
- Fix permanente mientras Chrome no cambie su lógica de compositing.

### Evidencia

Verificado en TikTok Live Studio post-fix: avatar visible y animado en stream. Sesión 2026-04-25.

### Reversibilidad

Baja: revertir a `brightness(1.0)` solo rompería la captura de nuevo.

### Cuando Revisarla

Si Chrome publica cambios en su política de compositing de canvas elements (Chromium changelog).

---

## ADR-005 — Contradicción ADR-002 vs docker-compose.yml: estado real de TTS engine

Estado: open (pendiente verificación en VPS)
Fecha: 2026-05-05
Decisores: Claude Sonnet 4.6 (audit) — requiere confirmación de Billy
Supersedes parcialmente: ADR-002 (en lo relativo a TTS_ENGINE activo)

### Contexto

Al leer `docker-compose.yml` línea 459 directamente (forced source citation — FactorIA principio 2), se encontró:

```yaml
TTS_ENGINE: "edge"   # edge=Microsoft neural (gratis, <1s) | f5=voice cloning (lento en CPU)
```

ADR-002 documenta que se decidió usar gTTS (`TTS_ENGINE: "gtts"`) porque edge-tts estaba bloqueado en Contabo. Sin embargo el archivo de deploy real tiene `TTS_ENGINE: "edge"`. Esta contradicción no puede resolverse leyendo solo los docs — requiere verificar el estado actual en el VPS.

### Hipótesis No Verificadas

- H1: El compose fue actualizado después del incidente de AP-004 y edge-tts ya funciona en este VPS (IP diferente, fecha diferente).
- H2: El compose fue escrito aspiracionalmente con edge-tts y falla en runtime (silencio en stream).
- H3: El bloqueo de AP-004 fue intermitente o temporal.

### Decisión Provisional

No alterar el compose hasta verificar. La decisión sobre qué motor está activo en producción la tiene el operador con acceso al VPS, no el agente.

### Cómo Verificar

```bash
# En el VPS:
docker exec influencer-f5tts wget -qO- http://127.0.0.1:8882/health
docker logs influencer-f5tts --tail 50
# Si logs muestran errores de conexión a edge-tts → H2 confirmada → cambiar a "gtts" o "f5"
# Si logs muestran requests exitosos → H1 confirmada → actualizar AP-004 a OBSOLETO
```

### Alternativas Descartadas

- Asumir que gTTS es el activo sin verificar: Why-not: viola principio de forced source citation; el archivo real dice edge.
- Asumir que edge-tts funciona sin verificar: Why-not: AP-004 documenta evidencia de bloqueo en sesión real.

### Cuando Revisarla

Inmediatamente que Billy acceda al VPS y ejecute la verificación. Cerrar este ADR con evidencia del log o del health check.
