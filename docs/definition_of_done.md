# Definition Of Done

Criterios que toda tarea debe cumplir antes de pasar a `done` en `task_tracker.md`. Si un criterio no aplica al tipo de tarea, marcalo explicitamente como N/A en `verification_log.md`.

## Criterios Universales

- [ ] El criterio de aceptacion declarado en `task_tracker.md` se cumple y esta verificable.
- [ ] Tests existentes siguen pasando (no se introdujo regression).
- [ ] Build y lint sin errores ni warnings nuevos.
- [ ] No hay secretos, claves o datos sensibles en codigo, comentarios, logs o tests.
- [ ] Si se cambio contrato (API, datos, evento), el doc correspondiente esta actualizado **antes** que el codigo.
- [ ] Si se introdujo capability reutilizable, esta en `docs/capability_map.md`.
- [ ] Si se introdujo dependencia, esta en `docs/stack.md` y el ADR existe en `docs/decision_log.md`.
- [ ] Si emergio anti-patron nuevo o recurrente, esta en `docs/anti_patterns.md`.
- [ ] Evidencia de pruebas registrada en `docs/verification_log.md` con referencia al ID de tarea.

## Criterios Por Tipo De Tarea

### Feature

- [ ] Tests unitarios sobre la logica nueva con cobertura razonable.
- [ ] Tests de integracion si la feature toca persistencia, red o multiples modulos.
- [ ] Documentacion de uso actualizada si es feature visible.

### Bug Fix

- [ ] Test que reproduce el bug fue escrito **antes** del fix y fallaba.
- [ ] Tras el fix, el test pasa.
- [ ] Causa raiz documentada en `docs/anti_patterns.md` si es patron de error reproducible en el proyecto.

### Refactor

- [ ] Tests existentes pasan sin modificarlos. Si se modificaron tests, justificar en `verification_log.md` por que el cambio no es para enmascarar regression.
- [ ] `design_summary.md` actualizado si cambiaron limites de modulos.
- [ ] `capability_map.md` actualizado si capabilities se movieron, deprecaron o consolidaron.

### Migracion De Datos O Schema

- [ ] Rollback documentado y probado.
- [ ] Backup verificado antes de ejecutar.
- [ ] Smoke test en staging antes de produccion.
- [ ] `data_model.md` actualizado.
- [ ] Plan de comunicacion a clientes si la migracion afecta API publica.

### Cambio De Stack

- [ ] ADR en `decision_log.md` con alternativas y why-not.
- [ ] `stack.md` actualizado.
- [ ] `factoria-stack-audit.mjs` corre verde.
- [ ] Plan de migracion gradual si afecta codigo existente.

## Mutation Score Gate (Modulos Criticos)

Para tareas que tocan modulos criticos del proyecto (auth, criptografia, manejo de secrets, payments, autorizacion, integridad de datos), no basta con coverage de linea. Se exige mutation score minimo:

| Modulo | Threshold Mutation Score |
|---|---|
| Auth, autz, crypto, secrets | >= 80% |
| Payments, billing, integridad de datos | >= 75% |
| Business logic core | >= 60% |
| Utilities triviales, UI cosmetica | sin requisito |

Herramientas sugeridas (la skill no impone): Stryker (JS/TS), mutmut (Python), pitest (Java), cargo-mutants (Rust).

Esto previene la "coverage illusion": tests que pasan pero no detectan defectos. Si tu PR tiene 95% de coverage pero los mutantes sobreviven, los tests no validan; codifican comportamiento.

## Trazabilidad

- [ ] Commit message referencia el ID de tarea (`IT-XXX`).
- [ ] Si el commit fue AI-authored, el commit message lo declara y referencia el ADR si aplica.
- [ ] PR description cita los archivos fuente que respaldan decisiones tecnicas no triviales.
