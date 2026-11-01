#!/usr/bin/env bash
# 04-lectores.sh — Carga los lectores de Arsa en pruebas y producción y trae lo que tienen.
#
#   sudo bash 04-lectores.sh
#
# Qué hace:
#   1. Actualiza pruebas a lo último de GitHub y (si confirmás) pasa producción a esa misma versión.
#   2. Deja las sucursales Arsa 1 / Arsa 2 con sus horarios (los de HikCentral) si no están.
#   3. Te pide usuario y contraseña de cada lector (no se muestran ni quedan en ningún archivo:
#      se guardan cifrados en la base de cada instancia, como cuando se cargan desde la app).
#   4. Opcional: importa el Excel «Registros de entradas y salidas» de HikCentral.
#   5. Carga los dos lectores en las dos instancias, prueba la conexión, trae personal con fotos
#      y las marcaciones de los últimos 35 días.
#
# Los lectores quedan en SÓLO LECTURA también en producción: la app lee lo mismo que HikCentral
# pero no les escribe nada hasta que comparemos y decidamos pasarlos a lectura/escritura.
# Se puede correr de nuevo sin problema (actualiza lo que ya existe, no duplica).
set -uo pipefail

[ "$(id -u)" = 0 ] || { echo "Correlo con sudo: sudo bash $0"; exit 1; }

PRUEBAS=/srv/careador-arsa-test
PROD=/srv/careador-arsa
# sucursal | nombre del equipo | host:puerto (IP Cloud de la MikroTik → port-forward al lector)
LECTORES=(
  "Arsa 1|Lector Arsa 1|cc230e7e1e6e.sn.mynetname.net:1082"
  "Arsa 2|Lector Arsa 2|d5030cc700bd.sn.mynetname.net:1082"
)

cli() { # $1 = carpeta de la instancia; resto = comando del CLI (la entrada pasa al contenedor)
  local dir=$1; shift
  (cd "$dir" && docker compose exec -T app node dist/cli.js "$@")
}

esperar() { # espera a que la instancia responda después de recrearla
  local dir=$1
  for _ in $(seq 30); do
    (cd "$dir" && docker compose exec -T app node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))") 2>/dev/null && return 0
    sleep 2
  done
  echo "  !! $dir no respondió a tiempo"; return 1
}

echo "== 1/5 Versión"
sudo -u claude /opt/careador/deploy/actualizar.sh pruebas || { echo "No se pudo actualizar pruebas"; exit 1; }
esperar "$PRUEBAS"
INSTANCIAS=("$PRUEBAS")
read -rp "¿Paso PRODUCCIÓN a esta misma versión y cargo los lectores también ahí? [s/N] " r
if [[ $r =~ ^[sS] ]]; then
  sudo -u claude /opt/careador/deploy/actualizar.sh produccion || { echo "No se pudo actualizar producción"; exit 1; }
  esperar "$PROD"
  INSTANCIAS+=("$PROD")
else
  echo "  Producción queda como está; sólo se carga pruebas."
fi

echo
echo "== 2/5 Sucursales y horarios (L-V Arsa 1 9-18, Arsa 2 8-18; sábados 9-13; tolerancia 15 min)"
for dir in "${INSTANCIAS[@]}"; do
  (cd "$dir" && docker compose exec -T app node -) <<'JS'
const db = new (require('better-sqlite3'))('/data/careador.db');
const day = (start, end) => ({ start, end });
const week = (start, end) => JSON.stringify([null, ...Array(5).fill(day(start, end)), day('09:00', '13:00')]);
for (const [name, start, end] of [['Arsa 1', '09:00', '18:00'], ['Arsa 2', '08:00', '18:00']]) {
  let schedule = db.prepare('select id from schedules where name = ?').get(name);
  if (!schedule) {
    const id = db.prepare('insert into schedules (name, days, late_tolerance_min, early_tolerance_min) values (?, ?, 15, 15)').run(name, week(start, end)).lastInsertRowid;
    schedule = { id };
  }
  const site = db.prepare('select id, schedule_id from sites where name = ?').get(name);
  if (!site) db.prepare('insert into sites (name, schedule_id) values (?, ?)').run(name, schedule.id);
  else if (!site.schedule_id) db.prepare('update sites set schedule_id = ? where id = ?').run(schedule.id, site.id);
}
console.log('  ' + db.prepare("select group_concat(s.name || ' → ' || coalesce(h.name, 'sin horario'), ' · ') t from sites s left join schedules h on h.id = s.schedule_id").get().t);
JS
done

echo
echo "== 3/5 Usuario y contraseña de los lectores (no se muestran)"
declare -A USUARIO CLAVE
anterior=""
for l in "${LECTORES[@]}"; do
  IFS='|' read -r suc nom host <<<"$l"
  if [ -n "$anterior" ]; then
    read -rp "¿${nom} usa el mismo usuario y contraseña que ${anterior}? [S/n] " r
    if [[ ! $r =~ ^[nN] ]]; then USUARIO[$host]=${USUARIO[$prev_host]}; CLAVE[$host]=${CLAVE[$prev_host]}; anterior=$nom; prev_host=$host; continue; fi
  fi
  read -rp "Usuario de ${nom} [admin]: " u
  USUARIO[$host]=${u:-admin}
  read -rsp "Contraseña de ${nom}: " p; echo
  CLAVE[$host]=$p
  anterior=$nom; prev_host=$host
done

echo
echo "== 4/5 Historial de HikCentral (opcional)"
HIST=/home/claude/registros-hikcentral.xlsx # Claude deja ahí el que exportaste de HikCentral
echo "  Excel «Registros de entradas y salidas» de HikCentral. Otro archivo: poné la ruta; \"-\" = saltear."
read -rp "  Ruta [$HIST]: " excel
excel=${excel:-$HIST}
[ "$excel" = "-" ] && excel=""
if [ -n "$excel" ]; then
  if [ -f "$excel" ]; then
    for dir in "${INSTANCIAS[@]}"; do echo "  $dir"; cli "$dir" historial:importar - <"$excel"; done
  else
    echo "  No encuentro $excel; sigo sin el historial (se puede subir después desde Asistencia)."
  fi
fi

echo
echo "== 5/5 Lectores, personal, fotos y marcaciones"
for dir in "${INSTANCIAS[@]}"; do
  echo "--- $dir"
  for l in "${LECTORES[@]}"; do
    IFS='|' read -r suc nom host <<<"$l"
    printf '%s\n' "${CLAVE[$host]}" | cli "$dir" equipo:crear "$suc" "$nom" "$host" "${USUARIO[$host]}" --solo-lectura | sed '/^Contraseña de/s/^Contraseña de [^:]*: //'
  done
  cli "$dir" equipo:importar
  cli "$dir" marcaciones:leer
done
unset CLAVE

echo
echo "== Resumen"
for dir in "${INSTANCIAS[@]}"; do
  echo "--- $dir"
  cli "$dir" equipo:listar
done
echo
echo "Listo. Los lectores quedaron en SÓLO LECTURA en todas las instancias."
echo "Avisale a Claude para comparar lo que trajo con HikCentral."
