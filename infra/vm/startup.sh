#!/usr/bin/env bash
# DeviceNet EMQX + Caddy VM Startup Script (GCP Compute Engine)
# Idempotent startup and bootstrap script.
set -euo pipefail

# Redirect stdout and stderr to both console and logfile
exec > >(tee -a /var/log/devicenet-startup.log) 2>&1
echo "=== DeviceNet VM Startup Initiated: $(date -u) ==="

# 1. Configure Swap (Crucial for stability on e2-micro / e2-small instances)
if ! swapon --show | grep -q "/swapfile"; then
  echo "Creating 1GB swapfile..."
  if [ ! -f /swapfile ]; then
    fallocate -l 1G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=1024
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile
  if ! grep -q "/swapfile" /etc/fstab; then
    echo "/swapfile none swap sw 0 0" >> /etc/fstab
  fi
  echo "Swap configured successfully."
fi

# 2. Update packages and install dependencies
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  docker.io \
  docker-compose-plugin \
  certbot \
  curl \
  jq \
  gettext-base \
  openssl

# Enable and start Docker
systemctl enable --now docker

# 3. Create deployment directories
DEPLOY_DIR="/opt/devicenet"
mkdir -p "${DEPLOY_DIR}/certs"
mkdir -p "${DEPLOY_DIR}/scripts"

# 4. Discover VM External IP and fetch Secrets / Metadata
METADATA_HEADER="Metadata-Flavor: Google"
VM_EXTERNAL_IP=$(curl -s -f -H "${METADATA_HEADER}" "http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip" || echo "")

fetch_secret() {
  local secret_name="$1"
  local fallback="$2"
  local val
  val=$(gcloud secrets versions access latest --secret="${secret_name}" 2>/dev/null || true)
  if [ -z "${val}" ]; then
    echo "${fallback}"
  else
    echo "${val}"
  fi
}

FIREBASE_PROJECT_ID=$(fetch_secret "firebase-project-id" "demo-devicenet")
EMQX_SHARED_TOKEN=$(fetch_secret "emqx-shared-token" "devicenet-shared-token-at-least-32-chars")
API_URL=$(fetch_secret "api-url" "https://api-${FIREBASE_PROJECT_ID}.a.run.app")
MQTT_DOMAIN=$(fetch_secret "mqtt-domain" "${VM_EXTERNAL_IP}.sslip.io")
ADMIN_EMAIL=$(fetch_secret "admin-email" "admin@${MQTT_DOMAIN}")

echo "Configured parameters:"
echo "- VM External IP: ${VM_EXTERNAL_IP}"
echo "- MQTT Domain: ${MQTT_DOMAIN}"
echo "- Firebase Project ID: ${FIREBASE_PROJECT_ID}"
echo "- API URL: ${API_URL}"

# 5. Obtain TLS Certificates via Certbot Standalone
CERT_DIR="/etc/letsencrypt/live/${MQTT_DOMAIN}"
if [ ! -f "${CERT_DIR}/fullchain.pem" ]; then
  echo "Requesting TLS certificate via Certbot for ${MQTT_DOMAIN}..."
  # Certbot standalone uses port 80 (HTTP-01 challenge)
  if certbot certonly --standalone \
      --non-interactive \
      --agree-tos \
      --register-unsafely-without-email \
      -d "${MQTT_DOMAIN}"; then
    echo "Certbot certificate acquired successfully."
  else
    echo "WARNING: Certbot standalone failed (DNS may not be ready or rate-limited)."
    echo "Generating temporary self-signed certificate to allow services to start..."
    mkdir -p "${CERT_DIR}"
    openssl req -x509 -nodes -days 30 -newkey rsa:2048 \
      -keyout "${CERT_DIR}/privkey.pem" \
      -out "${CERT_DIR}/fullchain.pem" \
      -subj "/CN=${MQTT_DOMAIN}"
  fi
fi

# 6. Create Cert Deploy Hook Script
cat > "${DEPLOY_DIR}/scripts/deploy-certs.sh" << 'EOF'
#!/usr/bin/env bash
set -euo pipefail
DEPLOY_DIR="/opt/devicenet"
DOMAIN="${1:-}"

if [ -z "${DOMAIN}" ]; then
  if [ -f "${DEPLOY_DIR}/.env" ]; then
    DOMAIN=$(grep '^MQTT_DOMAIN=' "${DEPLOY_DIR}/.env" | cut -d '=' -f2)
  fi
fi

SRC_DIR="/etc/letsencrypt/live/${DOMAIN}"
if [ -f "${SRC_DIR}/fullchain.pem" ]; then
  cp -L "${SRC_DIR}/fullchain.pem" "${DEPLOY_DIR}/certs/fullchain.pem"
  cp -L "${SRC_DIR}/privkey.pem" "${DEPLOY_DIR}/certs/privkey.pem"
  chmod 644 "${DEPLOY_DIR}/certs/fullchain.pem"
  chmod 600 "${DEPLOY_DIR}/certs/privkey.pem"
  # EMQX container runs as uid 1000 (emqx)
  chown -R 1000:1000 "${DEPLOY_DIR}/certs"
  echo "Certificates copied to ${DEPLOY_DIR}/certs."

  # Notify running containers if up
  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -q "devicenet-emqx"; then
    echo "Restarting EMQX listeners..."
    docker exec devicenet-emqx emqx ctl listeners restart ssl:default || true
    docker exec devicenet-emqx emqx ctl listeners restart wss:default || true
  fi
  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -q "devicenet-caddy"; then
    echo "Reloading Caddy..."
    docker exec devicenet-caddy caddy reload --config /etc/caddy/Caddyfile || true
  fi
fi
EOF
chmod +x "${DEPLOY_DIR}/scripts/deploy-certs.sh"

# Run cert deployment once
"${DEPLOY_DIR}/scripts/deploy-certs.sh" "${MQTT_DOMAIN}"

# 7. Write Environment & Substituted EMQX Configuration
cat > "${DEPLOY_DIR}/.env" << EOF
MQTT_DOMAIN=${MQTT_DOMAIN}
EMQX_SHARED_TOKEN=${EMQX_SHARED_TOKEN}
FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID}
API_URL=${API_URL}
EOF

# Substitute environment variables into emqx.conf
# Note: envsubst is restricted strictly to $API_URL, $FIREBASE_PROJECT_ID, $EMQX_SHARED_TOKEN
# to preserve EMQX runtime placeholders (${username}, ${password}, ${topic}, etc.).
export API_URL FIREBASE_PROJECT_ID EMQX_SHARED_TOKEN
if [ -f "${DEPLOY_DIR}/emqx.conf.template" ]; then
  envsubst '$API_URL $FIREBASE_PROJECT_ID $EMQX_SHARED_TOKEN' \
    < "${DEPLOY_DIR}/emqx.conf.template" \
    > "${DEPLOY_DIR}/emqx.conf"
fi

# Ensure correct permissions for EMQX data and config
chmod 644 "${DEPLOY_DIR}/emqx.conf" 2>/dev/null || true

# 8. Create Systemd Service for Docker Compose Stack
cat > /etc/systemd/system/devicenet-stack.service << EOF
[Unit]
Description=DeviceNet EMQX and Caddy Stack
After=docker.service network-online.target
Wants=network-online.target
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${DEPLOY_DIR}
ExecStart=/usr/bin/docker compose -f ${DEPLOY_DIR}/docker-compose.yml up -d
ExecStop=/usr/bin/docker compose -f ${DEPLOY_DIR}/docker-compose.yml down
ExecReload=/usr/bin/docker compose -f ${DEPLOY_DIR}/docker-compose.yml restart

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable devicenet-stack.service

# If docker-compose.yml exists, start it
if [ -f "${DEPLOY_DIR}/docker-compose.yml" ]; then
  systemctl start devicenet-stack.service
fi

echo "=== DeviceNet VM Startup Completed: $(date -u) ==="
