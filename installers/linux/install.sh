#!/usr/bin/env bash
# DeviceNet hub installer (Linux, Docker). One-liner: curl -fsSL <url>/install.sh | sudo -E bash
# Options: --dry-run (print actions only), --dir DIR (default /opt/devicenet), --device /dev/serial/by-id/..., --api-url URL
set -euo pipefail

DIR=/opt/devicenet; DRY=0; DEVICE=""; API_URL="${API_URL:-http://127.0.0.1:3000}"; SRC="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo .)"
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --dir) DIR="$2"; shift ;;
    --device) DEVICE="$2"; shift ;;
    --api-url) API_URL="$2"; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

act() { if [ "$DRY" = 1 ]; then echo "[dry-run] $*"; else echo "-> $*"; "$@"; fi; }

[ "$DRY" = 1 ] || [ "$(id -u)" = 0 ] || { echo "run as root (sudo)" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { [ "$DRY" = 1 ] && echo "[dry-run] docker missing: would stop here" || { echo "docker is required. Install docker first: curl -fsSL https://get.docker.com | sh" >&2; exit 1; }; }

# 1. Dedicated user (member of docker + dialout)
if ! id devicenet >/dev/null 2>&1; then act useradd --system --create-home --home-dir "$DIR" --shell /usr/sbin/nologin devicenet; fi
if getent group docker >/dev/null 2>&1; then act usermod -aG docker devicenet; fi
if getent group dialout >/dev/null 2>&1; then
  act usermod -aG dialout devicenet
else
  echo "WARNING: group 'dialout' not found; ensure devicenet user has read/write permission to serial USB devices ($DEVICE)" >&2
fi

# 2. Zigbee dongle: stable /dev/serial/by-id path (Sonoff: Silicon_Labs_CP210x / ZBDongle; CH9102: 1a86)
if [ -z "$DEVICE" ]; then
  DEVICE="$(ls /dev/serial/by-id/* 2>/dev/null | grep -Ei 'cp210|silicon_labs|1a86|zbdongle|sonoff|zigbee' | head -n1 || true)"
fi
if [ -z "$DEVICE" ]; then echo "WARNING: no Zigbee dongle under /dev/serial/by-id; edit $DIR/.env (ZIGBEE_DEVICE) later." >&2; DEVICE="/dev/serial/by-id/zigbee-dongle"; fi
echo "dongle: $DEVICE"

# 3. Files
act install -d -o devicenet -g devicenet "$DIR" "$DIR/data/mosquitto" "$DIR/data/z2m" "$DIR/data/hub"

# 3a. mosquitto.conf (from source or embedded fallback)
if [ -f "$SRC/mosquitto.conf" ]; then
  act install -m 0644 -o devicenet -g devicenet "$SRC/mosquitto.conf" "$DIR/mosquitto.conf"
elif [ "$DRY" = 1 ]; then
  echo "[dry-run] write $DIR/mosquitto.conf (embedded)"
else
  cat << 'EOF' > "$DIR/mosquitto.conf"
listener 1883
listener 9001
protocol websockets
allow_anonymous true
persistence true
persistence_location /mosquitto/data/
EOF
  chown devicenet:devicenet "$DIR/mosquitto.conf"; chmod 0644 "$DIR/mosquitto.conf"
fi

# 3b. docker-compose.yml (from source or embedded fallback)
if [ -f "$SRC/docker-compose.yml" ]; then
  act install -m 0644 -o devicenet -g devicenet "$SRC/docker-compose.yml" "$DIR/docker-compose.yml"
elif [ "$DRY" = 1 ]; then
  echo "[dry-run] write $DIR/docker-compose.yml (embedded)"
else
  cat << 'EOF' > "$DIR/docker-compose.yml"
services:
  mosquitto:
    image: eclipse-mosquitto:2.0.22
    restart: unless-stopped
    ports: ["1883:1883", "9001:9001"]
    volumes:
      - ./data/mosquitto:/mosquitto/data
      - ./mosquitto.conf:/mosquitto/config/mosquitto.conf:ro
  zigbee2mqtt:
    image: koenkk/zigbee2mqtt:2.14.2
    restart: unless-stopped
    depends_on: [mosquitto]
    environment:
      TZ: ${TZ:-Asia/Ho_Chi_Minh}
      ZIGBEE2MQTT_CONFIG_MQTT_SERVER: mqtt://mosquitto:1883
      ZIGBEE2MQTT_CONFIG_SERIAL_PORT: /dev/ttyACM0
      ZIGBEE2MQTT_CONFIG_FRONTEND_ENABLED: "false"
    volumes:
      - ./data/z2m:/app/data
    devices:
      - ${ZIGBEE_DEVICE:-/dev/serial/by-id/zigbee-dongle}:/dev/ttyACM0
  hub-agent:
    image: ${HUB_AGENT_IMAGE:-devicenet/hub-agent:latest}
    restart: unless-stopped
    depends_on: [mosquitto, zigbee2mqtt]
    ports: ["8080:8080"]
    environment:
      DN_DATA_DIR: /data
      DN_MOCK_Z2M: "0"
      DN_EXTERNAL_SERVICES: "1"
      DN_MQTT_HOST: mosquitto
      DN_API_BASE_URL: ${DN_API_BASE_URL:-http://127.0.0.1:3000}
    volumes:
      - ./data/hub:/data
EOF
  chown devicenet:devicenet "$DIR/docker-compose.yml"; chmod 0644 "$DIR/docker-compose.yml"
fi

# 3c. .env configuration
if [ "$DRY" = 1 ]; then
  echo "[dry-run] write $DIR/.env (ZIGBEE_DEVICE=$DEVICE, DN_API_BASE_URL=$API_URL)"
else
  printf 'ZIGBEE_DEVICE=%s\nTZ=Asia/Ho_Chi_Minh\nDN_API_BASE_URL=%s\n' "$DEVICE" "$API_URL" > "$DIR/.env"
  chown devicenet:devicenet "$DIR/.env"; chmod 0600 "$DIR/.env"
fi

# 4. systemd service (from source or embedded fallback)
if [ -f "$SRC/devicenet.service" ]; then
  act install -m 0644 "$SRC/devicenet.service" /etc/systemd/system/devicenet.service
elif [ "$DRY" = 1 ]; then
  echo "[dry-run] write /etc/systemd/system/devicenet.service (embedded)"
else
  cat << 'EOF' > /etc/systemd/system/devicenet.service
[Unit]
Description=DeviceNet hub (docker compose: mosquitto, zigbee2mqtt, hub-agent)
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
User=devicenet
Group=devicenet
WorkingDirectory=/opt/devicenet
ExecStart=/usr/bin/docker compose up -d --remove-orphans
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF
  chmod 0644 /etc/systemd/system/devicenet.service
fi

act systemctl daemon-reload
act systemctl enable --now devicenet.service
echo "Done. Open http://localhost:8080/setup"
LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
if [ -n "$LAN_IP" ]; then
  echo "Or from other devices on LAN: http://${LAN_IP}:8080/setup"
fi
