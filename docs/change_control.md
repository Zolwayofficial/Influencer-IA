# Change Control

Uso: solo para cambios que alteran el plan.

No usar para bugs pequenos, refactors locales, estilos, tests o cambios internos sin impacto externo.

## Cuando Se Activa

Crear una entrada solo si el cambio toca:

- arquitectura,
- stack,
- alcance del MVP,
- modelo de datos,
- contratos API,
- seguridad,
- permisos del agente,
- deploy/produccion,
- pagos,
- licencias,
- integraciones externas criticas.

## Flujo

```txt
Descubrimiento -> Propuesta -> Impacto -> Decision -> Docs actualizados -> Ejecucion
```

## Template

```md
## CC-001 - [Titulo]

Estado: proposed | approved | rejected | superseded
Fecha:
Tarea relacionada:

### Cambio Propuesto

[Que se quiere cambiar]

### Motivo

[Por que el plan actual ya no es la mejor opcion]

### Impacto

- Arquitectura:
- API:
- Datos:
- Seguridad:
- Agente:
- Deploy:
- Licencias:
- UX:

### Documentos A Actualizar

- [ ] docs/design_summary.md
- [ ] design/architecture.md
- [ ] docs/api_contracts.md
- [ ] docs/data_model.md
- [ ] docs/agent_policy.md
- [ ] docs/project_memory.md
- [ ] docs/task_tracker.md
- [ ] docs/decision_log.md

### Riesgos

- [POR DEFINIR]

### Rollback

[Como volver al plan anterior si el cambio falla]

### Decision

[Aprobado/rechazado y por que]
```

## Regla Anti-Burocracia

Si el cambio no altera el plan, no uses este archivo.

