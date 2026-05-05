# Test Plan

Define como se verificara el proyecto segun riesgo y tipo de cambio.

## Test Matrix

| Tipo de cambio | Verificacion minima | Evidencia requerida | Obligatorio si |
|---|---|---|---|
| UI/copy simple | revision visual o smoke | captura, descripcion o comando | afecta experiencia visible |
| Logica local | unit test o prueba manual reproducible | comando y resultado | cambia reglas internas |
| API/contrato | integration test o request reproducible | payload, status, errores | cambia endpoint o schema |
| Datos/migracion | migration test + rollback probado | backup, comando, resultado | toca persistencia |
| Seguridad/auth/pagos | security review + caso negativo | intento permitido y bloqueado | toca permisos, secretos o dinero |
| Integracion externa | sandbox/mock + fallback | credenciales simuladas, callback, rollback | toca proveedores o webhooks |
| Deploy/produccion | build + smoke + health check | version, comando, logs, rollback | afecta runtime o infraestructura |
| Performance | benchmark o medicion comparable | antes/despues, umbral | puede degradar latencia/costo |

## Reglas

- Ninguna tarea `done` sin evidencia en `docs/verification_log.md`.
- Si no se puede ejecutar una prueba, registrar motivo y riesgo residual.
- Si el cambio toca produccion, datos o deploy, revisar `docs/backup_restore.md` y `docs/observability.md`.
- Si el cambio toca integraciones, revisar `docs/integration_matrix.md`.
