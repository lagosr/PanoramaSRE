#!/bin/bash
# PanoramaSRE Stateless Read-Only Host, Docker, Lighttpd & Release Ledger Probe
MODE="${1:---fast}"

json_escape() {
  awk 'BEGIN {RS=""; ORS=""} {gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); gsub(/\r/, ""); gsub(/\t/, "\\t"); gsub(/\n/, "\\n"); print}'
}

HOSTNAME_VAL=$(hostname 2>/dev/null || echo "wsh")
KERNEL_VAL=$(uname -r 2>/dev/null || echo "unknown")
UPTIME_SECS=$(awk '{print $1}' /proc/uptime 2>/dev/null || echo "0")
DIETPI_VER=$( [ -f /boot/dietpi/.version ] && awk -F= '/G_DIETPI_VERSION_CORE/{c=$2} /G_DIETPI_VERSION_SUB/{s=$2} /G_DIETPI_VERSION_RC/{r=$2} END{printf "%s.%s.%s", c, s, r}' /boot/dietpi/.version || echo "unknown" )
DIETPI_AVAIL=$( [ -f /run/dietpi/.update_available ] && cat /run/dietpi/.update_available | tr -d '\n\r' || echo "" )
REBOOT_REQ=$( [ -f /var/run/reboot-required ] && echo "true" || echo "false" )
THROTTLED=$( command -v vcgencmd >/dev/null 2>&1 && vcgencmd get_throttled 2>/dev/null | cut -d= -f2 | tr -d '\n\r' || echo "0x0" )
SVC_LIGHTTPD=$(systemctl is-active lighttpd 2>/dev/null || echo "unknown")
SVC_DOCKER=$(systemctl is-active docker 2>/dev/null || echo "unknown")
SVC_SSH=$(systemctl is-active ssh 2>/dev/null || echo "unknown")

# Listening local ports (comma-separated integers)
LISTEN_PORTS=$(ss -tlnH 2>/dev/null | awk '{print $4}' | awk -F: '{print $NF}' | grep -E '^[0-9]+$' | sort -nu | paste -sd "," - || echo "")

# Lighttpd proxy blocks: slug:port pairs
PROXY_ROUTES=$(awk '
  /\$HTTP\["url"\]\s*=~\s*"\^\/[a-zA-Z0-9_-]+"/ {
    match($0, /\^\/[a-zA-Z0-9_-]+/);
    slug = substr($0, RSTART+2, RLENGTH-2);
  }
  slug != "" && /"port"\s*=>\s*[0-9]+/ {
    match($0, /"port"\s*=>\s*[0-9]+/);
    pstr = substr($0, RSTART, RLENGTH);
    sub(/.*=>\s*/, "", pstr);
    printf "%s:%s,", slug, pstr;
    slug = "";
  }
' /etc/lighttpd/lighttpd.conf /etc/lighttpd/conf-enabled/*.conf 2>/dev/null | sed 's/,$//')

# Docker containers JSON array
CONTAINERS_JSON=$(docker ps -a --format '{{json .}}' 2>/dev/null | paste -sd "," - || echo "")
# Docker stats (non-streaming 1-shot)
STATS_JSON=$(docker stats --no-stream --format '{{json .}}' 2>/dev/null | paste -sd "," - || echo "")
# Local Docker images for rollback verification
IMAGES_JSON=$(docker images --format '{{json .}}' 2>/dev/null | paste -sd "," - || echo "")

# Cloudflared recent status lines
CF_VERSION=$(docker exec cloudflared cloudflared --version 2>/dev/null | head -n 1 | json_escape || echo "")
CF_LOGS=$(docker logs --tail 25 cloudflared 2>&1 | json_escape || echo "")

# Full-mode heavy checks (APT upgradable list, volume sizes, release ledgers)
APT_LINES=""
VOLUMES_LINES=""
DOCKER_DF_JSON=""
if [ "$MODE" = "--full" ]; then
  APT_LINES=$(apt list --upgradable 2>/dev/null | tail -n +2 | json_escape || echo "")
  VOLUMES_LINES=$(du -sb /var/data/* 2>/dev/null | json_escape || echo "")
  DOCKER_DF_JSON=$(docker system df --format '{{json .}}' 2>/dev/null | paste -sd "," - || echo "")
fi

# Latest entry per app from /var/data/*/releases.json (fast read)
RELEASE_LEDGERS="{"
FIRST_REL=1
for f in /var/data/*/releases.json; do
  if [ -f "$f" ]; then
    APP_DIR=$(basename "$(dirname "$f")")
    CONTENT=$(cat "$f" 2>/dev/null)
    if [ -n "$CONTENT" ]; then
      [ "$FIRST_REL" -eq 0 ] && RELEASE_LEDGERS="${RELEASE_LEDGERS},"
      RELEASE_LEDGERS="${RELEASE_LEDGERS}\"${APP_DIR}\":${CONTENT}"
      FIRST_REL=0
    fi
  fi
done
RELEASE_LEDGERS="${RELEASE_LEDGERS}}"

cat <<EOF
{
  "mode": "${MODE}",
  "hostname": "${HOSTNAME_VAL}",
  "kernel": "${KERNEL_VAL}",
  "uptime_secs": ${UPTIME_SECS:-0},
  "dietpi_version": "${DIETPI_VER}",
  "dietpi_update_available": "${DIETPI_AVAIL}",
  "reboot_required": ${REBOOT_REQ},
  "rpi_throttled": "${THROTTLED}",
  "services": {
    "lighttpd": "${SVC_LIGHTTPD}",
    "docker": "${SVC_DOCKER}",
    "ssh": "${SVC_SSH}"
  },
  "listening_ports": [${LISTEN_PORTS}],
  "lighttpd_routes_raw": "${PROXY_ROUTES}",
  "containers": [${CONTAINERS_JSON}],
  "container_stats": [${STATS_JSON}],
  "images": [${IMAGES_JSON}],
  "cloudflared": {
    "version_raw": "${CF_VERSION}",
    "recent_logs": "${CF_LOGS}"
  },
  "apt_upgradable_raw": "${APT_LINES}",
  "data_volumes_raw": "${VOLUMES_LINES}",
  "docker_df": [${DOCKER_DF_JSON}],
  "release_ledgers": ${RELEASE_LEDGERS}
}
EOF
