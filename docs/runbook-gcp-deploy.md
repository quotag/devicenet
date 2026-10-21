# Runbook: Triển khai DeviceNet lên Google Cloud Platform (GCP) - Chuẩn 0 Cost (Free Tier)

Tài liệu này là hướng dẫn chính thức, tuần tự và khép kín để triển khai toàn bộ hệ thống **DeviceNet** lên Google Cloud Platform (GCP) đạt chuẩn **100% Zero Cost (Miễn phí hoàn toàn trong Always Free Tier)**. 

Tài liệu cung cấp hai lộ trình độc lập: **Lộ trình A (Terraform - Khuyến nghị)** và **Lộ trình B (Thủ công với gcloud CLI)** nhằm tránh xung đột tài nguyên.

---

## 1. Kiến trúc hệ thống 0 Cost trên GCP

Để hệ thống vận hành hoàn toàn **0đ/tháng**, tất cả tài nguyên được cấu hình nghiêm ngặt theo chính sách **GCP Always Free Tier**:

| Thành phần | Dịch vụ GCP | Cấu hình kỹ thuật 0 Cost | Chi phí |
| :--- | :--- | :--- | :--- |
| **MQTT Broker** | Compute Engine VM | **`e2-micro`** (2 vCPU burstable, 1 GB RAM + 2 GB Swap), vùng **`us-central1`**, Boot Disk **`pd-standard` 30 GB**.<br>Chạy **Native Systemd** (EMQX 5.8 OSS + Caddy kick proxy, **không dùng Docker** để tiết kiệm RAM). | **0đ** (Always Free: 1 e2-micro tại US) |
| **Backend API** | Cloud Run | Node 22 slim, Fastify 5, vùng **`us-central1`**, `min_instances = 0`, `max_instances = 3`, scale-to-zero. | **0đ** (Free Tier: 2 triệu req/tháng) |
| **Cơ sở dữ liệu** | Cloud Firestore | Native Mode, vùng **`us-central1`** (nam5 multi-region hoặc us-central1). Quản lý rules & TTLs tự động. | **0đ** (Free Tier: 1GB, 50k reads, 20k writes/ngày) |
| **Bảo mật Secrets** | Secret Manager | Lưu trữ 5 secrets (`emqx-shared-token`, `emqx-admin-key`, `emqx-admin-secret`, `emqx-dashboard-password`, `firebase-project-id`). | **0đ** (Free Tier: 6 secret versions active) |
| **Web PWA** | Firebase Hosting | CDN toàn cầu, HTTPS tự động, phục vụ `web.app` và `firebaseapp.com`. *(Gói zip cài đặt Windows ~283MB khuyến nghị host trên GitHub Releases để không hao 10GB/tháng bandwidth)*. | **0đ** (Free Tier: 10GB bandwidth/tháng) |
| **IP tĩnh ngoại vi** | Cloud External IP | 1 In-use External IPv4 gắn cố định vào VM chạy 24/7. | **0đ** (Được miễn phí pool 744h/tháng cho 1 VM active) |

> [!IMPORTANT]
> **Quy tắc vàng để không phát sinh chi phí trên GCP**:
> 1. **Vùng bắt buộc cho VM**: Phải là `us-central1` (Iowa), `us-east1` (South Carolina), hoặc `us-west1` (Oregon). Các vùng Châu Á như `asia-southeast1` **KHÔNG** có Always Free cho Compute Engine.
> 2. **Loại máy**: Phải là `e2-micro` (không dùng `e2-small` hay `e2-medium`).
> 3. **Loại đĩa**: Phải là Standard Persistent Disk (`pd-standard`) dung lượng $\le 30$ GB (không chọn `pd-balanced` hay `pd-ssd`).
> 4. **IP tĩnh**: Chỉ cấp duy nhất 1 IP tĩnh và luôn gắn vào VM đang chạy. Nếu xóa VM, phải Release IP ngay để tránh phí nhàn rỗi.

---

## 2. Bảng biến môi trường và Domain

| Biến môi trường / Cấu hình | Ý nghĩa | Giá trị mẫu |
| :--- | :--- | :--- |
| `PROJECT_ID` | GCP Project ID | `devicenet-prod-123` |
| `REGION` | Vùng triển khai GCP (Chuẩn Free Tier) | `us-central1` |
| `VM_IP` | IP tĩnh của VM MQTT Broker | `34.142.x.x` |
| `MQTT_DOMAIN` | Domain TLS của MQTT Broker | `<VM_IP>.sslip.io` (hoặc domain riêng) |
| `API_URL` | URL công khai của Cloud Run API | `https://devicenet-api-<project_number>.us-central1.run.app` |
| `EMQX_SHARED_TOKEN` | Token bí mật giữa API và EMQX | Chuỗi ngẫu nhiên dài $\ge$ 32 ký tự |

---

## 3. Bước chuẩn bị: GCP Project & Kích hoạt APIs

Chạy trên máy dev (đã cài đặt và đăng nhập `gcloud`):

```bash
# Đặt project mặc định và vùng us-central1 cho Free Tier
export PROJECT_ID="<YOUR_GCP_PROJECT_ID>"
export REGION="us-central1"
gcloud config set project "$PROJECT_ID"

# Bật tất cả các API cần thiết
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  firestore.googleapis.com \
  iamcredentials.googleapis.com \
  identitytoolkit.googleapis.com \
  firebase.googleapis.com \
  firebasehosting.googleapis.com \
  compute.googleapis.com \
  cloudbuild.googleapis.com
```

---

## 4. Lộ trình A: Triển khai 100% bằng Terraform (Khuyến nghị)

> [!NOTE]
> Nếu chọn Lộ trình A, KHÔNG chạy các lệnh tạo secret hay VM bằng `gcloud` ở Lộ trình B để tránh lỗi trùng lặp `409 ALREADY EXISTS`.

### 1. Khởi tạo hạ tầng với Terraform
```bash
cd infra/terraform

# Điền file cấu hình terraform.tfvars chuẩn 0 Cost
cat > terraform.tfvars << EOF
gcp_project_id       = "${PROJECT_ID}"
gcp_region           = "${REGION}"
firebase_project_id  = "${PROJECT_ID}"
firebase_web_api_key = "<YOUR_FIREBASE_WEB_API_KEY>"
vm_machine_type      = "e2-micro"
api_min_instances    = 0
api_max_instances    = 3
EOF

terraform init
terraform apply -auto-approve

# Lưu lại các giá trị output cần dùng
export VM_IP=$(terraform output -raw vm_external_ip)
export MQTT_DOMAIN=$(terraform output -raw vm_mqtt_domain)
export API_URL=$(terraform output -raw api_service_url)
export EMQX_ADMIN_KEY=$(terraform output -raw generated_emqx_admin_key)
export EMQX_ADMIN_SECRET=$(terraform output -raw generated_emqx_admin_secret)
export EMQX_DASHBOARD_PASS=$(terraform output -raw generated_dashboard_password)
cd ../..
```

### 2. Build và Push Image lên Artifact Registry
Sử dụng file cấu hình Cloud Build chuẩn `cloudbuild.yaml`:
```bash
gcloud builds submit \
  --config=cloudbuild.yaml \
  --substitutions=_REGION="$REGION" .
```

Sau khi build hoàn tất, Cloud Run service `devicenet-api` sẽ tự động tải image và vượt qua startup probe `/healthz`.

### 3. Cấu hình EMQX Admin Key qua Dashboard (SSH Tunnel)
Do Dashboard EMQX chạy native và bind an toàn trên `127.0.0.1:18083` của VM:
```bash
# Mở SSH tunnel chuyển tiếp cổng 18083 về máy dev:
gcloud compute ssh devicenet-emqx-vm --zone="${REGION}-a" -- -L 18083:localhost:18083
```
- Mở trình duyệt tại: `http://localhost:18083`
- Đăng nhập với username `admin`, mật khẩu lấy từ biến `$EMQX_DASHBOARD_PASS` (hoặc `admin` / `public` lần đầu).
- Vào **System** $\rightarrow$ **API Keys** $\rightarrow$ **+ Create**:
  - Nhập **API Key**: giá trị `$EMQX_ADMIN_KEY`
  - Nhập **Secret Key**: giá trị `$EMQX_ADMIN_SECRET`
  - Nhấn Save. Điều này cho phép API Cloud Run kick session MQTT khi xóa Hub.

Tiếp tục đến **Mục 6: Deploy Firestore & Web** bên dưới.

---

## 5. Lộ trình B: Triển khai Thủ công bằng `gcloud` CLI (Không dùng Terraform)

### 1. Tạo Secrets (Gộp thành 1 JSON Secret duy nhất để tối ưu Free Tier)
Để tối ưu không gian miễn phí của GCP Secret Manager (tối đa 6 secret versions), toàn bộ các token bí mật được gộp chung vào 1 secret JSON duy nhất mang tên `devicenet-secrets`:

```bash
EMQX_SHARED_TOKEN=$(openssl rand -hex 24)
EMQX_ADMIN_KEY=$(openssl rand -hex 16)
EMQX_ADMIN_SECRET=$(openssl rand -hex 24)
EMQX_DASHBOARD_PASS=$(openssl rand -hex 12)

SECRETS_PAYLOAD=$(cat << EOF
{
  "EMQX_SHARED_TOKEN": "${EMQX_SHARED_TOKEN}",
  "EMQX_ADMIN_KEY": "${EMQX_ADMIN_KEY}",
  "EMQX_ADMIN_SECRET": "${EMQX_ADMIN_SECRET}",
  "EMQX_DASHBOARD_PASSWORD": "${EMQX_DASHBOARD_PASS}"
}
EOF
)

gcloud secrets create devicenet-secrets --replication-policy="automatic"
echo -n "$SECRETS_PAYLOAD" | gcloud secrets versions add devicenet-secrets --data-file=-
```

### 2. Cấp IP tĩnh & Firewall Rules cho VM
```bash
gcloud compute addresses create devicenet-emqx-ip --region="$REGION"
export VM_IP=$(gcloud compute addresses describe devicenet-emqx-ip --region="$REGION" --format="value(address)")
export MQTT_DOMAIN="${VM_IP}.sslip.io"

# Mở cổng MQTTS (8883), WSS (8084), HTTPS kick proxy (443), HTTP Certbot (80)
gcloud compute firewall-rules create devicenet-allow-mqtts \
  --allow=tcp:8883 --target-tags=emqx-server --source-ranges=0.0.0.0/0
gcloud compute firewall-rules create devicenet-allow-wss \
  --allow=tcp:8084 --target-tags=emqx-server --source-ranges=0.0.0.0/0
gcloud compute firewall-rules create devicenet-allow-https \
  --allow=tcp:443 --target-tags=emqx-server --source-ranges=0.0.0.0/0
gcloud compute firewall-rules create devicenet-allow-http \
  --allow=tcp:80 --target-tags=emqx-server --source-ranges=0.0.0.0/0
```

### 3. Tạo Service Account và Deploy Cloud Run API
```bash
gcloud iam service-accounts create devicenet-api-sa --display-name="DeviceNet API SA"

# Quyền Firestore & Firebase Auth Admin
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:devicenet-api-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/datastore.user"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:devicenet-api-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/firebaseauth.admin"

# Bắt buộc để mint custom token cho hub
gcloud iam service-accounts add-iam-policy-binding \
  "devicenet-api-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --member="serviceAccount:devicenet-api-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator"

# Cấp quyền đọc secret gộp duy nhất
gcloud secrets add-iam-policy-binding devicenet-secrets \
  --member="serviceAccount:devicenet-api-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# Tạo Artifact Registry Repo & Build Image
gcloud artifacts repositories create devicenet \
  --repository-format=docker --location="$REGION" --description="DeviceNet images" || true

gcloud builds submit --config=cloudbuild.yaml --substitutions=_REGION="$REGION" .

# Dự đoán URL Cloud Run
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
export API_URL="https://devicenet-api-${PROJECT_NUMBER}.${REGION}.run.app"

# Tạo file env.yaml tránh lỗi gcloud tách dấu phẩy trong HOSTING_ORIGIN
cat > api-env.yaml << EOF
NODE_ENV: "production"
PORT: "8080"
GCP_PROJECT_ID: "${PROJECT_ID}"
FIREBASE_PROJECT_ID: "${PROJECT_ID}"
FIREBASE_WEB_API_KEY: "<YOUR_FIREBASE_WEB_API_KEY>"
DN_API_BASE_URL: "${API_URL}"
TRUST_PROXY: "1"
DN_MQTT_HOST: "${MQTT_DOMAIN}"
DN_MQTT_PORT: "8883"
DN_MQTT_WSS_PORT: "8084"
HOSTING_ORIGIN: "https://${PROJECT_ID}.web.app,https://${PROJECT_ID}.firebaseapp.com"
EMQX_ADMIN_URL: "https://${MQTT_DOMAIN}"
EOF

gcloud run deploy devicenet-api \
  --image="${REGION}-docker.pkg.dev/${PROJECT_ID}/devicenet/api:latest" \
  --platform="managed" \
  --region="$REGION" \
  --allow-unauthenticated \
  --service-account="devicenet-api-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --min-instances=0 \
  --max-instances=3 \
  --cpu=1 \
  --memory=512Mi \
  --env-vars-file=api-env.yaml \
  --set-secrets="DEVICENET_SECRETS=devicenet-secrets:latest"

export API_URL=$(gcloud run services describe devicenet-api --region="$REGION" --format="value(status.url)")
```

### 4. Triển khai MQTT Broker lên VM Native Systemd

> [!TIP]
> **Nếu dùng chung VM có sẵn (ví dụ `zalo-bot-vm`)**: BỎ QUA lệnh tạo VM mới bên dưới! Chỉ cần mở Firewall Rules cho VM hiện tại và SSH vào máy để cài đặt EMQX + Caddy native.

```bash
gcloud iam service-accounts create devicenet-emqx-vm-sa --display-name="EMQX VM Service Account" || true

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:devicenet-emqx-vm-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/logging.logWriter"

gcloud secrets add-iam-policy-binding devicenet-secrets \
  --member="serviceAccount:devicenet-emqx-vm-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# Khởi tạo VM e2-micro với đĩa tiêu chuẩn pd-standard 30GB, chạy native systemd không Docker
gcloud compute instances create devicenet-emqx-vm \
  --zone="${REGION}-a" \
  --machine-type="e2-micro" \
  --boot-disk-type="pd-standard" \
  --boot-disk-size="30GB" \
  --image-family="debian-12" \
  --image-project="debian-cloud" \
  --address="$VM_IP" \
  --tags="emqx-server" \
  --service-account="devicenet-emqx-vm-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --scopes="cloud-platform" \
  --metadata-from-file=startup-script=infra/vm/startup.sh,caddyfile=infra/vm/Caddyfile,emqx-conf-template=infra/emqx/emqx.conf.template \
  --metadata="api-url=${API_URL},mqtt-domain=${MQTT_DOMAIN},firebase-project-id=${PROJECT_ID}"
```

---

## 6. Bước 6: Deploy Firestore Rules & Indexes

```bash
# Deploy Firestore security rules
firebase deploy --only firestore:rules --project "$PROJECT_ID"

# Deploy Firestore composite indexes & TTL configurations
firebase deploy --only firestore:indexes --project "$PROJECT_ID"
```

---

## 7. Bước 7: Cấu hình Firebase Authentication & Deploy Web App

### 1. [MANUAL] Bật Google Provider trong Firebase Console
1. Truy cập [Firebase Console](https://console.firebase.google.com/) $\rightarrow$ Chọn dự án `$PROJECT_ID`.
2. Vào **Build** $\rightarrow$ **Authentication** $\rightarrow$ Tab **Sign-in method**.
3. Bật nhà cung cấp **Google**.
4. Vào tab **Settings** $\rightarrow$ **Authorized domains**:
   - Xác nhận có `<PROJECT_ID>.firebaseapp.com` và `<PROJECT_ID>.web.app`.
   - Nếu bạn dùng custom domain cho Web, thêm custom domain vào đây.
5. Kiểm tra mục **OAuth consent screen** trên Google Cloud Console.

### 2. Build và Deploy Web PWA
Tạo file `apps/web/.env.production`:
```ini
VITE_MODE=cloud
VITE_API_URL=https://devicenet-api-<project_number>.us-central1.run.app
VITE_MQTT_URL=wss://<YOUR_VM_IP>.sslip.io:8084/mqtt
VITE_FIREBASE_PROJECT_ID=<YOUR_GCP_PROJECT_ID>
VITE_FIREBASE_API_KEY=<YOUR_FIREBASE_WEB_API_KEY>
VITE_FIREBASE_AUTH_DOMAIN=<YOUR_GCP_PROJECT_ID>.web.app
```

Thực hiện build và deploy lên Firebase Hosting:
```bash
# Build web package
pnpm --filter web build

# Deploy lên Firebase Hosting
firebase deploy --only hosting --project "$PROJECT_ID"
```
Ứng dụng Web đã sẵn sàng truy cập tại: `https://${PROJECT_ID}.web.app`.

---

## 8. Bước 8: Khởi chạy và Kết nối Hub Thực tế lên Cloud (Hỗ trợ cả Windows và Linux)

Hub Agent lõi ([apps/hub-agent](file:///c:/dev/devicenet/apps/hub-agent)) đã được lập trình đa nền tảng 100%:
- Tự động nhận diện hệ điều hành (`process.platform === 'win32' ? 'windows' : 'linux'`).
- Tự động dò USB Zigbee theo VID:PID (`COMx` trên Windows; `/dev/serial/by-id/*` hoặc `/dev/ttyUSB*` trên Linux).
- Tự động quản lý tiến trình Mosquitto & Z2M phù hợp từng hệ điều hành.

---

### Phương án 8.1: Triển khai trên máy Windows (Windows 10/11, Windows Server)

#### Cách 1: Chạy trực tiếp qua Node (Development / Testing)
1. **Cấu hình file `.data/hub/config.yaml`**:
   ```yaml
   apiBaseUrl: "https://devicenet-api-<project_number>.us-central1.run.app"
   emulator: false
   cloudMqttTls: true
   ```
2. **Build và chạy**:
   ```powershell
   pnpm --filter @devicenet/hub-agent build
   node apps/hub-agent/dist/main.js
   ```

#### Cách 2: Chạy nền dưới dạng Windows Service (Production 24/7)
Sử dụng script cài đặt Windows tự động qua WinSW:
```powershell
# Chạy PowerShell với quyền Administrator từ thư mục gốc dự án:
powershell -ExecutionPolicy Bypass -File installers/windows/install.ps1 -ApiBaseUrl "https://devicenet-api-<project_number>.us-central1.run.app"
```
- Khởi động service:
  ```powershell
  Start-Service DeviceNetHub
  ```
- Kiểm tra trạng thái service:
  ```powershell
  Get-Service DeviceNetHub
  ```
- File cấu hình production được lưu tại: `C:\ProgramData\DeviceNet\data\config.yaml`.

---

### Phương án 8.2: Triển khai trên máy Linux (Raspberry Pi, Mini PC Ubuntu/Debian)

#### Cách 1: Chạy trực tiếp qua Node (Testing)
1. **Cài đặt dependencies hệ thống** (Node.js 22, Mosquitto):
   ```bash
   sudo apt-get update
   sudo apt-get install -y nodejs npm mosquitto mosquitto-clients
   ```
2. **Cấu hình file `.data/hub/config.yaml`**:
   ```yaml
   apiBaseUrl: "https://devicenet-api-<project_number>.us-central1.run.app"
   emulator: false
   cloudMqttTls: true
   ```
3. **Build và chạy**:
   ```bash
   pnpm --filter @devicenet/hub-agent build
   node apps/hub-agent/dist/main.js
   ```

#### Cách 2: Chạy nền dưới dạng Native Systemd Service (Production 24/7)
1. Tạo thư mục làm việc và user riêng:
   ```bash
   sudo useradd --system --create-home --home-dir /opt/devicenet --shell /usr/sbin/nologin devicenet || true
   sudo usermod -aG dialout devicenet
   sudo mkdir -p /opt/devicenet/data
   ```

2. Tạo file cấu hình `/opt/devicenet/data/config.yaml`:
   ```yaml
   apiBaseUrl: "https://devicenet-api-<project_number>.us-central1.run.app"
   emulator: false
   cloudMqttTls: true
   serialPort: "auto"
   dataDir: "/opt/devicenet/data"
   ```
   ```bash
   sudo chown -R devicenet:devicenet /opt/devicenet
   ```

3. Copy bản build `dist/` của hub-agent vào `/opt/devicenet/dist/`:
   ```bash
   sudo cp -r apps/hub-agent/dist /opt/devicenet/
   sudo cp -r node_modules /opt/devicenet/
   sudo chown -R devicenet:devicenet /opt/devicenet
   ```

4. Tạo file systemd service `/etc/systemd/system/devicenet-hub.service`:
   ```ini
   [Unit]
   Description=DeviceNet Physical Hub Agent
   After=network-online.target
   Wants=network-online.target

   [Service]
   Type=simple
   User=devicenet
   Group=devicenet
   WorkingDirectory=/opt/devicenet
   Environment=DN_DATA_DIR=/opt/devicenet/data
   ExecStart=/usr/bin/node /opt/devicenet/dist/main.js
   Restart=always
   RestartSec=10
   LimitNOFILE=65536

   [Install]
   WantedBy=multi-user.target
   ```

5. Kích hoạt và khởi động service:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now devicenet-hub.service
   sudo systemctl status devicenet-hub.service
   ```

---

### Quy trình kích hoạt liên kết Hub lên Cloud (Đồng nhất cho cả Windows và Linux)

1. **Mở giao diện Web LAN cục bộ của Hub**:
   - Truy cập trình duyệt tại: `http://localhost:8080/setup` (hoặc `http://<ip_lan_cua_hub>:8080/setup`).
   - Màn hình hiển thị mã Claim 8 ký tự (ví dụ: `ABC1-2345`).

2. **Liên kết Hub trên Web App**:
   - Đăng nhập vào ứng dụng Web Cloud: `https://${PROJECT_ID}.web.app`.
   - Vào mục **Cài đặt** $\rightarrow$ **Thêm Hub mới**.
   - Nhập mã Claim 8 ký tự $\rightarrow$ Nhấn **Liên kết Hub**.
   - API Cloud Run xác thực mã claim, tạo tài liệu Hub trên Cloud Firestore và cấp thông tin chứng thực MQTT Cloud.
   - Hub agent tự động nhận token từ Cloud và thiết lập kết nối an toàn qua MQTTS (cổng 8883) tới EMQX Broker trên VM.
   - Trạng thái của Hub trên Web chuyển sang chấm xanh **Online**.

---

## 9. Xử lý sự cố thường gặp & Bảo trì VM Native

### Kiểm tra tình trạng RAM và Dịch vụ Native trên VM GCP
Khi SSH vào VM qua `gcloud compute ssh devicenet-emqx-vm --zone=us-central1-a`:
```bash
# 1. Kiểm tra RAM và Swap (mức tiêu thụ mong đợi: ~350MB RAM / 1GB, Swap hoạt động tốt)
free -h

# 2. Kiểm tra trạng thái EMQX Native
sudo systemctl status emqx
# Xem log chi tiết EMQX:
sudo journalctl -u emqx -f -n 50

# 3. Kiểm tra trạng thái Caddy Native (Kick proxy & TLS reverse proxy)
sudo systemctl status caddy
# Xem log chi tiết Caddy:
sudo journalctl -u caddy -f -n 50
```

### Kiểm tra Handshake TLS của MQTTS
Từ máy tính dev hoặc hub:
```bash
openssl s_client -connect "${MQTT_DOMAIN}:8883" -servername "${MQTT_DOMAIN}"
# Kết quả mong đợi: Verify return code: 0 (ok)
```

### Kiểm tra Kick Proxy Caddy
```bash
curl -i -k "https://${MQTT_DOMAIN}/healthz"
# Kết quả mong đợi: HTTP/2 200 - OK
```

### Chứng chỉ Let's Encrypt tự động gia hạn (Automated Renewal)
- Script gia hạn tự động đặt tại `/etc/letsencrypt/renewal-hooks/deploy/devicenet.sh`.
- Khi certbot gia hạn chứng chỉ mới (HTTP-01 challenge trên cổng 80), script sẽ tự động sao chép chứng chỉ vào `/opt/devicenet/certs/` và reload native services:
  ```bash
  systemctl restart emqx
  systemctl reload caddy
  ```
