#!/usr/bin/env bash
# DeviceNet EMQX + Caddy VM Startup Script (GCP Compute Engine)
# Native Systemd version: Zero Docker, optimized for e2-micro (1GB RAM) Always Free tier.
set -euo pipefail

# Redirect stdout and stderr to both console and logfile
exec > >(tee -a /var/log/devicenet-startup.log) 2>&1
echo "=== DeviceNet VM Native Startup Initiated: $(date -u) ==="

# 1. Configure 2GB Swap (Crucial for memory stability on e2-micro instances)
if ! swapon --show | grep -q "/swapfile"; then
  echo "Creating 2GB swapfile..."
  if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile
  if ! grep -q "/swapfile" /etc/fstab; then
    echo "/swapfile none swap sw 0 0" >> /etc/fstab
  fi
  echo "Swap configured successfully."
fi

# 2. Install base packages and dependencies
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  gnupg \
  certbot \
  jq \
  gettext-base \
  openssl \
  debian-keyring \
  debian-archive-keyring \
  apt-transport-https

# 3. Setup repositories and install EMQX and Caddy natively (No Docker)
echo "Installing EMQX 5 OSS natively..."
if ! command -v emqx >/dev/null 2>&1; then
  curl -s https://assets.emqx.com/scripts/install-emqx-deb.sh | bash
  apt-get install -y emqx
fi

echo "Installing Caddy natively..."
if ! command -v caddy >/dev/null 2>&1; then
  install -m 0755 -d /usr/share/keyrings
  if [ ! -f /usr/share/keyrings/caddy-stable-archive-keyring.gpg ]; then
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  fi
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

# 4. Create deployment directories
DEPLOY_DIR="/opt/devicenet"
mkdir -p "${DEPLOY_DIR}/certs"
mkdir -p "${DEPLOY_DIR}/scripts"
mkdir -p "${DEPLOY_DIR}/self-signed"
mkdir -p "/opt/emqx/data"
mkdir -p "/etc/certs"
ln -sfn "${DEPLOY_DIR}/certs" /etc/certs
chown -R emqx:emqx /opt/emqx
# Grant caddy group access to read certs
usermod -aG emqx caddy || true

# 5. Discover VM External IP, Instance Metadata, and Secrets
METADATA_HEADER="Metadata-Flavor: Google"
VM_EXTERNAL_IP=$(curl -s -f -H "${METADATA_HEADER}" "http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip" || echo "")

fetch_metadata() {
  local attr="$1"
  local fallback="${2:-}"
  local val
  val=$(curl -s -f -H "${METADATA_HEADER}" "http://metadata.google.internal/computeMetadata/v1/instance/attributes/${attr}" 2>/dev/null || true)
  if [ -z "${val}" ]; then
    echo "${fallback}"
  else
    echo "${val}"
  fi
}

fetch_secret() {
  local secret_name="$1"
  local val
  val=$(gcloud secrets versions access latest --secret="${secret_name}" 2>/dev/null || true)
  echo "${val}"
}

# Fetch secrets: check combined devicenet-secrets JSON first, fallback to individual secrets
SECRETS_JSON=$(fetch_secret "devicenet-secrets")
if [ -n "${SECRETS_JSON}" ]; then
  EMQX_SHARED_TOKEN=$(echo "${SECRETS_JSON}" | jq -r '.EMQX_SHARED_TOKEN // empty')
  EMQX_DASHBOARD_PASSWORD=$(echo "${SECRETS_JSON}" | jq -r '.EMQX_DASHBOARD_PASSWORD // .EMQX_DASHBOARD_PASS // empty')
else
  EMQX_SHARED_TOKEN=$(fetch_secret "emqx-shared-token")
  EMQX_DASHBOARD_PASSWORD=$(fetch_secret "emqx-dashboard-password")
fi

FIREBASE_PROJECT_ID=$(fetch_metadata "firebase-project-id" "$(fetch_secret "firebase-project-id")")
API_URL=$(fetch_metadata "api-url" "")
MQTT_DOMAIN=$(fetch_metadata "mqtt-domain" "${VM_EXTERNAL_IP}.sslip.io")

# Fail fast if required configurations are missing
if [ -z "${FIREBASE_PROJECT_ID}" ]; then
  echo "FATAL: FIREBASE_PROJECT_ID is not configured in metadata or secret manager!" >&2
  exit 1
fi
if [ -z "${EMQX_SHARED_TOKEN}" ]; then
  echo "FATAL: EMQX_SHARED_TOKEN secret is missing or empty!" >&2
  exit 1
fi
if [ -z "${API_URL}" ]; then
  echo "FATAL: API_URL is not configured in metadata! Cloud Run API URL must be provided." >&2
  exit 1
fi

echo "Configured parameters:"
echo "- VM External IP: ${VM_EXTERNAL_IP}"
echo "- MQTT Domain: ${MQTT_DOMAIN}"
echo "- Firebase Project ID: ${FIREBASE_PROJECT_ID}"
echo "- API URL: ${API_URL}"

# 6. Fetch Stack Configuration Files from Instance Metadata (if available)
for file_spec in caddyfile:Caddyfile emqx-conf-template:emqx.conf.template; do
  attr="${file_spec%%:*}"
  target="${file_spec##*:}"
  content=$(fetch_metadata "${attr}" "")
  if [ -n "${content}" ]; then
    echo "${content}" > "${DEPLOY_DIR}/${target}"
    echo "Saved ${target} from VM instance metadata."
  fi
done

if [ ! -f "${DEPLOY_DIR}/emqx.conf.template" ] && [ -f "${DEPLOY_DIR}/emqx.conf" ]; then
  cp "${DEPLOY_DIR}/emqx.conf" "${DEPLOY_DIR}/emqx.conf.template"
fi

# 7. Obtain TLS Certificates via Certbot Standalone or fallback self-signed
LE_CERT_DIR="/etc/letsencrypt/live/${MQTT_DOMAIN}"
if [ ! -f "${LE_CERT_DIR}/fullchain.pem" ]; then
  echo "Requesting TLS certificate via Certbot for ${MQTT_DOMAIN}..."
  systemctl stop caddy || true
  if certbot certonly --standalone \
      --non-interactive \
      --agree-tos \
      --register-unsafely-without-email \
      -d "${MQTT_DOMAIN}"; then
    echo "Certbot certificate acquired successfully."
  else
    echo "WARNING: Certbot standalone failed (DNS may not be ready or rate-limited)."
    echo "Generating temporary self-signed certificate in ${DEPLOY_DIR}/self-signed to allow initial boot..."
    openssl req -x509 -nodes -days 30 -newkey rsa:2048 \
      -keyout "${DEPLOY_DIR}/self-signed/privkey.pem" \
      -out "${DEPLOY_DIR}/self-signed/fullchain.pem" \
      -subj "/CN=${MQTT_DOMAIN}"
  fi
fi

# 8. Create Cert Deployment Script & Certbot Renewal Hook
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

LE_DIR="/etc/letsencrypt/live/${DOMAIN}"
SELF_DIR="${DEPLOY_DIR}/self-signed"

if [ -f "${LE_DIR}/fullchain.pem" ]; then
  echo "Deploying Let's Encrypt certificate for ${DOMAIN}..."
  cp -L "${LE_DIR}/fullchain.pem" "${DEPLOY_DIR}/certs/fullchain.pem"
  cp -L "${LE_DIR}/privkey.pem" "${DEPLOY_DIR}/certs/privkey.pem"
elif [ -f "${SELF_DIR}/fullchain.pem" ]; then
  echo "Deploying fallback self-signed certificate for ${DOMAIN}..."
  cp -L "${SELF_DIR}/fullchain.pem" "${DEPLOY_DIR}/certs/fullchain.pem"
  cp -L "${SELF_DIR}/privkey.pem" "${DEPLOY_DIR}/certs/privkey.pem"
else
  echo "ERROR: No certificates found to deploy!" >&2
  exit 1
fi

chmod 644 "${DEPLOY_DIR}/certs/fullchain.pem"
chmod 640 "${DEPLOY_DIR}/certs/privkey.pem"
chown -R root:emqx "${DEPLOY_DIR}/certs"
echo "Certificates deployed to ${DEPLOY_DIR}/certs."

# Reload native systemd services to apply renewed certificates
if systemctl is-active --quiet emqx; then
  echo "Restarting EMQX to reload TLS certificates..."
  systemctl restart emqx || true
fi
if systemctl is-active --quiet caddy; then
  echo "Reloading Caddy to apply TLS certificates..."
  systemctl reload caddy || true
fi
EOF
chmod +x "${DEPLOY_DIR}/scripts/deploy-certs.sh"

# Install Certbot automated renewal deploy hook
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/devicenet.sh << 'EOF'
#!/usr/bin/env bash
set -euo pipefail
/opt/devicenet/scripts/deploy-certs.sh
EOF
chmod +x /etc/letsencrypt/renewal-hooks/deploy/devicenet.sh

# Deploy certificates once for initial startup
"${DEPLOY_DIR}/scripts/deploy-certs.sh" "${MQTT_DOMAIN}"

# 9. Write Environment File
cat > "${DEPLOY_DIR}/.env" << EOF
MQTT_DOMAIN=${MQTT_DOMAIN}
EMQX_SHARED_TOKEN=${EMQX_SHARED_TOKEN}
FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID}
API_URL=${API_URL}
EMQX_DASHBOARD_PASSWORD=${EMQX_DASHBOARD_PASSWORD}
EOF

# 10. Configure EMQX Native
export API_URL FIREBASE_PROJECT_ID EMQX_SHARED_TOKEN
if [ -f "${DEPLOY_DIR}/emqx.conf.template" ]; then
  envsubst '$API_URL $FIREBASE_PROJECT_ID $EMQX_SHARED_TOKEN' \
    < "${DEPLOY_DIR}/emqx.conf.template" \
    > /etc/emqx/emqx.conf
  chmod 644 /etc/emqx/emqx.conf
  chown emqx:emqx /etc/emqx/emqx.conf
fi

# Set EMQX dashboard password in system environment
mkdir -p /etc/systemd/system/emqx.service.d
cat > /etc/systemd/system/emqx.service.d/override.conf << EOF
[Service]
Environment="EMQX_DASHBOARD__DEFAULT_PASSWORD=${EMQX_DASHBOARD_PASSWORD}"
EOF

systemctl daemon-reload
systemctl enable --now emqx

# Update admin password dynamically once emqx responds
sleep 5
if command -v emqx >/dev/null 2>&1 && [ -n "${EMQX_DASHBOARD_PASSWORD}" ]; then
  emqx ctl admins passwd admin "${EMQX_DASHBOARD_PASSWORD}" 2>/dev/null || true
fi

# 11. Configure Caddy Native
export MQTT_DOMAIN EMQX_SHARED_TOKEN
if [ -f "${DEPLOY_DIR}/Caddyfile" ]; then
  envsubst '$MQTT_DOMAIN $EMQX_SHARED_TOKEN' \
    < "${DEPLOY_DIR}/Caddyfile" \
    > /etc/caddy/Caddyfile
  chmod 644 /etc/caddy/Caddyfile
fi

systemctl enable --now caddy
systemctl reload caddy || systemctl restart caddy

echo "=== DeviceNet VM Native Startup Completed: $(date -u) ==="
