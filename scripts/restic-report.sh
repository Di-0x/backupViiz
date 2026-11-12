#!/bin/sh
# restic-report.sh — remonte l'état réel d'une sauvegarde restic vers BackupViiz.
#
# Usage :
#   restic-report.sh                          # lit `restic snapshots --json`, reporte "ok"
#   restic-report.sh -- restic backup /data   # exécute la commande puis reporte ok/failed
#
# Variables d'environnement :
#   BACKUPVIIZ_URL        (requis)  URL de BackupViiz, ex. https://backup.example.com
#   BACKUPVIIZ_TOKEN      (requis)  jeton API (bvk_…), créé dans « Mon compte »
#   BACKUPVIIZ_STRATEGY   (requis)  identifiant de la stratégie
#   BACKUPVIIZ_NODE       identifiant du nœud (prioritaire sur BACKUPVIIZ_HOST)
#   BACKUPVIIZ_HOST       nom d'hôte du nœud (défaut : `hostname`)
#   RESTIC_SNAPSHOTS_ARGS arguments de `restic snapshots` (défaut : --latest 1)
#   RESTIC_REPOSITORY, RESTIC_PASSWORD_FILE… : déjà lus par restic.
# Le jeton n'est jamais écrit sur la sortie ni dans la ligne de commande de curl.
set -eu

die() { printf 'restic-report: %s\n' "$*" >&2; exit 2; }

[ "${1:-}" = "--" ] && shift

: "${BACKUPVIIZ_URL:?BACKUPVIIZ_URL est requis}"
: "${BACKUPVIIZ_TOKEN:?BACKUPVIIZ_TOKEN est requis}"
: "${BACKUPVIIZ_STRATEGY:?BACKUPVIIZ_STRATEGY est requis}"
command -v curl >/dev/null 2>&1 || die "curl est introuvable"

base="${BACKUPVIIZ_URL%/}/api/ingest/${BACKUPVIIZ_STRATEGY}"
if [ -n "${BACKUPVIIZ_NODE:-}" ]; then
  endpoint="$base/${BACKUPVIIZ_NODE}"
else
  endpoint="$base/by-hostname/${BACKUPVIIZ_HOST:-$(hostname)}"
fi

status=ok
rc=0
message=""
if [ "$#" -gt 0 ]; then
  if "$@"; then :; else
    rc=$?
    status=failed
    message="La commande a échoué (code $rc)"
  fi
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp" "$tmp.snap"' EXIT HUP INT TERM

snapshots=""
# shellcheck disable=SC2086
if restic snapshots --json ${RESTIC_SNAPSHOTS_ARGS:---latest 1} >"$tmp.snap" 2>/dev/null && [ -s "$tmp.snap" ]; then
  snapshots="$(cat "$tmp.snap")"
elif [ "$status" = ok ]; then
  status=failed
  message="Lecture des snapshots restic impossible"
fi

# échappement JSON minimal du message
message="$(printf '%s' "$message" | sed 's/\\/\\\\/g; s/"/\\"/g')"
{
  printf '{"tool":"restic","status":"%s"' "$status"
  [ -n "$message" ] && printf ',"message":"%s"' "$message"
  [ -n "$snapshots" ] && printf ',"snapshots":%s' "$snapshots"
  printf '}'
} >"$tmp"

# l'en-tête passe par stdin (-K -) : le jeton n'apparaît pas dans `ps`
if printf 'header = "Authorization: Bearer %s"\n' "$BACKUPVIIZ_TOKEN" |
  curl --fail -sS -K - -X POST -H 'Content-Type: application/json' --data-binary "@$tmp" "$endpoint" >/dev/null; then
  printf 'restic-report: statut « %s » transmis à BackupViiz\n' "$status"
else
  c=$?
  printf 'restic-report: échec de l’envoi vers BackupViiz (curl %s)\n' "$c" >&2
  [ "$rc" -ne 0 ] && exit "$rc"
  exit "$c"
fi
[ "$rc" -ne 0 ] && exit "$rc"
[ "$status" = ok ] || exit 1
exit 0
