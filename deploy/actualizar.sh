#!/usr/bin/env bash
# Uso:
#   sudo /opt/careador/deploy/actualizar.sh pruebas     # trae lo último de GitHub y actualiza PRUEBAS
#   sudo /opt/careador/deploy/actualizar.sh produccion  # respalda PRODUCCIÓN y le pasa la versión que está en pruebas
#   sudo /opt/careador/deploy/actualizar.sh volver      # PRODUCCIÓN vuelve a la versión anterior
#
# Imágenes:  careador:latest (pruebas) · careador:estable (producción) · careador:anterior (rollback)
# Instancias: /srv/careador-*-test = pruebas · resto de /srv/careador-* = producción
set -euo pipefail

version() { docker image inspect -f '{{index .Config.Labels "version"}}' "$1" 2>/dev/null || true; }

reiniciar() { # $1 = test | prod
  for dir in /srv/careador-*/; do
    [ -f "$dir/compose.yml" ] || continue
    case "$dir" in
      *-test/) [ "$1" = test ] || continue ;;
      *)       [ "$1" = prod ] || continue ;;
    esac
    echo "==> $dir"
    if [ "$1" = prod ] && (cd "$dir" && docker compose ps -q app | grep -q .); then
      (cd "$dir" && docker compose exec -T app node dist/cli.js db:respaldo /data/respaldos)
    fi
    (cd "$dir" && docker compose up -d)
  done
}

case "${1:-}" in
  pruebas)
    cd /opt/careador
    git pull --ff-only
    docker build --label version="$(sed -n 's/^## \([0-9.]*\) .*/\1/p' CHANGELOG.md | head -1)" -t careador:latest .
    reiniciar test
    echo "Pruebas actualizado a la versión $(version careador:latest) · $(git log -1 --format='%h %s')"
    ;;
  produccion)
    docker image inspect careador:latest >/dev/null
    if docker image inspect careador:estable >/dev/null 2>&1; then
      docker tag careador:estable careador:anterior
    fi
    docker tag careador:latest careador:estable
    reiniciar prod
    echo "Producción actualizada a la versión $(version careador:estable). Si algo falla: $0 volver"
    ;;
  volver)
    docker image inspect careador:anterior >/dev/null
    docker tag careador:anterior careador:estable
    reiniciar prod
    echo "Producción volvió a la versión $(version careador:estable)."
    ;;
  *)
    sed -n '2,8p' "$0"
    exit 1
    ;;
esac

docker image prune -f >/dev/null
