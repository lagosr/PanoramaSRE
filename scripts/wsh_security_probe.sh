#!/bin/bash
# PanoramaSRE Stateless Read-Only 360 Security Probe for Web Services Host (WSH)
set -u

HOURS=6
while [ "$#" -gt 0 ]; do
  case "$1" in
    --hours)
      if [ "$#" -ge 2 ]; then
        HOURS="$2"
        shift 2
        continue
      fi
      ;;
  esac
  shift
done

if ! printf '%s' "$HOURS" | grep -Eq '^[0-9]+$'; then
  HOURS=6
fi
if [ "$HOURS" -lt 1 ]; then
  HOURS=1
fi
if [ "$HOURS" -gt 168 ]; then
  HOURS=168
fi

json_escape() {
  awk 'BEGIN {RS=""; ORS=""} {gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); gsub(/\r/, ""); gsub(/\t/, "\\t"); gsub(/\n/, "\\n"); print}'
}

json_clean_escape() {
  tr -d '\000-\010\013\014\016-\037' | json_escape
}

HOSTNAME_VAL=$(hostname 2>/dev/null || echo "wsh")
CAPTURED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "")

# 1. Read-only PanoramaAuth SQLite security anomalies & audit logs
AUTH_DB="/var/data/panorama-auth/data/auth.sqlite"
AUTH_JSON='{"available":false,"anomalies":[],"audit_logs":[],"quarantined_users":0,"locked_users":0,"active_sessions":[]}'
if [ -f "$AUTH_DB" ] && command -v python3 >/dev/null 2>&1; then
  AUTH_JSON=$(python3 - "$AUTH_DB" "$HOURS" 2>/dev/null <<'PYEOF'
import json, sqlite3, sys

db_path = sys.argv[1]
hours = int(sys.argv[2])
out = {
    "available": True,
    "anomalies": [],
    "audit_logs": [],
    "quarantined_users": 0,
    "locked_users": 0,
    "active_sessions": []
}
try:
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=3.0)
    conn.row_factory = sqlite3.Row
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    modifier = f"-{hours} hours"

    if "security_anomalies" in tables:
        rows = conn.execute(
            "SELECT id, user_id, rule_id, severity, ip_address, substr(coalesce(details,''),1,300) AS details, action_taken, created_at "
            "FROM security_anomalies WHERE created_at >= datetime('now', ?) ORDER BY created_at DESC LIMIT 100",
            (modifier,)
        ).fetchall()
        out["anomalies"] = [dict(r) for r in rows]

    if "audit_logs" in tables:
        rows = conn.execute(
            "SELECT id, user_id, action, status, ip_address, substr(coalesce(user_agent,''),1,160) AS user_agent, "
            "substr(coalesce(details,''),1,260) AS details, created_at "
            "FROM audit_logs WHERE created_at >= datetime('now', ?) ORDER BY created_at DESC LIMIT 150",
            (modifier,)
        ).fetchall()
        out["audit_logs"] = [dict(r) for r in rows]

    if "users" in tables:
        q = conn.execute("SELECT COUNT(*) FROM users WHERE quarantined_at IS NOT NULL OR is_active = 0").fetchone()[0]
        l = conn.execute("SELECT COUNT(*) FROM users WHERE lockout_until IS NOT NULL AND lockout_until > datetime('now')").fetchone()[0]
        out["quarantined_users"] = int(q or 0)
        out["locked_users"] = int(l or 0)

    if "active_sessions" in tables:
        rows = conn.execute(
            "SELECT s.id, s.user_id, u.email, s.ip_address, s.device_name, s.device_type, s.last_active_at, s.created_at "
            "FROM active_sessions s LEFT JOIN users u ON s.user_id = u.id "
            "WHERE s.expires_at > datetime('now') ORDER BY s.last_active_at DESC LIMIT 50"
        ).fetchall()
        out["active_sessions"] = [dict(r) for r in rows]

    conn.close()
except Exception as exc:
    out["available"] = False
    out["error"] = str(exc)[:200]

print(json.dumps(out))
PYEOF
  )
  [ -z "$AUTH_JSON" ] && AUTH_JSON='{"available":false,"anomalies":[],"audit_logs":[],"quarantined_users":0,"locked_users":0,"active_sessions":[]}'
fi

# 2. Host SSH Auth logs
SSH_RAW=""
if command -v journalctl >/dev/null 2>&1; then
  SSH_RAW=$(journalctl -u ssh -u sshd --since "${HOURS} hours ago" --no-pager -n 150 --output=short-iso 2>/dev/null | json_clean_escape)
fi
if [ -z "$SSH_RAW" ] && [ -f /var/log/auth.log ]; then
  SSH_RAW=$(tail -n 150 /var/log/auth.log 2>/dev/null | json_clean_escape)
fi

# 3. Lighttpd error & anomalous access logs
LIGHTTPD_ERR_RAW=""
if [ -f /var/log/lighttpd/error.log ]; then
  LIGHTTPD_ERR_RAW=$(tail -n 100 /var/log/lighttpd/error.log 2>/dev/null | json_clean_escape)
fi

LIGHTTPD_ANOM_RAW=""
if [ -f /var/log/lighttpd/access.log ]; then
  LIGHTTPD_ANOM_RAW=$(tail -n 2000 /var/log/lighttpd/access.log 2>/dev/null | grep -E ' (401|403|404|500|502|503) |/api/admin|/auth/|/\.env|/\.git|wp-login' | tail -n 150 | json_clean_escape)
fi

# 4. Docker container health summary
CONTAINERS_JSON=$(docker ps -a --format '{{json .}}' 2>/dev/null | paste -sd "," - || echo "")

# 5. Netfilter firewall drop counters
IPTABLES_DOCKER=$(iptables -L DOCKER-USER -v -n --line-numbers 2>/dev/null | head -n 40 | json_clean_escape)
IPTABLES_INPUT=$(iptables -L PANORAMA-INPUT -v -n --line-numbers 2>/dev/null | head -n 40 | json_clean_escape)

# 6. Optional UniFi SIEM CEF NDJSON collector (/var/data/unifi-siem/unifi-siem.log)
UNIFI_SIEM_FILE="/var/data/unifi-siem/unifi-siem.log"
UNIFI_SIEM_PRESENT="false"
UNIFI_SIEM_LINES=""
if [ -f "$UNIFI_SIEM_FILE" ]; then
  UNIFI_SIEM_PRESENT="true"
  UNIFI_SIEM_LINES=$(tail -n 250 "$UNIFI_SIEM_FILE" 2>/dev/null | json_clean_escape)
fi

cat <<EOF
{
  "hostname": "${HOSTNAME_VAL}",
  "captured_at": "${CAPTURED_AT}",
  "hours": ${HOURS},
  "panorama_auth": ${AUTH_JSON},
  "ssh_logs_raw": "${SSH_RAW}",
  "lighttpd_error_raw": "${LIGHTTPD_ERR_RAW}",
  "lighttpd_anomalous_raw": "${LIGHTTPD_ANOM_RAW}",
  "containers": [${CONTAINERS_JSON}],
  "iptables_docker_user_raw": "${IPTABLES_DOCKER}",
  "iptables_panorama_input_raw": "${IPTABLES_INPUT}",
  "unifi_siem_present": ${UNIFI_SIEM_PRESENT},
  "unifi_siem_ndjson_raw": "${UNIFI_SIEM_LINES}"
}
EOF
