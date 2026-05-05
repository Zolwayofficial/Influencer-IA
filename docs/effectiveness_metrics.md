# Effectiveness Metrics

Mide si FactorIA v8 realmente reduce errores, recurrencias, tokens malgastados y sesgo del agente.

## Metricas Estructurales

| Metrica | Objetivo | Como Medir |
|---|---:|---|
| Tareas cerradas con verificacion | 100% | `verification_log.md` por tarea done |
| Cambios API sin contrato actualizado | 0 | Diff + `api_contracts.md` |
| Cambios de datos sin modelo actualizado | 0 | Diff + `data_model.md` |
| Acciones autonomas sin policy | 0 | Tools usadas vs `agent_policy.md` |
| Tareas reabiertas por falta de contexto | Tendencia baja | `task_tracker.md` |
| Sesiones con `project_memory.md` actualizado | 100% | Cierre de sesion |
| Deploys sin rollback documentado | 0 | `deployment.md` |
| Cambios de plan sin change_control | 0 | `change_control.md` cuando aplica |

## Metricas Anti-Drift De Stack

| Metrica | Objetivo | Como Medir |
|---|---:|---|
| Dependencias instaladas no declaradas en `stack.md` | 0 | `factoria-stack-audit` |
| Dependencias declaradas pero no instaladas | 0 (a 30 dias) | `factoria-stack-audit` |
| Decisiones de stack sin ADR en `decision_log.md` | 0 | Diff de `package.json` vs ADRs |

## Metricas Anti-Recurrencia Y Anti-Sesgo

| Metrica | Objetivo | Como Medir |
|---|---:|---|
| Anti-patrones documentados que volvieron a aparecer | 0 | Revision manual de PRs vs `anti_patterns.md` |
| Tokens promedio por tarea en fase de correccion | Tendencia baja | Logs de chat por tarea |
| Decisiones tecnicas sin cita de fuente | 0 | Revision manual de PR descriptions |
| Argumentos de autoridad aceptados sin medir | 0 | Revision de chats / PRs |
| Sugerencias de IA que duplican funcionalidad ya en stack | 0 | Revision manual + `factoria-stack-audit` |

## Metricas De Madurez

| Metrica | Objetivo | Como Medir |
|---|---:|---|
| Anti-patrones registrados en el proyecto | Crece con el tiempo | Conteo de `AP-XXX` |
| ADRs registrados por trimestre | 5-15 | Conteo de `ADR-XXX` |
| Edad maxima de `project_memory.md` | < 14 dias | mtime |

## Revision

Frecuencia recomendada: semanal o al cerrar milestone. Una metrica fuera de objetivo durante dos semanas consecutivas dispara entrada en `risk_register.md` y revision de mecanismos.
