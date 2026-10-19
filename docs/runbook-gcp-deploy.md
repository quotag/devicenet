# Runbook: Triển khai DeviceNet lên Google Cloud Platform (GCP)

Tài liệu này tổng hợp toàn bộ kế hoạch, quyết định kiến trúc và các bước triển khai chi tiết hệ thống **DeviceNet** lên Google Cloud Platform (GCP). Tài liệu được cấu trúc chuẩn hóa để kỹ sư vận hành hoặc AI Agent có thể đọc và tự động thực thi từng bước.

---

## 1. Quyết định kiến trúc & Dự toán chi phí

Dự án hỗ trợ **2 phương án triển khai** thành phần MQTT Broker (EMQX + Caddy):

| Tiêu chí | Cách 1: Tối ưu 0đ (Khuyên dùng) | Cách 2: Máy ảo riêng biệt (Dedicated VM) |
| :--- | :--- | :--- |
| **Hạ tầng VM** | Tận dụng VM `e2-micro` sẵn có (đang chạy Zalo bot) | Tạo VM mới `e2-small` Debian 12 qua Terraform |
| **Cách chạy** | **Native** qua `systemd` (Không dùng Docker để tiết kiệm ~100MB RAM daemon) | **Docker Compose** (`emqx` + `caddy`) |
| **RAM tiêu thụ** | Thêm ~180MB - 210MB (vừa vặn với 479MB RAM khả dụng + 2GB Swap) | ~350MB trên VM mới (2GB RAM) |
| **Tên miền (Domain)** | **100% Hostname mặc định miễn phí** (`.web.app`, `.a.run.app`, `sslip.io`) | Mặc định `sslip.io` hoặc gắn domain tùy biến |
| **Chi phí hàng tháng** | **0 VNĐ / tháng** (Hoàn toàn nằm trong Always Free của GCP) | **~10 - 12 USD / tháng** (Chi phí VM `e2-small`) |

### Phân bổ dịch vụ DeviceNet trên Cloud:
* **Web PWA (`apps/web`)**: Firebase Hosting (CDN miễn phí, HTTPS tự động).
* **Cloud API (`apps/api`)**: Google Cloud Run (Fastify container, min 0 / max 2, scale-to-zero khi rảnh, free tier).
* **Database**: Cloud Firestore Native mode (asia-southeast1, free tier 1GB + 50k reads/ngày).
* **Secrets**: Secret Manager lưu `emqx-shared-token` và `emqx-admin-key`.
* **MQTT Broker**: EMQX 5.8 OSS (MQTTS 8883 cho Hub, WSS 8084 cho Web) + Caddy TLS Reverse Proxy.

---

## 2. Bảng địa chỉ & Hostname mặc định

Hệ thống tận dụng toàn bộ hostname mặc định, không cần mua domain riêng:

| Dịch vụ | Hostname mặc định | Chứng chỉ SSL/TLS |
| :--- | :--- | :--- |
| **Web Frontend (PWA)** | `https://<PROJECT_ID>.web.app`<br>`https://<PROJECT_ID>.firebaseapp.com` | Google tự động cấp & quản lý (Miễn phí) |
| **Cloud API (`apps/api`)** | `https://devicenet-api-<HASH>-<REGION>.a.run.app` | Google Cloud Run tự động cấp (Miễn phí) |
| **MQTT Broker (WSS Web)** | `wss://<VM_PUBLIC_IP>.sslip.io:8084/mqtt` | Caddy tự động xin Let's Encrypt qua DNS wildcard `sslip.io` |
| **MQTT Broker (MQTTS Hub)** | `<VM_PUBLIC_IP>:8883` | Caddy / EMQX TLS certs |

---

## 3. HƯỚNG DẪN TRIỂN KHAI — CÁCH 1: TỐI ƯU 0 ĐỒNG (KHUYÊN DÙNG)

> **Mục tiêu**: Tận dụng VM `e2-micro` sẵn có, cài đặt EMQX 5.8 và Caddy dạng Native Service qua `systemd` để không tốn 100MB RAM cho Docker.

### Bước 1: Chuẩn bị GCP APIs
Chạy các lệnh sau từ máy dev (đã login `gcloud`):
```bash
gcloud config set project <PROJECT_ID>

gcloud services enable \
  run.googleapis.com \
  firestore.googleapis.com \
  secretmanager.googleapis.com \
  firebase.googleapis.com \
  firebasehosting.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com
```

### Bước 2: Tạo Secret Token cho EMQX & API
```bash
# Tạo ngẫu nhiên 2 chuỗi bí mật
SHARED_TOKEN=$(openssl rand -hex 24)
ADMIN_KEY=$(openssl rand -hex 24)

# Lưu vào Secret Manager
gcloud secrets create emqx-shared-token --replication-policy="automatic"
echo -n "$SHARED_TOKEN" | gcloud secrets versions add emqx-shared-token --data-file=-

gcloud secrets create emqx-admin-key --replication-policy="automatic"
echo -n "$ADMIN_KEY" | gcloud secrets versions add emqx-admin-key --data-file=-
```

### Bước 3: Mở Firewall Rules trên GCP cho VM hiện tại
Mở các cổng cần thiết cho MQTT và Caddy vào VM:
```bash
# Port 8883 (MQTTS cho Hub)
gcloud compute firewall-rules create allow-emqx-mqtt \
  --allow=tcp:8883 --target-tags=zalo-bot,emqx-server --source-ranges=0.0.0.0/0 \
  --description="Allow MQTTS for DeviceNet Hub"

# Port 8084 (WSS cho Browser Web PWA)
gcloud compute firewall-rules create allow-emqx-wss \
  --allow=tcp:8084 --target-tags=zalo-bot,emqx-server --source-ranges=0.0.0.0/0 \
  --description="Allow WSS for DeviceNet Web"

# Port 80 & 443 (HTTP/HTTPS cho Caddy ACME challenge và API reverse proxy)
gcloud compute firewall-rules create allow-caddy-web \
  --allow=tcp:80,tcp:443 --target-tags=zalo-bot,emqx-server --source-ranges=0.0.0.0/0 \
  --description="Allow HTTP/HTTPS for Caddy"

# Port 18083 (EMQX Dashboard - CHỈ cho phép IP cá nhân của admin)
MY_IP=$(curl -s https://ifconfig.me/ip)
gcloud compute firewall-rules create allow-emqx-admin \
  --allow=tcp:18083 --target-tags=zalo-bot,emqx-server --source-ranges="${MY_IP}/32" \
  --description="Allow EMQX Dashboard for Admin only"
```
*(Ghi chú: Thay `--target-tags` bằng tag mạng thực tế của VM hiện tại).*

---

### Bước 4: Cài đặt Native Caddy & EMQX 5.8 trên VM (Không dùng Docker)
SSH vào máy ảo `e2-micro`:
```bash
gcloud compute ssh <TEN_VM_CUA_BAN>
```

1. **Cài đặt Caddy qua APT chính thức**:
   ```bash
   sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
   curl -1sLF 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLF 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
   sudo apt update
   sudo apt install caddy -y
   ```

2. **Cài đặt EMQX 5.8 OSS qua APT chính thức**:
   ```bash
   curl -s https://assets.emqx.com/scripts/install-emqx-deb.sh | sudo bash
   sudo apt install emqx -y
   ```

3. **Cấu hình Caddyfile**:
   Lấy IP public của VM:
   ```bash
   VM_IP=$(curl -s -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip)
   ```
   Tạo file `/etc/caddy/Caddyfile`:
   ```caddy
   # Tự động cấp SSL Let's Encrypt qua sslip.io
   {VM_IP}.sslip.io {
     encode gzip

     # Reverse proxy cho EMQX Dashboard REST API
     handle /api/v5/* {
       reverse_proxy 127.0.0.1:18083
     }

     # Health check
     handle /health {
       respond "OK" 200
     }

     respond 404
   }
   ```
   *(Thay `{VM_IP}` bằng địa chỉ IP thật, ví dụ `34.142.10.20.sslip.io`)*.
   Khởi động lại Caddy:
   ```bash
   sudo systemctl restart caddy
   ```

4. **Cấu hình EMQX (`/etc/emqx/cluster.hocon`)**:
   Sao chép nội dung từ `infra/emqx/cluster.hocon` vào `/etc/emqx/cluster.hocon`. Điền các biến môi trường:
   * `FIREBASE_PROJECT_ID`: `<PROJECT_ID>`
   * `API_HOST`: Domain Cloud Run API hoặc IP/Host API
   * `EMQX_SHARED_TOKEN`: Token lấy từ Secret Manager
   Khởi động EMQX service:
   ```bash
   sudo systemctl enable --now emqx
   sudo systemctl status emqx
   ```

---

### Bước 5: Build và Deploy Cloud Run API (`apps/api`)
Từ máy dev:
1. **Tạo Service Account cho Cloud Run**:
   ```bash
   gcloud iam service-accounts create devicenet-api-sa --display-name="DeviceNet API SA"

   # Cấp quyền Firestore, Firebase Auth và Secret Manager
   gcloud projects add-iam-policy-binding <PROJECT_ID> \
     --member="serviceAccount:devicenet-api-sa@<PROJECT_ID>.iam.gserviceaccount.com" \
     --role="roles/datastore.user"

   gcloud projects add-iam-policy-binding <PROJECT_ID> \
     --member="serviceAccount:devicenet-api-sa@<PROJECT_ID>.iam.gserviceaccount.com" \
     --role="roles/firebase.admin"

   gcloud projects add-iam-policy-binding <PROJECT_ID> \
     --member="serviceAccount:devicenet-api-sa@<PROJECT_ID>.iam.gserviceaccount.com" \
     --role="roles/secretmanager.secretAccessor"
   ```

2. **Build Container Image qua Cloud Build**:
   ```bash
   gcloud builds submit --tag gcr.io/<PROJECT_ID>/devicenet-api:latest -f apps/api/Dockerfile .
   ```

3. **Deploy lên Cloud Run**:
   ```bash
   gcloud run deploy devicenet-api \
     --image gcr.io/<PROJECT_ID>/devicenet-api:latest \
     --platform managed \
     --region asia-southeast1 \
     --allow-unauthenticated \
     --service-account devicenet-api-sa@<PROJECT_ID>.iam.gserviceaccount.com \
     --min-instances 0 \
     --max-instances 2 \
     --cpu 1 \
     --memory 512Mi \
     --set-env-vars FIREBASE_PROJECT_ID=<PROJECT_ID>,DN_MQTT_HOST=<VM_PUBLIC_IP>,DN_MQTT_PORT=8883,DN_MQTT_WSS_PORT=8084
   ```
   Lưu lại URL trả về (ví dụ: `https://devicenet-api-xxx-as.a.run.app`).

---

### Bước 6: Deploy Firestore Rules & Indexes
```bash
# Deploy security rules
firebase deploy --only firestore:rules

# Deploy composite indexes
firebase deploy --only firestore:indexes
```

---

### Bước 7: Build và Deploy Web PWA lên Firebase Hosting
1. Tạo file `apps/web/.env.production`:
   ```ini
   VITE_MODE=cloud
   VITE_USE_EMULATOR=0
   VITE_FIREBASE_PROJECT_ID=<PROJECT_ID>
   VITE_FIREBASE_API_KEY=<FIREBASE_API_KEY>
   VITE_FIREBASE_AUTH_DOMAIN=<PROJECT_ID>.firebaseapp.com
   VITE_API_URL=https://devicenet-api-xxx-as.a.run.app
   VITE_MQTT_URL=wss://<VM_PUBLIC_IP>.sslip.io:8084/mqtt
   ```

2. Build và deploy:
   ```bash
   pnpm --filter @devicenet/web build
   firebase deploy --only hosting
   ```
   Web sẵn sàng tại `https://<PROJECT_ID>.web.app`.

---

### Bước 8: Kết nối Local Hub (`apps/hub-agent`) lên Cloud
Tại máy local có cắm USB Dongle:
1. Mở file cấu hình Hub `.data/hub/config.yaml` (hoặc biến môi trường):
   ```yaml
   apiBaseUrl: "https://devicenet-api-xxx-as.a.run.app"
   emulator: false
   cloudMqttTls: true
   ```
2. Khởi động Hub:
   ```powershell
   pnpm dev:real
   ```
3. Truy cập `https://<PROJECT_ID>.web.app`, đăng nhập tài khoản Google.
4. Mở modal **Liên kết Hub** (Claim Hub), nhập mã claim code từ Hub (`http://localhost:8080/setup`).
5. Hub sẽ tự động nhận chứng chỉ bảo mật và kết nối thẳng lên EMQX Cloud Broker (`:8883`), biểu tượng trạng thái chuyển sang **Online**.

---

## 4. HƯỚNG DẪN TRIỂN KHAI — CÁCH 2: DEDICATED VM (TERRAFORM)

> **Mục tiêu**: Sử dụng Terraform để tự động dựng máy ảo riêng biệt `e2-small` Debian 12 chạy Docker Compose theo thiết kế hạ tầng gốc của Claude (`infra/terraform/`).

### Bước 1: Khai báo cấu hình Terraform
Tạo file `infra/terraform/terraform.tfvars`:
```hcl
gcp_project_id      = "<PROJECT_ID>"
firebase_project_id = "<PROJECT_ID>"
gcp_region          = "asia-southeast1"
admin_ip            = "<YOUR_PUBLIC_IP>/32"
hosting_domain      = "<PROJECT_ID>.web.app"
api_base_url        = "https://devicenet-api-placeholder"
vm_machine_type     = "e2-small"
```

### Bước 2: Chạy Terraform
```bash
cd infra/terraform
terraform init
terraform plan -out=tfplan
terraform apply tfplan
```
Terraform sẽ tự động tạo:
* Service Account & IAM Roles.
* VM Compute Engine kèm startup script (`infra/vm/startup.sh`).
* Firewall rules 8883, 8084, 443, 80, 18083.
* Firestore Database & TTL indexes.
* Secret Manager.

### Bước 3: Build Container & Deploy Web
Thực hiện các bước tương tự Bước 5, 6, 7 ở **Cách 1** để hoàn tất Cloud Run API và Web Hosting.

---

## 5. Quy trình Vận hành & Giám sát (Operations & Troubleshooting)

### 1. Kiểm tra tài nguyên VM (Đặc biệt khi dùng Cách 1):
```bash
# Xem dung lượng RAM và Swap
free -h

# Xem tiến trình nào đang chiếm RAM nhiều nhất
ps aux --sort=-%mem | head -n 10

# Kiểm tra trạng thái service
sudo systemctl status emqx
sudo systemctl status caddy
```

### 2. Xem logs dịch vụ:
```bash
# Log EMQX
sudo journalctl -u emqx -f --no-tail

# Log Caddy
sudo journalctl -u caddy -f --no-tail

# Log Cloud Run API
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=devicenet-api" --limit 50
```

### 3. Cài đặt Cảnh báo Ngân sách (Budget Alert):
Để đảm bảo không bao giờ bị tính phí bất ngờ:
1. Vào **GCP Console** > **Billing** > **Budgets & alerts**.
2. Đặt ngân sách: **15 USD/tháng**.
3. Cài đặt gửi thông báo qua email khi đạt 50%, 80% và 100%.
