#!/usr/bin/env bash
# Uso:
#   sudo /opt/careador/deploy/actualizar.sh pruebas     # trae lo último de GitHub y actualiza PRUEBAS
#   sudo /opt/careador/deploy/actualizar.sh produccion  # pasa a PRODUCCIÓN la versión que está en pruebas
#   sudo /opt/careador/deploy/actualizar.sh volver      # PRODUCCIÓN vuelve a la versión anterior
#
# Imágenes:  careador:latest (pruebas) · careador:estable (producción) · careador:anterior (rollback)
# Instancias: /srv/careador-*-test = pruebas · resto de /srv/careador-* = producción
set -euo pipefail

reiniciar() { # $1 = test | prod
  for dir in /srv/careador-*/; do
    [ -f "$dir/compose.yml" ] || continue
    case "$dir" in
      *-test/) [ "$1" = test ] || continue ;;
      *)       [ "$1" = prod ] || continue ;;
    esac
    echo "==> $dir"
    (cd "$dir" && docker compose up -d)
  done
}

case "${1:-}" in
  pruebas)
    cd /opt/careador
    git pull --ff-only
    docker build -t careador:latest .
    reiniciar test
    echo "Pruebas actualizado a $(git log -1 --format='%h %s')"
    ;;
  produccion)
    docker image inspect careador:latest >/dev/null
    if docker image inspect careador:estable >/dev/null 2>&1; then
      docker tag careador:estable careador:anterior
    fi
    docker tag careador:latest careador:estable
    reiniciar prod
    echo "Producción actualizada. Si algo falla: $0 volver"
    ;;
  volver)
    docker image inspect careador:anterior >/dev/null
    docker tag careador:anterior careador:estable
    reiniciar prod
    echo "Producción volvió a la versión anterior."
    ;;
  *)
    sed -n '2,8p' "$0"
    exit 1
    ;;
esac

docker image prune -f >/dev/null
