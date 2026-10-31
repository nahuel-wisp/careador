#!/usr/bin/env bash
# Actualiza Careador a la última versión de main y reinicia el servicio.
# Uso (como root): /opt/careador/deploy/actualizar.sh
set -euo pipefail

cd /opt/careador
sudo -u careador git pull --ff-only
sudo -u careador npm ci --no-audit --no-fund
sudo -u careador npm run build
systemctl restart careador
sleep 2
systemctl --no-pager --lines=5 status careador
curl -fsS http://127.0.0.1:8080/api/health && echo
