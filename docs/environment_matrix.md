# Environment Matrix

Uso: controlar entornos, variables y secretos sin exponer valores sensibles.

| Variable/Servicio | Local | Staging | Produccion | Obligatoria | Secret | Rotacion | Duenio |
|---|---|---|---|---|---|---|---|
| [POR DEFINIR] | [POR DEFINIR] | [POR DEFINIR] | [POR DEFINIR] | yes/no | yes/no | [POR DEFINIR] | [POR DEFINIR] |

## Reglas

- No escribir secretos reales en docs o codigo.
- Documentar nombres, origen, alcance y rotacion.
- Si una variable es requerida para deploy, debe estar en `docs/deployment.md`.
- Si cambia auth, pagos o datos sensibles, revisar `docs/security_checklist.md`.
