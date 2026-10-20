#!/usr/bin/env bash
# DeviceNet hub installer (Linux, Docker). One-liner: curl -fsSL <url>/install.sh | sudo bash
# Options: --dry-run (print actions only), --dir DIR (default /opt/devicenet), --device /dev/serial/by-id/...
set -euo pipefail

DIR=/opt/devicenet; DRY=0; DEVICE=""; SRC="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo .)"
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --dir) DIR="$2"; shift ;;
    --device) DEVICE="$2"; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

act() { if [ "$DRY" = 1 ]; then echo "[dry-run] $*"; else echo "-> $*"; "$@"; fi; }

[ "$DRY" = 1 ] || [ "$(id -u)" = 0 ] || { echo "run as root (sudo)" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { [ "$DRY" = 1 ] && echo "[dry-run] docker missing: would stop here" || { echo "docker is required" >&2; exit 1; }; }

# 1. Dedicated user (member of docker + dialout)
if ! id devicenet >/dev/null 2>&1; then act useradd --system --create-home --home-dir "$DIR" --shell /usr/sbin/nologin devicenet; fi
for g in docker dialout; do getent group "$g" >/dev/null 2>&1 && act usermod -aG "$g" devicenet || true; done

# 2. Zigbee dongle: stable /dev/serial/by-id path (Sonoff: Silicon_Labs_CP210x / ZBDongle; CH9102: 1a86)
if [ -z "$DEVICE" ]; then
  DEVICE="$(ls /dev/serial/by-id/* 2>/dev/null | grep -Ei 'cp210|silicon_labs|1a86|zbdongle|sonoff|zigbee' | head -n1 || true)"
fi
if [ -z "$DEVICE" ]; then echo "WARNING: no Zigbee dongle under /dev/serial/by-id; edit $DIR/.env (ZIGBEE_DEVICE) later." >&2; DEVICE="/dev/serial/by-id/zigbee-dongle"; fi
echo "dongle: $DEVICE"

# 3. Files
act install -d -o devicenet -g devicenet "$DIR" "$DIR/data/mosquitto" "$DIR/data/z2m" "$DIR/data/hub"
for f in docker-compose.yml mosquitto.conf; do act install -m 0644 -o devicenet -g devicenet "$SRC/$f" "$DIR/$f"; done
if [ "$DRY" = 1 ]; then echo "[dry-run] write $DIR/.env (ZIGBEE_DEVICE=$DEVICE)"; else
  printf 'ZIGBEE_DEVICE=%s\nTZ=Asia/Ho_Chi_Minh\n' "$DEVICE" > "$DIR/.env"; chown devicenet:devicenet "$DIR/.env"
fi

# 4. systemd
act install -m 0644 "$SRC/devicenet.service" /etc/systemd/system/devicenet.service
act systemctl daemon-reload
act systemctl enable --now devicenet.service
echo "Done. Open http://localhost:8080/setup"
LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
if [ -n "$LAN_IP" ]; then
  echo "Or from other devices on LAN: http://${LAN_IP}:8080/setup"
fi
