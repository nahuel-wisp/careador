#!/usr/bin/env bash
# Crea el acceso de Claude a la VM de aplicaciones (10.10.70.5).
# Usuario `claude`: sólo con clave SSH (sin contraseña), SIN sudo, en el grupo `docker`
# para levantar/actualizar las instancias y leer logs. Lo que necesite root va en scripts numerados
# como este, que corre el administrador con: sudo bash 01-acceso-claude.sh
# Ojo: el grupo docker equivale a root en la práctica; se acepta porque el despliegue es todo Docker.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Correr con sudo"; exit 1; }

USUARIO=claude
CLAVE='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIK44QukhYRrmQ86jPMfpG4FQJdyt4x4sXaaBqpExKxBX gestion-clientes@DESKTOP-4OCPSIO'
DROPIN=/etc/ssh/sshd_config.d/20-claude.conf

id "$USUARIO" >/dev/null 2>&1 || useradd -m -s /bin/bash "$USUARIO"
passwd -l "$USUARIO" >/dev/null   # sin contraseña: sólo entra con la clave

install -d -m 700 -o "$USUARIO" -g "$USUARIO" "/home/$USUARIO/.ssh"
AK="/home/$USUARIO/.ssh/authorized_keys"
touch "$AK"
grep -qxF "$CLAVE" "$AK" || echo "$CLAVE" >> "$AK"
chown "$USUARIO:$USUARIO" "$AK"; chmod 600 "$AK"

# El grupo se crea ya; cuando se instale Docker lo reusa.
getent group docker >/dev/null || groupadd docker
usermod -aG docker "$USUARIO"

# Sólo para este usuario: nada de contraseña por SSH (no toca cómo entra el administrador).
cat > "$DROPIN" <<'EOF'
Match User claude
    PasswordAuthentication no
    KbdInteractiveAuthentication no
EOF
if ! sshd -t; then
  rm -f "$DROPIN"; echo "La configuración de SSH no validó: se dejó como estaba."; exit 1
fi
systemctl reload ssh 2>/dev/null || true   # con activación por socket no hace falta: cada conexión lee la config

echo "Listo. Usuario $USUARIO creado (grupos: $(id -nG "$USUARIO"))."
echo "Huella de la VM:"; ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
echo "Para sacar el acceso: sudo userdel -r $USUARIO && sudo rm -f $DROPIN"
