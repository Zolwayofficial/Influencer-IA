# Backup Restore

Uso: obligatorio cuando hay datos persistentes, migraciones, self-hosting, produccion o deploy.

| Recurso | Backup | Frecuencia | Retencion | Restore Probado | RPO | RTO | Responsable |
|---|---|---|---|---|---|---|---|
| [POR DEFINIR] | [POR DEFINIR] | [POR DEFINIR] | [POR DEFINIR] | yes/no | [POR DEFINIR] | [POR DEFINIR] | [POR DEFINIR] |

## Migraciones

- Cambio:
- Riesgo:
- Backup previo:
- Comando de migracion:
- Verificacion posterior:
- Rollback:

## Reglas

- No tocar produccion sin rollback de datos.
- No cerrar una migracion sin evidencia en `docs/verification_log.md`.
- Si el restore no se ha probado, marcar riesgo en `docs/risk_register.md`.
