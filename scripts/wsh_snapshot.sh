#!/bin/bash
# PanoramaSRE Stateless Read-Only Host, Docker, Lighttpd & Release Ledger Probe
MODE="${1:---fast}"

json_escape() {
  awk 'BEGIN {RS=""; ORS=""} {gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); gsub(/\r/, ""); gsub(/\t/, "\\t"); gsub(/\n/, "\\n"); print}'
}

json_clean_escape() {
  tr -d '\000-\010\013\014\016-\037' | json_escape
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
SVC_CRON=$(systemctl is-active cron 2>/dev/null || echo "unknown")

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

# Firewall rules (DOCKER-USER and PANORAMA-INPUT chains)
FIREWALL_RULES=$(iptables -S 2>/dev/null | json_escape || echo "")

# Docker daemon config
DOCKER_DAEMON_JSON=$(cat /etc/docker/daemon.json 2>/dev/null | json_escape || echo "")

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

# Host /etc/cron.d/* inventory (excluding system .placeholder and directories)
CRON_D_JSON="["
FIRST_CRON_F=1
for f in /etc/cron.d/*; do
  [ -f "$f" ] || continue
  BASE_NAME=$(basename "$f")
  [ "$BASE_NAME" = ".placeholder" ] && continue
  C_MODE=$(stat -c '%a' "$f" 2>/dev/null || echo "")
  C_OWNER=$(stat -c '%U:%G' "$f" 2>/dev/null || echo "")
  C_CRLF="false"
  grep -q $'\r' "$f" 2>/dev/null && C_CRLF="true"
  C_NL="false"
  if [ ! -s "$f" ] || [ "$(tail -c 1 "$f" 2>/dev/null | od -An -tx1 | tr -d ' \n')" = "0a" ]; then
    C_NL="true"
  fi
  C_SHA=$(sha256sum "$f" 2>/dev/null | awk '{print $1}' || echo "")
  C_RAW=$(cat "$f" 2>/dev/null | json_clean_escape)
  NAME_ESC=$(printf '%s' "$BASE_NAME" | json_clean_escape)
  [ "$FIRST_CRON_F" -eq 0 ] && CRON_D_JSON="${CRON_D_JSON},"
  CRON_D_JSON="${CRON_D_JSON}{\"name\":\"${NAME_ESC}\",\"mode\":\"${C_MODE}\",\"owner\":\"${C_OWNER}\",\"has_crlf\":${C_CRLF},\"ends_with_newline\":${C_NL},\"content_sha256\":\"${C_SHA}\",\"content_raw\":\"${C_RAW}\"}"
  FIRST_CRON_F=0
done
CRON_D_JSON="${CRON_D_JSON}]"

# App cron scripts inventory (/opt/*/scripts/*.sh)
APP_SCRIPTS_JSON="["
FIRST_CRON_S=1
for s in /opt/*/scripts/*.sh; do
  [ -f "$s" ] || continue
  S_DIR=$(basename "$(dirname "$(dirname "$s")")")
  S_NAME=$(basename "$s")
  S_MODE=$(stat -c '%a' "$s" 2>/dev/null || echo "")
  S_OWNER=$(stat -c '%U:%G' "$s" 2>/dev/null || echo "")
  S_CRLF="false"
  grep -q $'\r' "$s" 2>/dev/null && S_CRLF="true"
  S_SHA=$(sha256sum "$s" 2>/dev/null | awk '{print $1}' || echo "")
  S_SYNTAX="false"
  if head -n 1 "$s" 2>/dev/null | grep -qi 'bash'; then
    bash -n "$s" >/dev/null 2>&1 && S_SYNTAX="true"
  else
    sh -n "$s" >/dev/null 2>&1 && S_SYNTAX="true"
  fi
  DIR_ESC=$(printf '%s' "$S_DIR" | json_clean_escape)
  SNAME_ESC=$(printf '%s' "$S_NAME" | json_clean_escape)
  SPATH_ESC=$(printf '%s' "$s" | json_clean_escape)
  [ "$FIRST_CRON_S" -eq 0 ] && APP_SCRIPTS_JSON="${APP_SCRIPTS_JSON},"
  APP_SCRIPTS_JSON="${APP_SCRIPTS_JSON}{\"app_dir\":\"${DIR_ESC}\",\"script_name\":\"${SNAME_ESC}\",\"path\":\"${SPATH_ESC}\",\"mode\":\"${S_MODE}\",\"owner\":\"${S_OWNER}\",\"has_crlf\":${S_CRLF},\"sha256\":\"${S_SHA}\",\"syntax_ok\":${S_SYNTAX}}"
  FIRST_CRON_S=0
done
APP_SCRIPTS_JSON="${APP_SCRIPTS_JSON}]"

# Recent host cron execution telemetry (scrubbed again in Rust via scrubber::scrub_secrets)
CRON_RECENT_RUNS=$(journalctl -u cron --no-pager -n 30 --output=short-iso 2>/dev/null | json_clean_escape)
if [ -z "$CRON_RECENT_RUNS" ] && [ -f /var/log/syslog ]; then
  CRON_RECENT_RUNS=$(grep -i cron /var/log/syslog 2>/dev/null | tail -n 30 | json_clean_escape)
fi

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
    "ssh": "${SVC_SSH}",
    "cron": "${SVC_CRON}"
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
  "firewall_rules_raw": "${FIREWALL_RULES}",
  "docker_daemon_raw": "${DOCKER_DAEMON_JSON}",
  "cloudflared": {
    "version_raw": "${CF_VERSION}",
    "recent_logs": "${CF_LOGS}"
  },
  "cron_telemetry": {
    "cron_d_files": ${CRON_D_JSON},
    "app_scripts": ${APP_SCRIPTS_JSON},
    "recent_runs_raw": "${CRON_RECENT_RUNS}"
  },
  "apt_upgradable_raw": "${APT_LINES}",
  "data_volumes_raw": "${VOLUMES_LINES}",
  "docker_df": [${DOCKER_DF_JSON}],
  "release_ledgers": ${RELEASE_LEDGERS}
}
EOF
