#!/bin/bash
set -e

# Update system
apt-get update
apt-get upgrade -y
apt-get install -y docker.io docker-compose-plugin git curl

# Start Docker
systemctl start docker
systemctl enable docker

# Create app directory
mkdir -p /opt/devicenet
cd /opt/devicenet

# Clone or download compose files from repo
# For now, create minimal structure
mkdir -p emqx/certs vm

# TODO: Download docker-compose.yml and Caddyfile from GCS bucket or repo

# Create self-signed certificates for EMQX (will be replaced by Caddy for external)
mkdir -p emqx/certs
openssl req -newkey rsa:2048 -nodes -keyout emqx/certs/server.key \
  -x509 -days 365 -out emqx/certs/server.crt \
  -subj "/CN=localhost"

# Fetch environment variables from Secret Manager
export FIREBASE_PROJECT_ID=$(gcloud secrets versions access latest --secret="firebase-project-id" 2>/dev/null || echo "demo-devicenet")
export EMQX_SHARED_TOKEN=$(gcloud secrets versions access latest --secret="emqx-shared-token" 2>/dev/null || echo "dev-token")
export API_HOST=$(curl -s http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip -H "Metadata-Flavor: Google")
export API_PORT=443
export CADDY_EMAIL="admin@sslip.io"

# Create .env file for docker-compose
cat > /opt/devicenet/.env << EOF
FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID}
EMQX_SHARED_TOKEN=${EMQX_SHARED_TOKEN}
API_HOST=${API_HOST}
API_PORT=${API_PORT}
CADDY_EMAIL=${CADDY_EMAIL}
EOF

# Update Caddyfile with actual IP
sed -i "s/{IP}/${API_HOST}/g" /opt/devicenet/vm/Caddyfile

# Start Docker Compose
docker compose -f /opt/devicenet/docker-compose.yml up -d

# Log startup complete
echo "DeviceNet EMQX+Caddy startup complete" > /var/log/devicenet-startup.log
