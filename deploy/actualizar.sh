#!/usr/bin/env bash
# Actualiza el código, reconstruye la imagen y reinicia todas las instancias /srv/careador-*.
# Guarda la imagen anterior como careador:anterior para poder volver atrás.
# Uso: sudo /opt/careador/deploy/actualizar.sh
set -euo pipefail

cd /opt/careador
git pull --ff-only

if docker image inspect careador:latest >/dev/null 2>&1; then
  docker tag careador:latest careador:anterior
fi
docker build -t careador:latest .

for dir in /srv/careador-*/; do
  [ -f "$dir/compose.yml" ] || continue
  echo "==> $dir"
  (cd "$dir" && docker compose up -d)
done

docker image prune -f >/dev/null
echo "Listo. Para volver atrás: docker tag careador:anterior careador:latest y docker compose up -d en cada instancia."
