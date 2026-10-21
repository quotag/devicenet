# DeviceNet Infrastructure

This directory contains configuration and deployment assets for DeviceNet on Google Cloud Platform:
- `emqx/`: EMQX 5.8 configuration (`emqx.conf`)
- `vm/`: Compute Engine VM deployment files (Docker Compose, Caddyfile, startup script)
- `terraform/`: Infrastructure-as-Code definitions for GCP (Cloud Run, VM, Firestore, Secrets, Networking)
- `firestore.rules`: Security rules for Cloud Firestore
- `firestore.indexes.json`: Composite indexes and collectionGroup index configurations

---

## EMQX 5.8 Architecture & Verification

The EMQX broker runs inside Docker on an `e2-small` Compute Engine VM and exposes:
- **`8883 (MQTTS)`**: Secure TLS MQTT for hub agents (`apps/hub-agent`).
- **`8084 (WSS)`**: Secure WebSocket for web browser clients (`apps/web`).
- **`18083 (HTTP)`**: Admin Dashboard & Management REST API, bound to `127.0.0.1` (SSH tunnel access only).
- **`1883 / 8083`**: Plain TCP/WS listeners are explicitly disabled from public routing.

### Authentication & Authorization Pipeline
1. **Web App (Browser)**:
   - Authenticates via JWT mechanism using Google/Firebase ID tokens (`endpoint = https://www.googleapis.com/.../jwk/...`).
   - The token contains custom claims `acl: { pub: [...], sub: [...] }` set by `POST /v1/tenants/bootstrap`.
   - EMQX extracts permissions from the `acl` claim name directly, giving fine-grained tenant isolation (`sub: t/<tenantId>/#`).
2. **Hub Agent**:
   - Authenticates via password-based HTTP authenticator (`POST /v1/emqx/auth`).
   - Username: `hub:<hubId>`, Password: `<hubSecret>` (provisioned during claim).
   - Authorizes every publish/subscribe via HTTP authorizer (`POST /v1/emqx/acl`).
   - Webhook rule engine forwards `t/+/h/+/status` directly to `POST /v1/emqx/webhook`.

---

## Verification & Testing Commands

### 1. Test Hub Authentication (MQTTS 8883)
```bash
# Valid hub credential -> SUCCESS
mosquitto_pub -h "$MQTT_DOMAIN" -p 8883 \
  --cafile /etc/certs/fullchain.pem \
  -u "hub:hub_01J00000000000000000000001" \
  -P "<valid_hub_secret>" \
  -t "t/tenant_01J00000000000000000000001/h/hub_01J00000000000000000000001/status" \
  -m '{"online":true,"ts":1710000000000,"agentVersion":"0.1.0"}'

# Invalid hub secret -> DENIED (Connection refused: not authorized)
mosquitto_pub -h "$MQTT_DOMAIN" -p 8883 \
  --cafile /etc/certs/fullchain.pem \
  -u "hub:hub_01J00000000000000000000001" \
  -P "invalid_secret" \
  -t "t/tenant_01J00000000000000000000001/h/hub_01J00000000000000000000001/status" \
  -m '{"online":true,"ts":1710000000000,"agentVersion":"0.1.0"}'
```

### 2. Test Hub Tenant ACL Isolation (Publish & Subscribe)
```bash
# Hub in tenant A publishing to tenant B -> DENIED by ACL
mosquitto_pub -h "$MQTT_DOMAIN" -p 8883 \
  --cafile /etc/certs/fullchain.pem \
  -u "hub:hub_01J00000000000000000000001" \
  -P "<valid_hub_secret>" \
  -t "t/tenant_OTHER_DIFFERENT/h/hub_01J00000000000000000000001/status" \
  -m '{"online":true}'
```

### 3. Test Web Client JWT Authentication (WSS 8084)
Using `wscat` or browser JavaScript console:
```javascript
import mqtt from 'mqtt';

const client = mqtt.connect('wss://' + MQTT_DOMAIN + ':8084/mqtt', {
  username: FIREBASE_UID,
  password: FIREBASE_ID_TOKEN,
  clientId: 'web-test-' + Date.now()
});

client.on('connect', () => {
  console.log('Connected via WSS!');
  // Subscribing to user's tenant topic -> ALLOWED
  client.subscribe('t/' + TENANT_ID + '/#', (err) => {
    if (!err) console.log('Subscribed to tenant topic successfully');
  });

  // Subscribing to another tenant topic -> DENIED
  client.subscribe('t/other_tenant/#', (err) => {
    console.log('Subscribe error as expected:', err);
  });
});
```

### 4. Verify TLS Certificate & Handshake
```bash
openssl s_client -connect "$MQTT_DOMAIN:8883" -servername "$MQTT_DOMAIN"
```
Verify that the output shows `Verify return code: 0 (ok)`.

### 5. Access EMQX Dashboard via Secure SSH Tunnel
```bash
# In your local terminal:
gcloud compute ssh devicenet-emqx-vm --zone=asia-southeast1-a -- -L 18083:localhost:18083

# Then open in browser:
http://localhost:18083
```
Default username is `admin`. Always change the default password immediately on first login!
