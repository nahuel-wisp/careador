# Despliegue en VM con Docker Compose

VM de pruebas detrás de Traefik (`https://arsa.nmc.wisp.com.ar`).
Base: **Ubuntu Server 26.04**, 4 vCPU, 8 GB RAM, 300 GB disco, Docker Compose.
Backups de la VM con Nakivo hacia el servidor de backups.

## Esquema

```
Traefik (HTTPS, Let's Encrypt)
   │  arsa.nmc.wisp.com.ar → IP_VM:8080
   ▼
VM Ubuntu 26.04 + Docker
   ├── /opt/careador          código (git) → imagen careador:latest
   ├── /srv/careador-arsa/    instancia del cliente Arsa
   │     ├── compose.yml
   │     ├── .env             secretos (CAREADOR_SECRET)
   │     └── data/            base SQLite + respaldos/
   └── /srv/<otro-proyecto>/  otros proyectos, cada uno con su compose.yml
   │
   └── VPN / IP Cloud MikroTik → lectores de las sucursales
```

Una imagen de Careador sirve para varios clientes: cada cliente es una carpeta `/srv/careador-<cliente>`
con su puerto, su `.env` y sus datos.

## 1. Base del sistema

> Esta sección la vamos completando juntos durante la instalación.

- Actualizaciones, zona horaria `America/Argentina/Buenos_Aires`, NTP.
- Firewall (ufw): SSH sólo desde redes de gestión; puertos de apps sólo desde la IP de Traefik.
- Docker Engine + plugin Compose desde el repositorio oficial de Docker.
- Ruta/VPN hacia los lectores. Prueba desde la VM:

  ```bash
  curl -i http://IP_O_HOST_DEL_LECTOR/ISAPI/System/deviceInfo
  ```

  `401 Unauthorized` = correcto (el equipo responde y pide credenciales).

## 2. Código e imagen

```bash
sudo git clone https://github.com/nahuel-wisp/careador.git /opt/careador
cd /opt/careador
sudo docker build -t careador:latest .
```

Si el repo es privado, clonar con una deploy key de sólo lectura.

## 3. Instancia del cliente

```bash
sudo mkdir -p /srv/careador-arsa/data
sudo cp /opt/careador/deploy/compose.yml /srv/careador-arsa/
sudo chown 1000:1000 /srv/careador-arsa/data   # el contenedor corre como usuario node (uid 1000)
```

`/srv/careador-arsa/.env`:

```ini
CAREADOR_SECRET=<generar con: openssl rand -base64 48>
```

```bash
sudo chmod 600 /srv/careador-arsa/.env
cd /srv/careador-arsa && sudo docker compose up -d
curl http://127.0.0.1:8080/api/health
```

**Guardar `CAREADOR_SECRET` fuera de la VM** (gestor de contraseñas): sin esa clave no se pueden
descifrar las credenciales de los equipos guardadas en la base.

Para otra instancia en la misma VM: otra carpeta `/srv/careador-<cliente>` y cambiar el puerto en
`compose.yml` (ej. `"8081:8080"`).

## 4. Primer usuario

```bash
cd /srv/careador-arsa
sudo docker compose exec app node dist/cli.js usuario:crear tu@email.com "Tu Nombre" admin
```

Otros comandos: `usuario:clave <email>`, `usuario:listar`, `db:respaldo`.

## 5. Traefik

Lo que la app necesita del proxy:

- Enrutar `arsa.nmc.wisp.com.ar` → `http://IP_VM:8080`, con HTTPS (Let's Encrypt).
- Pasar `X-Forwarded-*` (Traefik lo hace por defecto). La app ya viene con `TRUST_PROXY=true`.
- Body de hasta 10 MB (fotos). Traefik no limita por defecto.

Referencia mínima (proveedor de archivos), para adaptar a la configuración existente:

```yaml
http:
  routers:
    careador-arsa:
      rule: Host(`arsa.nmc.wisp.com.ar`)
      entryPoints: [websecure]
      service: careador-arsa
      tls:
        certResolver: letsencrypt
  services:
    careador-arsa:
      loadBalancer:
        servers:
          - url: http://IP_VM:8080
```

## 6. Actualizar

```bash
sudo /opt/careador/deploy/actualizar.sh
```

`git pull` + nueva imagen + reinicio de todas las instancias. Las migraciones de base se aplican solas.
La versión anterior queda como `careador:anterior` para volver atrás.

## 7. Respaldos

```bash
sudo cp /opt/careador/deploy/respaldo.cron /etc/cron.d/careador
```

Todos los días a las 03:30 deja una copia consistente de cada base en
`/srv/careador-*/data/respaldos/` (se conservan 30 días). Nakivo respalda la VM completa, incluidas
esas copias, hacia el servidor de backups.

Restaurar: detener la instancia, reemplazar `data/careador.db` por la copia y volver a levantarla.

```bash
cd /srv/careador-arsa
sudo docker compose down
sudo cp data/respaldos/careador-AAAA-MM-DD-HH-MM-SS.db data/careador.db
sudo rm -f data/careador.db-wal data/careador.db-shm
sudo docker compose up -d
```
