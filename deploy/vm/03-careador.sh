#!/usr/bin/env bash
# Carpetas de Careador en la VM de aplicaciones, a nombre de `claude`, para que Claude clone, arme la
# imagen y actualice (deploy/actualizar.sh) sin sudo. Instala también el respaldo diario.
# Correr con: sudo bash /home/claude/03-careador.sh  (se puede repetir)
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Correr con sudo"; exit 1; }

install -d -o claude -g claude -m 755 /opt/careador
for inst in arsa arsa-test; do
  install -d -o claude -g claude -m 750 "/srv/careador-$inst"
  install -d -o 1000 -g 1000 -m 750 "/srv/careador-$inst/data"   # el contenedor corre como node (uid 1000)
done

# Mismo contenido que deploy/respaldo.cron
cat > /etc/cron.d/careador <<'EOF'
# Respaldo diario de cada instancia de Careador: copias de la base en /srv/careador-*/data/respaldos (30 días).
30 3 * * * root for d in /srv/careador-*/; do cd "$d" && docker compose exec -T app node dist/cli.js db:respaldo /data/respaldos 30; done >> /var/log/careador-respaldo.log 2>&1
EOF
chmod 644 /etc/cron.d/careador

ls -ld /opt/careador /srv/careador-*/ /srv/careador-*/data
echo "Listo."
