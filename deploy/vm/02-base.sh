#!/usr/bin/env bash
# Base del sistema de la VM de aplicaciones (10.10.70.5, Ubuntu 26.04):
#   1. disco: el volumen raíz ocupa todo el disco
#   2. zona horaria de Argentina
#   3. Docker Engine + Compose desde el repositorio oficial
#   4. firewall: SSH sólo desde la VLAN de trabajo; puertos de apps (8000–8999) sólo desde el proxy
# Correr con: sudo bash /home/claude/02-base.sh
# Se puede correr de nuevo sin problema (cada paso mira si ya está hecho).
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Correr con sudo"; exit 1; }

VM_IP=10.10.70.5
PROXY=10.10.70.2
GESTION=10.10.20.0/24          # VLAN de trabajo (desde donde se entra por SSH)
PUERTOS_APPS=8000:8999         # cada instancia/proyecto publica su puerto en este rango
FECHA=$(date +%Y%m%d-%H%M%S)
RESPALDO=/root/respaldo-base-$FECHA.tgz

paso() { echo; echo "== $* =="; }

paso "Respaldo"
tar czf "$RESPALDO" /etc/ufw /etc/default/ufw /etc/timezone /etc/apt/sources.list.d 2>/dev/null || true
echo "Respaldo en $RESPALDO"

paso "1. Disco"
pvresize /dev/sda3 >/dev/null
LIBRE=$(vgs --noheadings -o vg_free_count ubuntu-vg | tr -d ' ')
if [ "$LIBRE" -gt 0 ]; then
  lvextend -r -l +100%FREE /dev/ubuntu-vg/ubuntu-lv   # ext4 crece en caliente
else
  echo "Ya ocupa todo el disco."
fi
df -h / | tail -1

paso "2. Zona horaria"
timedatectl set-timezone America/Argentina/Buenos_Aires
timedatectl | grep -E "Time zone|synchronized"

paso "3. Docker"
if ! command -v docker >/dev/null; then
  apt-get update -q
  apt-get install -y -q ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker >/dev/null
docker --version; docker compose version

paso "4. Firewall"
# Docker publica los puertos por delante de ufw (cadena FORWARD), así que el filtro de las apps va en
# DOCKER-USER, cargado desde after.rules para que ufw lo reponga en cada arranque/recarga.
# Se compara la conexión ORIGINAL (destino esta VM, puerto de apps, origen ≠ proxy): así no se cortan
# las respuestas al proxy ni las conexiones que las apps abren hacia afuera (p. ej. lectores en :8080).
MARCA="# careador: puertos de apps sólo desde el proxy"
if ! grep -qF "$MARCA" /etc/ufw/after.rules; then
  cat >> /etc/ufw/after.rules <<EOF

$MARCA
*filter
:DOCKER-USER - [0:0]
-A DOCKER-USER -p tcp -m conntrack --ctorigdst $VM_IP --ctorigdstport $PUERTOS_APPS ! --ctorigsrc $PROXY -j DROP
COMMIT
EOF
fi

ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow from "$GESTION" to any port 22 proto tcp comment 'SSH desde la VLAN de trabajo' >/dev/null

# Red de rescate: si te quedás afuera, a los 5 minutos se apaga el firewall solo.
systemctl stop ufw-rescate.timer 2>/dev/null || true
systemd-run --quiet --unit=ufw-rescate --on-active=5min /usr/sbin/ufw disable
ufw --force enable >/dev/null
ufw reload >/dev/null             # carga after.rules aunque ufw ya estuviera activo

ufw status verbose
echo; echo "DOCKER-USER:"; iptables -S DOCKER-USER
iptables -S FORWARD | grep -q DOCKER-USER || echo "OJO: FORWARD no salta a DOCKER-USER"

cat <<EOF

== Listo ==
1. Abrí OTRA sesión de PuTTY a $VM_IP. Si entra, confirmá el firewall (antes de 5 minutos):
       sudo systemctl stop ufw-rescate.timer
   Si no entra, esperá 5 minutos: el firewall se apaga solo y entrás de nuevo.
2. Volver atrás el firewall:
       sudo ufw disable && sudo tar xzf $RESPALDO -C / && sudo ufw enable
EOF
