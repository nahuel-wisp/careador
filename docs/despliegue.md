# Despliegue en VM (Linux)

Instalación de pruebas en una VM propia detrás de Traefik, ej. `https://arsa.nahuel.wisp.com.ar`.
Probado para Debian 12 / Ubuntu 24.04.

## 1. Requisitos de la VM

- 1 vCPU, 1–2 GB RAM, 10–20 GB disco.
- Llegar a los lectores de las sucursales (VPN o IP Cloud del MikroTik). Prueba:

  ```bash
  curl -i http://IP_O_HOST_DEL_LECTOR/ISAPI/System/deviceInfo
  ```

  Un `401 Unauthorized` es la respuesta correcta (el equipo pide credenciales).

## 2. Node.js 22 y herramientas de compilación

```bash
apt update && apt install -y curl git build-essential python3
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v
```

`build-essential` y `python3` sólo hacen falta si `better-sqlite3` no encuentra un binario precompilado.

## 3. Usuario, código y datos

```bash
useradd --system --home /opt/careador --shell /usr/sbin/nologin careador
git clone https://github.com/nahuel-wisp/careador.git /opt/careador
mkdir -p /var/lib/careador
chown -R careador:careador /opt/careador /var/lib/careador
```

Si el repo es privado, clonar con una deploy key o un token de sólo lectura.

## 4. Configuración

`/opt/careador/.env`:

```ini
PORT=8080
HOST=0.0.0.0
DATA_DIR=/var/lib/careador
TRUST_PROXY=true
CAREADOR_SECRET=<generar con: openssl rand -base64 48>
```

```bash
chown careador:careador /opt/careador/.env && chmod 600 /opt/careador/.env
```

**Guardar `CAREADOR_SECRET` en un lugar seguro**: sin esa clave no se pueden descifrar las
contraseñas de los equipos guardadas en la base.

## 5. Compilar e instalar el servicio

```bash
cd /opt/careador
sudo -u careador npm ci --no-audit --no-fund
sudo -u careador npm run build
cp deploy/careador.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now careador
curl http://127.0.0.1:8080/api/health
```

Logs: `journalctl -u careador -f`.

## 6. Primer usuario

```bash
cd /opt/careador/apps/server
sudo -u careador env $(cat /opt/careador/.env | xargs) node dist/cli.js usuario:crear tu@email.com "Tu Nombre" admin
```

Otros comandos: `usuario:clave <email>` (cambia la contraseña y cierra sus sesiones), `usuario:listar`.

## 7. Traefik

Lo que la app necesita del proxy:

- Enrutar `arsa.nahuel.wisp.com.ar` → `http://IP_DE_LA_VM:8080`.
- HTTPS con Let's Encrypt (lo resuelve Traefik).
- Pasar los headers `X-Forwarded-*` (Traefik lo hace por defecto) y `TRUST_PROXY=true` en la app.
- Sin límite de tamaño de body menor a 10 MB (fotos). Traefik no limita por defecto.
- Si la VM tiene firewall, permitir el puerto 8080 sólo desde la IP de Traefik.

Referencia mínima (proveedor de archivos), para adaptar a la configuración existente:

```yaml
http:
  routers:
    careador-arsa:
      rule: Host(`arsa.nahuel.wisp.com.ar`)
      entryPoints: [websecure]
      service: careador-arsa
      tls:
        certResolver: letsencrypt
  services:
    careador-arsa:
      loadBalancer:
        servers:
          - url: http://IP_DE_LA_VM:8080
```

## 8. Actualizar

```bash
/opt/careador/deploy/actualizar.sh
```

Hace `git pull`, reinstala dependencias, compila y reinicia. Las migraciones de base se aplican solas.

## 9. Backups

Todo el estado está en `/var/lib/careador/careador.db` (+ `CAREADOR_SECRET`). Copia en caliente segura:

```bash
apt install -y sqlite3
sqlite3 /var/lib/careador/careador.db ".backup '/ruta/backups/careador-$(date +%F).db'"
```
