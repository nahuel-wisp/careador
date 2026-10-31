# Despliegue en VM con Docker Compose

VM `10.10.70.5` (Careador y futuros proyectos) detrás de Traefik (`https://arsa.nmc.wisp.com.ar`).
Base: **Ubuntu Server 26.04**, 4 vCPU, 8 GB RAM, 300 GB disco, Docker Compose.
Backups de la VM con Nakivo hacia el servidor de backups.

## Esquema

```
Traefik (HTTPS, Let's Encrypt)
   │  arsa.nmc.wisp.com.ar → 10.10.70.5:8080
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

## 3. Instancias: producción y pruebas

| | Producción | Pruebas |
|---|---|---|
| URL | `arsa.nmc.wisp.com.ar` | `arsa-test.nmc.wisp.com.ar` |
| Carpeta | `/srv/careador-arsa` | `/srv/careador-arsa-test` |
| Puerto VM | 8080 | 8180 |
| Imagen | `careador:estable` | `careador:latest` |
| Equipos reales | lectura y escritura | **sólo lectura** |
| Lector simulado | no | sí |

Cada instancia tiene su propia base y su propia `CAREADOR_SECRET`.

```bash
for inst in arsa arsa-test; do
  sudo mkdir -p /srv/careador-$inst/data
  sudo cp /opt/careador/deploy/compose.yml /srv/careador-$inst/
  sudo chown 1000:1000 /srv/careador-$inst/data   # el contenedor corre como usuario node (uid 1000)
done
sudo cp /opt/careador/deploy/env.produccion /srv/careador-arsa/.env
sudo cp /opt/careador/deploy/env.pruebas    /srv/careador-arsa-test/.env
# Poner una CAREADOR_SECRET distinta en cada .env:  openssl rand -base64 48
sudo chmod 600 /srv/careador-*/.env

sudo docker tag careador:latest careador:estable   # sólo la primera vez
for inst in arsa arsa-test; do (cd /srv/careador-$inst && sudo docker compose up -d); done
curl http://127.0.0.1:8080/api/health && curl http://127.0.0.1:8180/api/health
```

**Guardar las `CAREADOR_SECRET` fuera de la VM** (gestor de contraseñas): sin esa clave no se pueden
descifrar las credenciales de los equipos guardadas en la base.

En pruebas aparece una franja naranja ("Entorno: pruebas") para no confundirse.

## 4. Primer usuario (en cada instancia)

```bash
cd /srv/careador-arsa       # y después /srv/careador-arsa-test
sudo docker compose exec app node dist/cli.js usuario:crear tu@email.com "Tu Nombre" admin
```

Otros comandos: `usuario:clave <email>`, `usuario:listar`, `db:respaldo`.

## 5. Traefik (proxy de WISP, 10.10.70.2)

El proxy se maneja con su **panel** (https://10.10.70.2:9443, desde la VLAN de trabajo). El panel escribe
`/etc/traefik/dynamic/sitios.yml`: **no editar archivos de Traefik a mano**, el panel los pisa.
Detalle del proxy: `C:\Users\nahuel\Claude\proxy\CLAUDE.md`.

Publicar las dos instancias:

1. DNS: ya resuelve por el comodín `*.nmc.wisp.com.ar` → 181.191.64.7 (el panel lo valida al guardar).
2. En el panel, «nuevo sitio» por cada una (destino http, sin verificar certificado):

   | Nombre | Dominio | Destino |
   |---|---|---|
   | Careador Arsa | `arsa.nmc.wisp.com.ar` | `http://10.10.70.5:8080` |
   | Careador Arsa pruebas | `arsa-test.nmc.wisp.com.ar` | `http://10.10.70.5:8180` |

3. El certificado de Let's Encrypt lo saca Traefik solo en segundos. Probar: `https://arsa-test.nmc.wisp.com.ar/api/health`.

Lo que la app necesita y ya está resuelto:

- Encabezados de seguridad y límite general de pedidos: los pone el proxy para todos los sitios (`seguridad@file`).
- `X-Forwarded-*`: Traefik los manda por defecto. La app confía en ellos **sólo si vienen de 10.10.70.2**
  (`TRUST_PROXY` en `compose.yml`; otro proxy → poner `TRUST_PROXY=IP` en el `.env`). Si confiara en cualquiera,
  se podría falsificar la IP y esquivar el freno del login.
- Body de hasta 10 MB (fotos): Traefik no limita por defecto.

En la VM, los puertos de las instancias sólo para el proxy (Docker publica puertos por delante de ufw, así que la
regla va en la cadena `DOCKER-USER`; se arma en la sección 1):

```bash
# Sólo 10.10.70.2 llega a 8080/8180. En DOCKER-USER el puerto ya está traducido al del contenedor,
# por eso se compara el puerto original de la conexión (ctorigdstport).
for p in 8080 8180; do
  sudo iptables -I DOCKER-USER -p tcp -m conntrack --ctorigdstport $p ! -s 10.10.70.2 -j DROP
done
```

Estas reglas no sobreviven un reinicio: dejarlas persistentes al armar el firewall (sección 1).

> Ojo: con el mapeo de puertos de Docker el contenedor ve la IP de origen real del proxy. Si en el
> log de la app los pedidos aparecen con otra IP (p. ej. la puerta de enlace de Docker), `TRUST_PROXY`
> no va a coincidir: revisar antes de dar por buena la IP de los clientes.

## 6. Actualizar: pruebas → producción

```bash
sudo /opt/careador/deploy/actualizar.sh pruebas      # trae lo último de GitHub y lo instala en PRUEBAS
# ... probar en arsa-test.nmc.wisp.com.ar ...
sudo /opt/careador/deploy/actualizar.sh produccion   # pasa esa misma versión a PRODUCCIÓN
sudo /opt/careador/deploy/actualizar.sh volver       # si algo falla, producción vuelve a la anterior
```

Las migraciones de base se aplican solas al arrancar cada instancia.

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
