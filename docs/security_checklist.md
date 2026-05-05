# Security Checklist

Estado: active
Última actualización: 2026-05-05

## Checklist Por Tarea

- [ ] No se exponen secrets (contraseña VPS, Groq API key, PIN panel) en código o logs
- [ ] Ningún cambio en avatar-frontend expone el token `live1234` en HTML/JS público innecesariamente
- [ ] Comandos destructivos en VPS tienen frase explícita de confirmación (ver `agent_policy.md`)
- [ ] Cambios que tocan autenticación (stream token, panel PIN) se registran en `decision_log.md`
- [ ] Nuevas dependencias verificadas contra `docs/stack.md` antes de instalar

## Riesgos Permanentes

- Contraseña VPS en scripts locales (aceptado, uso personal, no commitear)
- Stream token `live1234` en URL pública (aceptado, necesario para funcionamiento)
- Panel protegido solo por PIN 1977 (aceptado por ahora; sin HTTPS break si Traefik falla)

## Lethal Trifecta

Ver `docs/agent_policy.md`. Este proyecto tiene alto riesgo de trifecta en tareas que combinen:
- A: acceso a credenciales VPS o Groq API key
- B: input de chat de TikTok/YouTube (contenido no confiable)
- C: capacidad de ejecutar comandos en VPS o publicar al stream
