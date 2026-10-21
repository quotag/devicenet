# Runbook: Triển khai DeviceNet lên Google Cloud Platform (GCP)

Tài liệu này là hướng dẫn chính thức, tuần tự và khép kín để triển khai toàn bộ hệ thống **DeviceNet** lên Google Cloud Platform (GCP). Mọi lệnh có thể copy-paste trực tiếp và được kiểm nghiệm để không gặp lỗi cấu hình hay phân quyền.

---

## 1. Kiến trúc hệ thống trên GCP

| Thành phần | Dịch vụ GCP | Ghi chú cấu hình | Chi phí ước tính |
| :--- | :--- | :--- | :--- |
| **Web PWA** | Firebase Hosting | CDN toàn cầu, HTTPS tự động, phục vụ `web.app` và `firebaseapp.com` | Miễn phí |
| **Backend API** | Cloud Run (v1/v2) | Fastify 5 trên Node 22, `min_instances = 0`, `max_instances = 3`, scale-to-zero | Miễn phí (trong free tier) |
| **Cơ sở dữ liệu** | Cloud Firestore | Native Mode, vùng `asia-southeast1`, quản lý rules & TTLs tự động | Miễn phí (trong free tier) |
| **Bảo mật Secrets** | Secret Manager | Lưu trữ token bí mật (`emqx-shared-token`, `emqx-admin-key`, v.v.) | Miễn phí (trong free tier) |
| **MQTT Broker** | Compute Engine VM (`e2-small`) | EMQX 5.8 OSS + Caddy proxy + Certbot standalone | ~$12 - $14/tháng (hoặc 0đ nếu dùng `e2-micro` + 2GB swap) |

---

## 2. Bảng biến môi trường và Domain

| Biến môi trường / Cấu hình | Ý nghĩa | Giá trị mẫu |
| :--- | :--- | :--- |
| `PROJECT_ID` | GCP Project ID | `devicenet-prod-123` |
| `REGION` | Vùng triển khai GCP | `asia-southeast1` |
| `VM_IP` | IP tĩnh của VM MQTT Broker | `34.142.x.x` |
| `MQTT_DOMAIN` | Domain TLS của MQTT Broker | `<VM_IP>.sslip.io` (hoặc domain riêng) |
| `API_URL` | URL công khai của Cloud Run API | `https://devicenet-api-<hash>-as.a.run.app` |
| `EMQX_SHARED_TOKEN` | Token bí mật giữa API và EMQX | Chuỗi ngẫu nhiên dài $\ge$ 32 ký tự |

---

## 3. Bước 1: Chuẩn bị GCP Project & Bật APIs

Chạy trên máy dev (đã cài đặt và đăng nhập `gcloud`):

```bash
# Đặt project mặc định
export PROJECT_ID="<YOUR_GCP_PROJECT_ID>"
export REGION="asia-southeast1"
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

## 4. Bước 2: Tạo Secret Manager Secrets

```bash
# 1. Tạo token chia sẻ giữa API và EMQX (tối thiểu 32 ký tự)
EMQX_SHARED_TOKEN=$(openssl rand -hex 24)
gcloud secrets create emqx-shared-token --replication-policy="automatic"
echo -n "$EMQX_SHARED_TOKEN" | gcloud secrets versions add emqx-shared-token --data-file=-

# 2. Tạo API Key và Secret cho EMQX Admin (dùng khi Cloud Run gửi lệnh kick)
EMQX_ADMIN_KEY=$(openssl rand -hex 16)
EMQX_ADMIN_SECRET=$(openssl rand -hex 24)
gcloud secrets create emqx-admin-key --replication-policy="automatic"
echo -n "$EMQX_ADMIN_KEY" | gcloud secrets versions add emqx-admin-key --data-file=-

gcloud secrets create emqx-admin-secret --replication-policy="automatic"
echo -n "$EMQX_ADMIN_SECRET" | gcloud secrets versions add emqx-admin-secret --data-file=-

# 3. Tạo mật khẩu khởi tạo cho EMQX Dashboard admin
EMQX_DASHBOARD_PASS=$(openssl rand -hex 12)
gcloud secrets create emqx-dashboard-password --replication-policy="automatic"
echo -n "$EMQX_DASHBOARD_PASS" | gcloud secrets versions add emqx-dashboard-password --data-file=-

echo "Đã tạo đầy đủ các secret an toàn trong Secret Manager."
```

---

## 5. Bước 3: Triển khai Hạ tầng (Terraform hoặc Thủ công)

### Lựa chọn A: Triển khai tự động bằng Terraform (Khuyến nghị)

```bash
cd infra/terraform

# Điền file cấu hình terraform.tfvars
cat > terraform.tfvars << EOF
gcp_project_id       = "${PROJECT_ID}"
gcp_region           = "${REGION}"
firebase_project_id  = "${PROJECT_ID}"
firebase_web_api_key = "<YOUR_FIREBASE_WEB_API_KEY>"
vm_machine_type      = "e2-small"
api_min_instances    = 0
api_max_instances    = 3
EOF

terraform init
terraform apply -auto-approve

# Lưu lại các giá trị output
export VM_IP=$(terraform output -raw static_external_ip)
export MQTT_DOMAIN=$(terraform output -raw vm_mqtt_domain)
cd ../..
```

### Lựa chọn B: Tạo mạng, IP tĩnh và Firewall bằng gcloud CLI

```bash
# 1. Cấp IP tĩnh
gcloud compute addresses create devicenet-emqx-ip --region="$REGION"
export VM_IP=$(gcloud compute addresses describe devicenet-emqx-ip --region="$REGION" --format="value(address)")
export MQTT_DOMAIN="${VM_IP}.sslip.io"

# 2. Tạo Firewall Rules
# Mở 8883 (MQTTS cho Hub)
gcloud compute firewall-rules create devicenet-allow-mqtts \
  --allow=tcp:8883 --target-tags=emqx-server --source-ranges=0.0.0.0/0 \
  --description="Allow MQTTS for Hub Agent"

# Mở 8084 (WSS cho Web App)
gcloud compute firewall-rules create devicenet-allow-wss \
  --allow=tcp:8084 --target-tags=emqx-server --source-ranges=0.0.0.0/0 \
  --description="Allow WSS for Web Browser"

# Mở 443 (HTTPS cho Caddy kick proxy)
gcloud compute firewall-rules create devicenet-allow-https \
  --allow=tcp:443 --target-tags=emqx-server --source-ranges=0.0.0.0/0 \
  --description="Allow HTTPS for Caddy kick proxy"

# Mở 80 (HTTP cho Certbot ACME standalone)
gcloud compute firewall-rules create devicenet-allow-http \
  --allow=tcp:80 --target-tags=emqx-server --source-ranges=0.0.0.0/0 \
  --description="Allow HTTP for Certbot ACME validation"

# Lưu ý: Cổng 1883, 8083 và 18083 KHÔNG mở ngoài firewall!
```

---

## 6. Bước 4: Thiết lập EMQX 5.8 & Caddy trên VM

### 1. Tạo VM và gán Service Account
```bash
# Tạo Service Account cho VM
gcloud iam service-accounts create devicenet-emqx-vm-sa --display-name="EMQX VM Service Account"

# Cấp quyền đọc Secret Manager và ghi Log
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:devicenet-emqx-vm-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:devicenet-emqx-vm-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/logging.logWriter"

# Tạo Compute Engine VM
gcloud compute instances create devicenet-emqx-vm \
  --zone="${REGION}-a" \
  --machine-type="e2-small" \
  --image-family="debian-12" \
  --image-project="debian-cloud" \
  --address="$VM_IP" \
  --tags="emqx-server" \
  --service-account="devicenet-emqx-vm-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --scopes="cloud-platform" \
  --metadata-from-file=startup-script=infra/vm/startup.sh
```

### 2. Kiểm tra trạng thái khởi động VM
```bash
# Theo dõi log startup script trên VM:
gcloud compute ssh devicenet-emqx-vm --zone="${REGION}-a" -- \
  "sudo tail -f /var/log/devicenet-startup.log"
```
Khi thấy dòng `=== DeviceNet VM Startup Completed ===`, stack Docker Compose (`devicenet-emqx` và `devicenet-caddy`) đã hoạt động.

### 3. [MANUAL] Truy cập Dashboard qua SSH Tunnel & Tạo API Key
EMQX Dashboard được bind tại `127.0.0.1:18083` trên VM (không mở ra Internet). Để truy cập:
```bash
# Tạo SSH tunnel chuyển tiếp cổng 18083 về máy dev:
gcloud compute ssh devicenet-emqx-vm --zone="${REGION}-a" -- -L 18083:localhost:18083
```
- Mở trình duyệt tại: `http://localhost:18083`
- Đăng nhập với username: `admin`
- Mật khẩu mặc định: `public` (hoặc mật khẩu lấy từ secret `emqx-dashboard-password` nếu đã nạp).
- **Đổi mật khẩu ngay lần đầu đăng nhập!**
- Vào **System** $\rightarrow$ **API Keys** $\rightarrow$ Tạo API Key với Key: `<EMQX_ADMIN_KEY>`, Secret: `<EMQX_ADMIN_SECRET>` tương ứng với giá trị đã tạo ở Bước 2.

---

## 7. Bước 5: Build và Deploy Cloud Run API

### 1. Tạo Service Account cho Cloud Run
```bash
gcloud iam service-accounts create devicenet-api-sa --display-name="DeviceNet API SA"

# Quyền Firestore (Datastore User)
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:devicenet-api-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

# Quyền Firebase Auth Admin (tạo custom claims, tra cứu user)
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:devicenet-api-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/firebaseauth.admin"

# Quyền Service Account Token Creator TRÊN CHÍNH NÓ (bắt buộc để createCustomToken hoạt động)
gcloud iam service-accounts add-iam-policy-binding \
  "devicenet-api-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --member="serviceAccount:devicenet-api-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator"

# Quyền đọc Secret Manager
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:devicenet-api-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### 2. Tạo Artifact Registry Repo và Build Container Image
```bash
# Tạo Artifact Registry Repository
gcloud artifacts repositories create devicenet \
  --repository-format=docker \
  --location="$REGION" \
  --description="DeviceNet container repository" || true

# Build image bằng Cloud Build (sử dụng Dockerfile chuẩn xác)
gcloud builds submit \
  --tag="${REGION}-docker.pkg.dev/${PROJECT_ID}/devicenet/api:latest" \
  -f apps/api/Dockerfile .
```

### 3. Deploy lên Cloud Run
```bash
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
  --set-env-vars="NODE_ENV=production,PORT=8080,GCP_PROJECT_ID=${PROJECT_ID},FIREBASE_PROJECT_ID=${PROJECT_ID},FIREBASE_WEB_API_KEY=<YOUR_FIREBASE_WEB_API_KEY>,DN_MQTT_HOST=${MQTT_DOMAIN},DN_MQTT_PORT=8883,DN_MQTT_WSS_PORT=8084,HOSTING_ORIGIN=https://${PROJECT_ID}.web.app,https://${PROJECT_ID}.firebaseapp.com,EMQX_ADMIN_URL=https://${MQTT_DOMAIN},TRUST_PROXY=true" \
  --set-secrets="EMQX_SHARED_TOKEN=emqx-shared-token:latest,EMQX_ADMIN_KEY=emqx-admin-key:latest,EMQX_ADMIN_SECRET=emqx-admin-secret:latest"
```

Lấy URL của API:
```bash
export API_URL=$(gcloud run services describe devicenet-api --region="$REGION" --format="value(status.url)")
echo "API URL: $API_URL"

# Kiểm tra probe healthz
curl -fsSL "${API_URL}/healthz"
# Kết quả mong đợi: {"status":"ok","uptime":...}
```

---

## 8. Bước 6: Deploy Firestore Rules & Indexes

```bash
# Deploy Firestore security rules
firebase deploy --only firestore:rules --project "$PROJECT_ID"

# Deploy Firestore composite indexes & TTL configurations
firebase deploy --only firestore:indexes --project "$PROJECT_ID"
```

---

## 9. Bước 7: Cấu hình Firebase Authentication & Deploy Web App

### 1. [MANUAL] Bật Google Provider trong Firebase Console
1. Truy cập [Firebase Console](https://console.firebase.google.com/) $\rightarrow$ Chọn dự án `$PROJECT_ID`.
2. Vào **Build** $\rightarrow$ **Authentication** $\rightarrow$ Tab **Sign-in method**.
3. Bật nhà cung cấp **Google**.
4. Vào tab **Settings** $\rightarrow$ **Authorized domains**:
   - Xác nhận có `<PROJECT_ID>.firebaseapp.com` và `<PROJECT_ID>.web.app`.
   - Nếu bạn dùng custom domain cho Web, thêm custom domain vào đây.
5. Kiểm tra mục **OAuth consent screen** trên Google Cloud Console (chọn External, thêm user test nếu app chưa publish).

### 2. Build và Deploy Web PWA
Tạo file `apps/web/.env.production`:
```ini
VITE_MODE=cloud
VITE_API_URL=https://devicenet-api-your-hash-as.a.run.app
VITE_MQTT_URL=wss://<YOUR_VM_IP>.sslip.io:8084/mqtt
VITE_FIREBASE_PROJECT_ID=<YOUR_GCP_PROJECT_ID>
VITE_FIREBASE_API_KEY=<YOUR_FIREBASE_WEB_API_KEY>
VITE_FIREBASE_AUTH_DOMAIN=<YOUR_GCP_PROJECT_ID>.firebaseapp.com
```

Thực hiện build bằng lệnh chính xác (package name là `web`):
```bash
# Build web package
pnpm --filter web build

# Deploy lên Firebase Hosting
firebase deploy --only hosting --project "$PROJECT_ID"
```
Ứng dụng Web đã sẵn sàng truy cập tại: `https://${PROJECT_ID}.web.app`.

---

## 10. Bước 8: Kết nối Hub Thực tế (`apps/hub-agent`) lên Cloud

Tại máy chủ chạy Hub vật lý (Windows hoặc Linux):

1. **Cấu hình file `config.yaml`** trong thư mục dữ liệu của hub (`.data/hub/config.yaml` hoặc `C:\ProgramData\DeviceNet\data\config.yaml`):
   ```yaml
   apiBaseUrl: "https://devicenet-api-your-hash-as.a.run.app"
   emulator: false
   cloudMqttTls: true
   ```
2. **Khởi động Hub Agent**:
   - Nếu chạy service Windows: `Start-Service DeviceNetHub`
   - Hoặc chạy trực tiếp: `pnpm dev:real`
3. **Mở giao diện LAN của Hub**:
   - Truy cập `http://localhost:8080/setup`
   - Giao diện sẽ hiển thị mã claim gồm 8 ký tự (ví dụ: `ABC1-2345`).
4. **Liên kết Hub trên Web App**:
   - Đăng nhập `https://${PROJECT_ID}.web.app` bằng tài khoản Google.
   - Nhập mã claim từ bước 3 $\rightarrow$ Nhấn **Liên kết Hub**.
   - API sẽ xác thực mã, cấp credential chứa certificate và thông tin kết nối Firestore prod.
   - Hub agent tự động lưu credential vào đĩa, khởi động cầu nối MQTTS tới Cloud Broker và chuyển sang trạng thái `online`.

---

## 11. Xử lý sự cố thường gặp & Phục hồi (Troubleshooting)

### Hub bị kẹt mã claim (Stuck Claim Code)
- **Hiện tượng**: Hub hiển thị claim code, web báo claim thành công nhưng Hub bị tắt đột ngột trước khi lưu credential vào đĩa.
- **Nguyên nhân**: Mã claim đã được sử dụng (one-time use), Hub chưa kịp lưu file `credentials.json`.
- **Cách xử lý**:
  1. Trên Web App: Vào **Cài đặt** $\rightarrow$ **Quản lý Hub** $\rightarrow$ Chọn **Xóa Hub** (thao tác này gọi `deleteHubCascade` dọn dẹp sạch sẽ tài nguyên trên Cloud).
  2. Trên máy Hub: Truy cập `http://localhost:8080/setup`, nhấn nút **Cài đặt lại Hub** (Reset). Hub sẽ tự động xin mã claim mới từ API.
  3. Nhập mã claim mới trên Web App.

### Mô hình tin cậy mạng LAN (LAN Trust Model)
- Giao diện cục bộ `http://<hub-ip>:8080/setup` được thiết kế theo mô hình tin cậy tiếp cận vật lý (physical proximity trust model).
- Route `POST /setup/reset` được bảo vệ bằng:
  - Private IP guard (chỉ cho phép private IP range).
  - CSRF check (`Sec-Fetch-Site` không cho phép cross-site request từ trang web lạ).
  - CSRF token ngẫu nhiên so sánh bằng `timingSafeEqual`.
  - Rate limit 3 lần/giờ.
- Không có bất kỳ secret/password nào bị lộ qua các API của LAN server.

### Kiểm tra Handshake TLS của MQTTS
```bash
openssl s_client -connect "${MQTT_DOMAIN}:8883" -servername "${MQTT_DOMAIN}"
# Đầu ra phải hiển thị: Verify return code: 0 (ok)
```

### Chứng chỉ Let's Encrypt bị Rate-Limit trên `sslip.io`
- Do `sslip.io` được dùng chung trên toàn thế giới, Let's Encrypt có thể giới hạn số lượng cert cấp trong tuần.
- **Phương án dự phòng**:
  1. Đăng ký tên miền miễn phí tại [DuckDNS](https://www.duckdns.org/) (ví dụ: `my-devicenet.duckdns.org`) và trỏ về `$VM_IP`.
  2. Hoặc sử dụng tên miền riêng của bạn, tạo bản ghi A trỏ về `$VM_IP`.
  3. Cập nhật biến `MQTT_DOMAIN` tương ứng.
