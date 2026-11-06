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

# Reboot required: check standard reboot-required flag OR check if installed Linux kernel differs from running kernel
REBOOT_REQ="false"
if [ -f /var/run/reboot-required ] || [ -f /run/reboot-required ]; then
  REBOOT_REQ="true"
else
  LATEST_INST_KERNEL=$(dpkg -l 2>/dev/null | grep -E '^ii  linux-image-[0-9]' | awk '{print $2}' | sed 's/linux-image-//' | sort -V | tail -n 1)
  if [ -n "$LATEST_INST_KERNEL" ] && [ -n "$KERNEL_VAL" ] && [ "$LATEST_INST_KERNEL" != "$KERNEL_VAL" ]; then
    REBOOT_REQ="true"
  fi
fi

THROTTLED=$( command -v vcgencmd >/dev/null 2>&1 && vcgencmd get_throttled 2>/dev/null | cut -d= -f2 | tr -d '\n\r' || echo "0x0" )
SVC_LIGHTTPD=$(systemctl is-active lighttpd 2>/dev/null || echo "unknown")
SVC_DOCKER=$(systemctl is-active docker 2>/dev/null || echo "unknown")
SVC_SSH=$(systemctl is-active ssh 2>/dev/null || echo "unknown")

# Listening local ports (comma-separated integers)
LISTEN_PORTS=$(ss -tlnH 2>/dev/null | awk '{print $4}' | awk -F: '{print $NF}' | grep -E '^[0-9]+$' | sort -nu | paste -sd "," - || echo "")

# Lighttpd proxy blocks: slug:port pairs
PROXY_ROUTES=$(sed -n 's/.*HTTP\["url"\].*"^\/\([a-zA-Z0-9_-]*\).*/\1/p; s/.*"port"[[:space:]]*=>[[:space:]]*\([0-9]*\).*/:\1/p' /etc/lighttpd/lighttpd.conf 2>/dev/null | tr -d '\r' | paste - - | awk '{printf "%s%s,", $1, $2}' | sed 's/,$//')

# Docker containers JSON array
CONTAINERS_JSON=$(docker ps -a --format '{{json .}}' 2>/dev/null | paste -sd "," - || echo "")
# Docker stats (non-streaming 1-shot)
STATS_JSON=$(docker stats --no-stream --format '{{json .}}' 2>/dev/null | paste -sd "," - || echo "")
# Local Docker images for rollback verification
IMAGES_JSON=$(docker images --format '{{json .}}' 2>/dev/null | paste -sd "," - || echo "")

# Docker networks JSON inspect
DOCKER_NET_IDS=$(docker network ls -q 2>/dev/null)
DOCKER_NETS_JSON="[]"
if [ -n "$DOCKER_NET_IDS" ]; then
  INSPECT_OUT=$(docker network inspect $DOCKER_NET_IDS 2>/dev/null | tr -d '\r')
  if [ -n "$INSPECT_OUT" ]; then
    DOCKER_NETS_JSON="$INSPECT_OUT"
  fi
fi

# Network interfaces (iproute2 JSON)
IFACES_JSON=$(ip -j addr 2>/dev/null | tr -d '\r')
[ -z "$IFACES_JSON" ] && IFACES_JSON="[]"

# Kernel IP routes
ROUTES_JSON=$(ip -j route 2>/dev/null | tr -d '\r')
[ -z "$ROUTES_JSON" ] && ROUTES_JSON="[]"

# Listening sockets full detail
LISTEN_SOCKETS=$(ss -tulpnH 2>/dev/null | json_escape || echo "")

# Cloudflared recent status lines
CF_VERSION=$(docker exec cloudflared cloudflared --version 2>/dev/null | head -n 1 | json_escape || echo "")
CF_LOGS=$(docker logs --tail 25 cloudflared 2>&1 | json_escape || echo "")

# APT upgradable list (captured in all modes to ensure real-time accuracy)
APT_LINES=$(apt list --upgradable 2>/dev/null | tail -n +2 | json_escape || echo "")

# Full-mode heavy checks (volume sizes, docker system df)
VOLUMES_LINES=""
DOCKER_DF_JSON=""
if [ "$MODE" = "--full" ]; then
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
  "docker_networks": ${DOCKER_NETS_JSON},
  "network_interfaces": ${IFACES_JSON},
  "network_routes": ${ROUTES_JSON},
  "listening_sockets_raw": "${LISTEN_SOCKETS}",
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
