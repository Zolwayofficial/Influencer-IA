# Deployment

Estado: active
Última actualización: 2026-05-05

## 1. Entorno De Producción

- VPS: 194.163.172.161 (Contabo, Ubuntu 22.04), `/opt/influencer/`
- Dominio: virtufan.com → HostGator DNS → 194.163.172.161

## 2. Comandos De Deploy Desde Windows

```bash
# Subir archivo (SIEMPRE ruta completa de destino):
pscp -batch -pw "Upcmonterrico27@" -hostkey "ssh-ed25519 255 SHA256:IWp19p3PCPMAqvwZsTGP1Dfr+2iYoRtr0N+maxHm9V4" "C:/local/archivo.ext" "root@194.163.172.161:/opt/influencer/destino/archivo.ext"

# Comando remoto:
plink -batch -pw "Upcmonterrico27@" -hostkey "ssh-ed25519 255 SHA256:IWp19p3PCPMAqvwZsTGP1Dfr+2iYoRtr0N+maxHm9V4" root@194.163.172.161 "comando"
```

CRÍTICO: NUNCA usar ssh/scp estándar (AP-005).

## 3. Reglas Por Servicio

| Servicio | Acción tras cambio |
|---|---|
| avatar-frontend/dist/ | Solo subir con pscp — NO reiniciar container (AP-006) |
| openclaw/index.js o skills/ | `docker restart influencer-openclaw` (AP-007) |
| f5-tts/server.py | `docker restart influencer-f5tts` |
| docker-compose.yml | `docker compose up -d --no-deps <servicio>` |

## 4. Levantar Sistema Completo

```bash
cd /opt/influencer && ./deploy.sh up
./deploy.sh health
```

## 5. Rollback

- avatar-frontend: subir versión anterior con pscp (inmediato, sin restart)
- openclaw: `git checkout <commit> -- openclaw/` en VPS + `docker restart influencer-openclaw`
- docker-compose: revertir cambio + `docker compose up -d --no-deps <servicio>`

## 6. Health Checks

- Avatar: https://avatar.virtufan.com
- Panel: https://control.virtufan.com/control.html (PIN 1977)
- Stream: `srt://194.163.172.161:8890?streamid=read:live/influencer`
