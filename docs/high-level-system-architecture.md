# DeviceNet: High-Level System Architecture & End-to-End Flows

Tài liệu này mô tả chi tiết kiến trúc hệ thống mức cao (**High-Level System Architecture**) của **DeviceNet**, bao gồm thiết kế đa người dùng (**Multi-tenancy**), cơ chế xác thực kép (**Dual Authentication & Authorization**) trên Cloud EMQX Broker, kiến trúc khối của **Local Hub** (Windows & Linux), và toàn cảnh đường đi của một lệnh điều khiển từ Client tới thiết bị vật lý (**End-to-End Command Flow**).

---

## 1. Sơ đồ Kiến trúc Tổng quan (System Overview Block Diagram)

```mermaid
flowchart TB
    %% Multi-tenant Clients %%
    subgraph MultiTenantClients ["1. Multi-Tenant Client Layer"]
        subgraph TenantA ["Tenant A (User A - Google Account A)"]
            ClientA1["Web PWA A1 (Chrome/Desktop)"]
            ClientA2["Web PWA A2 (Mobile iOS/Android)"]
        end
        subgraph TenantB ["Tenant B (User B - Google Account B)"]
            ClientB1["Web PWA B1 (Desktop)"]
        end
    end

    %% Cloud Infrastructure %%
    subgraph CloudGCP ["2. Cloud Platform (Google Cloud Platform - 0 Cost Always Free)"]
        subgraph CloudIdentity ["Identity & Auth Provider"]
            GoogleOAuth["Google Identity / OAuth 2.0"]
            FirebaseAuth["Firebase Authentication"]
            GoogleJWKS["Google JWKS Public Keys Endpoint"]
        end

        subgraph ServerlessAPI ["Serverless Cloud Run API (Fastify 5)"]
            ApiServer["Cloud Run: devicenet-api"]
            EmqxAuthRoute["POST /v1/emqx/auth (Hub Auth)"]
            EmqxAclRoute["POST /v1/emqx/acl (Hub ACL)"]
            EmqxWebhookRoute["POST /v1/emqx/webhook (Mirror)"]
        end

        subgraph CloudData ["Cloud Storage"]
            FirestoreDB[("Cloud Firestore: tenants, hubs, rules, sites")]
            SecretMgr["Secret Manager: devicenet-secrets"]
        end

        subgraph CloudBroker ["Compute Engine VM (e2-micro / us-central1)"]
            CaddyProxy["Caddy 2.8 Kick Proxy (HTTPS :443)"]
            EMQXBroker["EMQX 5.8 OSS Broker (Native Systemd)"]
            subgraph EmqxEngines ["EMQX Core Engines"]
                JwtAuth["JWT Authenticator (Google JWKS)"]
                HttpAuth["HTTP Password Authenticator (API Webhook)"]
                AclEngine["Topic ACL Engine (Tenant Isolation)"]
                RuleEngine["Rule Engine (Hub Status Webhook)"]
            end
        end
    end

    %% Edge / Local Hub Layer %%
    subgraph LocalHubLayer ["3. Edge / Local Hub Layer (Windows & Linux)"]
        subgraph LocalHubA ["Local Hub 01 (Home of Tenant A)"]
            HubAgentA["Hub Agent Core (Node.js 22 Runtime)"]
            LocalDbA[("Local SQLite: hub.db, history")]
            LocalMosquittoA["Local Mosquitto (:1883 & :9001)"]
            Z2MA["Zigbee2MQTT Service"]
            DongleA["USB Zigbee Dongle (Sonoff / CH9102)"]
        end

        subgraph LocalHubB ["Local Hub 02 (Home of Tenant B)"]
            HubAgentB["Hub Agent Core (Node.js 22 Runtime)"]
            DongleB["USB Zigbee Dongle"]
        end
    end

    %% Physical Smart Devices %%
    subgraph PhysicalDevices ["4. Physical Zigbee Devices (Mesh Network)"]
        PlugA["Smart Plug Relay (Living Room)"]
        SensorA["Temperature / Humidity Sensor"]
        SwitchB["Smart Wall Switch"]
    end

    %% Connections %%
    ClientA1 -- "1. Google Login" --> FirebaseAuth
    ClientB1 -- "1. Google Login" --> FirebaseAuth
    FirebaseAuth -. "Verify OAuth" .-> GoogleOAuth

    ClientA1 == "2. WSS :8084 (Firebase JWT)" ==> EMQXBroker
    ClientB1 == "2. WSS :8084 (Firebase JWT)" ==> EMQXBroker
    EMQXBroker -. "JWKS Verify (Zero API calls)" .-> GoogleJWKS

    HubAgentA == "MQTTS :8883 (hub:id + secret)" ==> EMQXBroker
    HubAgentB == "MQTTS :8883 (hub:id + secret)" ==> EMQXBroker

    HttpAuth --> EmqxAuthRoute
    AclEngine --> EmqxAclRoute
    RuleEngine --> EmqxWebhookRoute

    EmqxAuthRoute --> FirestoreDB
    EmqxAclRoute --> FirestoreDB
    EmqxWebhookRoute --> FirestoreDB
    ApiServer --> FirestoreDB

    HubAgentA <--> LocalMosquittoA
    LocalMosquittoA <--> Z2MA
    Z2MA <--> DongleA
    DongleA <--> PlugA
    DongleA <--> SensorA
    DongleB <--> SwitchB

    classDef clientClass fill:#E0F2FE,stroke:#0284C7,stroke-width:2px,color:#0F172A;
    classDef cloudClass fill:#FEF3C7,stroke:#D97706,stroke-width:2px,color:#0F172A;
    classDef brokerClass fill:#DCFCE7,stroke:#16A34A,stroke-width:2px,color:#0F172A;
    classDef hubClass fill:#F3E8FF,stroke:#9333EA,stroke-width:2px,color:#0F172A;
    classDef deviceClass fill:#FFE4E6,stroke:#E11D48,stroke-width:2px,color:#0F172A;

    class ClientA1,ClientA2,ClientB1 clientClass;
    class ApiServer,FirestoreDB,SecretMgr,GoogleOAuth,FirebaseAuth,GoogleJWKS cloudClass;
    class CaddyProxy,EMQXBroker,JwtAuth,HttpAuth,AclEngine,RuleEngine brokerClass;
    class HubAgentA,HubAgentB,LocalDbA,LocalMosquittoA,Z2MA,DongleA,DongleB hubClass;
    class PlugA,SensorA,SwitchB deviceClass;
```

---

## 2. Luồng Xác thực & Phân quyền (Authentication & Authorization Flow)

Hệ thống xử lý xác thực qua hai nhánh độc lập nhưng hội tụ tại **EMQX Broker**:

```mermaid
sequenceDiagram
    autonumber
    actor UserA as "Người dùng Web A (Google Account)"
    participant WebA as "Web PWA (Client A)"
    participant Google as "Google Auth / JWKS"
    participant EMQX as "Cloud EMQX Broker"
    participant API as "Cloud Run API"
    participant DB as "Cloud Firestore"
    participant Hub as "Local Hub Agent (Physical)"

    %% NHÁNH 1: WEB CLIENT AUTH %%
    rect rgb(235, 248, 255)
        Note over UserA, Google: [NHÁNH 1] Xác thực Web Client qua Google Account (Tự động 100%)
        UserA->>WebA: Bấm "Đăng nhập Google"
        WebA->>Google: Xác thực OAuth 2.0
        Google-->>WebA: Cấp Firebase ID Token (JWT chứa uid, tenantId, exp)
        WebA->>EMQX: CONNECT WSS :8084 (username: uid, password: JWT_Token)
        Note over EMQX, Google: EMQX kiểm tra chữ ký số qua JWKS Endpoint
        EMQX->>Google: Tải Google Public Keys (JWKS cache)
        Google-->>EMQX: Public Keys (X.509 certs)
        EMQX-->>WebA: CONNACK (Thành công - Không tốn request Cloud Run)
        WebA->>EMQX: SUBSCRIBE "t/tenant_A/#"
        Note over EMQX: EMQX ACL kiểm tra: Token tenant_A = Topic tenant_A -> ALLOW
        EMQX-->>WebA: SUBACK
    end

    %% NHÁNH 2: HUB AGENT AUTH %%
    rect rgb(245, 243, 255)
        Note over Hub, DB: [NHÁNH 2] Xác thực Hub Vật lý qua HTTP Webhook (Tự động 100%)
        Hub->>EMQX: CONNECT MQTTS :8883 (username: "hub:hub_123", password: "hubSecret_xyz")
        Note over EMQX: Mật khẩu không phải JWT -> Chuyển sang HTTP Webhook
        EMQX->>API: POST /v1/emqx/auth (username, password, clientid)
        API->>DB: Tra cứu Firestore Hub Credential
        DB-->>API: Credential hợp lệ
        API-->>EMQX: {"result": "allow", "is_superuser": false}
        EMQX-->>Hub: CONNACK (Thành công)
        Hub->>EMQX: SUBSCRIBE "t/tenant_A/h/hub_123/d/+/set"
        EMQX->>API: POST /v1/emqx/acl (action: "subscribe", topic: "...")
        API-->>EMQX: {"result": "allow"}
        EMQX-->>Hub: SUBACK
    end

    %% BẢO VỆ MULTI-TENANT KHI CÓ USER KHÁC %%
    rect rgb(254, 242, 242)
        Note over UserA, EMQX: [BẢO VỆ ĐA THUÊ BAO] Khi User B (Google Account B) cố truy cập dữ liệu User A
        actor UserB as "Người dùng B (Google B)"
        UserB->>EMQX: SUBSCRIBE "t/tenant_A/#" (Với JWT của User B)
        Note over EMQX: ACL so sánh: JWT tenant_B != Topic tenant_A
        EMQX-->>UserB: Từ chối (ACL DENY - Ngắt quyền ngay lập tức)
    end
```

---

## 3. Kiến trúc Chi tiết Khối Local Hub (Windows & Linux)

Local Hub được thiết kế để chạy liên tục 24/7 trên cả **Windows** và **Linux** (Raspberry Pi, Mini PC) với cấu trúc dịch vụ phân tầng:

```mermaid
graph TB
    subgraph HostOS ["Host OS: Windows 10/11 Server HOẶC Linux (Debian / Ubuntu / Raspbian)"]
        subgraph ProcessSupervisor ["1. Supervisor & Lifecycle Manager"]
            WinService["Windows Service (WinSW)"]
            SystemdService["Linux Systemd (devicenet-hub.service)"]
            NodeRuntime["Node.js 22 LTS Engine"]
        end

        subgraph HubAgentApp ["2. @devicenet/hub-agent Core Runtime"]
            BridgeMod["Bridge Module (MQTT Local & Cloud Link)"]
            SyncMod["Sync Engine (Firestore onSnapshot Listener)"]
            AutoEngine["Automation Engine (Cron, SunCalc, Event Triggers)"]
            SetQueue["Sequential Device Queue (Concurrency = 1/device)"]
            LanServer["LAN HTTP Server (:8080/setup, :8080/api)"]
            StoreSqlite[("SQLite Engine: hub.db, history.db, config.json")]
        end

        subgraph LocalBroker ["3. Local Mosquitto Broker"]
            MosqTcp["TCP Listener: 127.0.0.1:1883"]
            MosqWs["WebSocket Listener: 0.0.0.0:9001 (LAN UI)"]
            MosqAcl["Local ACL: hub (readwrite #), z2m (zigbee2mqtt/#)"]
        end

        subgraph DriverLayer ["4. Hardware Abstraction & Driver Layer"]
            Z2MProcess["Zigbee2MQTT Standalone Runtime"]
            SerialAutoDetect["Auto Serial Port Detector (VID:PID)"]
            ComPort["Windows: COM3, COM4..."]
            TtyPort["Linux: /dev/serial/by-id/..., /dev/ttyUSB0"]
        end

        subgraph HardwareDongle ["5. Physical Interface"]
            UsbDongle["USB Zigbee 3.0 Coordinator (EFR32MG21 / CH343 / CP210x)"]
        end
    end

    subgraph ZigbeeMesh ["6. Zigbee 3.0 Radio Mesh Network"]
        RouterDevice["Smart Plug / Repeater (Router)"]
        BatteryDevice["Door Sensor / PIR Motion (End Device)"]
        RelayDevice["Smart Light Switch (Router)"]
    end

    WinService -.-> NodeRuntime
    SystemdService -.-> NodeRuntime
    NodeRuntime --> HubAgentApp

    HubAgentApp <--> MosqTcp
    BridgeMod <--> MosqTcp
    SetQueue --> MosqTcp

    Z2MProcess <--> MosqTcp
    Z2MProcess --> SerialAutoDetect
    SerialAutoDetect --> ComPort
    SerialAutoDetect --> TtyPort
    ComPort --> UsbDongle
    TtyPort --> UsbDongle

    UsbDongle <== "Zigbee IEEE 802.15.4 (2.4GHz)" ==> RouterDevice
    RouterDevice <--> BatteryDevice
    RouterDevice <--> RelayDevice

    classDef hostClass fill:#F8FAFC,stroke:#64748B,stroke-width:2px;
    classDef coreClass fill:#EFF6FF,stroke:#2563EB,stroke-width:2px;
    classDef brokerClass fill:#F0FDF4,stroke:#16A34A,stroke-width:2px;
    classDef driverClass fill:#FFF7ED,stroke:#EA580C,stroke-width:2px;
    classDef radioClass fill:#FDF2F8,stroke:#DB2777,stroke-width:2px;

    class HostOS hostClass;
    class HubAgentApp coreClass;
    class LocalBroker brokerClass;
    class DriverLayer driverClass;
    class HardwareDongle,ZigbeeMesh radioClass;
```

---

## 4. Block View: Toàn cảnh Một Lệnh Điều Khiển (End-to-End Command Flow)

Dưới đây là hành trình từng mili-giây của một lệnh toggle bật/tắt công tắc từ lúc người dùng chạm tay vào màn hình Web PWA cho đến khi rơ-le vật lý đóng lại và trạng thái phản hồi về điện thoại:

```mermaid
sequenceDiagram
    autonumber
    actor User as "Người dùng (Mobile Web PWA)"
    participant WebUI as "Web UI State Store"
    participant WSS as "Cloud WSS Link (:8084)"
    participant EMQX as "Cloud EMQX Broker"
    participant CloudBridge as "Hub Cloud Bridge"
    participant SetQ as "Sequential SetQueue"
    participant LocalMosq as "Local Mosquitto (:1883)"
    participant Z2M as "Zigbee2MQTT"
    participant Dongle as "USB Coordinator"
    participant Relay as "Thiết bị Zigbee (Smart Plug)"

    %% BƯỚC 1: PHÁT LỆNH %%
    Note over User, WebUI: 1. User bấm Toggle "BẬT" trên giao diện
    User->>WebUI: Click Toggle (deviceId: "plug_livingroom", state: "ON")
    WebUI->>WebUI: Optimistic UI (Hiện trạng thái chờ trong 3s)
    WebUI->>WSS: Publish QoS1 -> Topic: "t/tenant_01/h/hub_01/d/plug_livingroom/set"
    Note over WSS, EMQX: Payload: {"state": "ON", "seq": 105, "ts": 1729524000000}
    WSS->>EMQX: Packet MQTT Publish (QoS 1)
    
    %% BƯỚC 2: ROUTING TRÊN CLOUD %%
    Note over EMQX: 2. Broker xác thực ACL & định tuyến
    EMQX->>EMQX: Kiểm tra ACL: Cho phép User publish vào topic của tenant_01
    EMQX-->>WSS: PUBACK (Xác nhận Cloud đã nhận lệnh)
    EMQX->>CloudBridge: Forward packet qua kết nối MQTTS :8883 (Hub đang online)

    %% BƯỚC 3: XỬ LÝ NỘI BỘ HUB %%
    Note over CloudBridge, SetQ: 3. Hub nhận lệnh và xếp hàng điều khiển
    CloudBridge-->>EMQX: PUBACK
    CloudBridge->>SetQ: Đưa lệnh vào hàng đợi tuần tự (Concurrency = 1/device)
    SetQ->>LocalMosq: Publish QoS 1 -> "zigbee2mqtt/0x00124b001/set" Payload: {"state": "ON"}
    LocalMosq->>Z2M: Chuyển tiếp tới Zigbee2MQTT

    %% BƯỚC 4: TRUYỀN SÓNG VẬT LÝ %%
    Note over Z2M, Relay: 4. Chuyển đổi giao thức sang Zigbee Radio
    Z2M->>Dongle: Gửi lệnh qua USB Serial (Ember/Z-Stack frame)
    Dongle->>Relay: Bắn sóng vô tuyến 2.4GHz IEEE 802.15.4 (Cluster 0x0006 On/Off)
    Note over Relay: RƠ-LE ĐÓNG ("TÁCH!") - Đèn sáng
    Relay-->>Dongle: Phản hồi báo cáo trạng thái vô tuyến (Report: 0x0006 = 1)
    Dongle-->>Z2M: Serial response frame

    %% BƯỚC 5: PHẢN HỒI STATE NGƯỢC LÊN GIAO DIỆN %%
    Note over Z2M, WebUI: 5. Báo cáo State mới ngược lên Cloud và Client
    Z2M->>LocalMosq: Publish "zigbee2mqtt/0x00124b001" {"state": "ON", "power": 45.2}
    LocalMosq->>CloudBridge: Báo trạng thái mới cho Driver Hub
    CloudBridge->>CloudBridge: Cập nhật SQLite local (`hub.db`)
    CloudBridge->>EMQX: Publish QoS 1 (Retain=true) -> "t/tenant_01/h/hub_01/d/plug_livingroom/state"
    EMQX-->>CloudBridge: PUBACK
    EMQX->>WSS: Phân phối tới tất cả Web clients đang mở của Tenant 01
    WSS->>WebUI: Nhận gói tin state mới
    WebUI->>User: Cập nhật nút bấm sang màu xanh "BẬT" (Độ trễ toàn trình: 150 - 350 ms)
```

---

## 5. Tóm tắt các Quy tắc Thiết kế Bất biến (Architectural Invariants)

| Nguyên tắc | Chi tiết hiện thực | Mục tiêu đạt được |
| :--- | :--- | :--- |
| **Không hop thừa** | Lệnh đi trực tiếp: `Web -> EMQX -> Hub -> Device`. Không bao giờ gọi qua REST Cloud Run để bật tắt đèn. | Độ trễ dưới **400 ms** (so với 1.5 - 3s nếu đi qua HTTP webhook). |
| **Bền vững không mạng** | Toàn bộ Rules và Automations lưu trữ trong SQLite cục bộ của Hub. | Khi mất cáp quang / mất Cloud, Hub vẫn tự chạy kịch bản cảm biến bật đèn bình thường. |
| **Cô lập Đa thuê bao** | Topic MQTT bắt buộc có tiền tố `t/<tenantId>/`. EMQX tự động chặn đứng nếu client cố gắng đọc/ghi vào tenant khác. | Đảm bảo tính riêng tư tuyệt đối giữa các hộ gia đình / tài khoản Google khác nhau. |
| **Chi phí 0đ vĩnh viễn** | VM `e2-micro`, Cloud Run scale-to-zero, Firestore Native, 1 Secret JSON duy nhất. | Toàn bộ hạ tầng hoạt động trong gói **Google Cloud Always Free**. |
