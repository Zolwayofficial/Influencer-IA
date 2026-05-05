# Task Tracker

Estados permitidos: `pending`, `in_progress`, `blocked`, `review`, `done`.

Cada tarea TIENE su propio criterio de aceptación. No se acepta "ver criterio en requirements". Cita el archivo y la sección fuente.

| ID | Estado | Tarea | Criterio De Aceptación | Fuente | Stack Tocado | Riesgo | Notas |
|---|---|---|---|---|---|---|---|
| IT-000 | done | Setup FactorIA v8 en el proyecto | Docs core llenados con contexto real; factoria-check pasa | SKILL.md#Init-Project | no | bajo | Setup inicial 2026-05-05 |

## Reglas

- Debe existir una tarea `in_progress` antes de ejecutar implementación.
- Solo UNA tarea `in_progress` activa por agente.
- Ninguna tarea pasa a `done` sin evidencia en `verification_log.md` referenciada por ID.
- Ninguna tarea Full pasa a `done` sin haber consultado `stack.md` y `anti_patterns.md`.
- Si la columna "Stack Tocado" es `si`, ejecutar `factoria-stack-audit.mjs` antes de cerrar.
- Si cambia alcance, datos, API o seguridad: actualizar contratos primero, después código.

## Criterio Por Tipo De Tarea

| Tipo | Criterio Mínimo De Aceptación |
|---|---|
| Feature | Funcional verificado en browser/stream + `verification_log.md` actualizado |
| Bug fix | Bug no reproducible después del fix + `verification_log.md` con before/after |
| Deploy | Archivos subidos con pscp + behavior verificado en `avatar.virtufan.com` |
| Spike | `decision_log.md` con conclusión + decisión de continuar o descartar |
