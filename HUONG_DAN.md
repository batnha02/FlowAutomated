# Tài liệu hướng dẫn sử dụng AutoStep

## Mục lục
1. [Giới thiệu](#1-giới-thiệu)
2. [Kiến trúc hệ thống](#2-kiến-trúc-hệ-thống)
3. [Cài đặt và khởi động](#3-cài-đặt-và-khởi-động)
4. [Đăng nhập](#4-đăng-nhập)
5. [Quản lý Workflow](#5-quản-lý-workflow)
6. [Các loại Action](#6-các-loại-action)
7. [Thực thi Workflow](#7-thực-thi-workflow)
8. [Local Agent](#8-local-agent)
9. [Triggers – Kích hoạt chuỗi Workflow](#9-triggers--kích-hoạt-chuỗi-workflow)
10. [Lịch chạy tự động (Schedule)](#10-lịch-chạy-tự-động-schedule)
11. [Phân quyền (Permissions)](#11-phân-quyền-permissions)
12. [API Key – Chạy qua HTTP](#12-api-key--chạy-qua-http)
13. [Quản trị người dùng (Admin)](#13-quản-trị-người-dùng-admin)
14. [Bảo mật](#14-bảo-mật)
15. [Tham chiếu API REST](#15-tham-chiếu-api-rest)

---

## 1. Giới thiệu

**AutoStep** là hệ thống tự động hóa thao tác máy tính dạng web. Người dùng xây dựng các **Workflow** gồm nhiều **Step** (bước), mỗi bước thực hiện một thao tác như:

- Click chuột / gõ phím lên màn hình desktop
- Mở / đóng ứng dụng
- Điều khiển trình duyệt web (Playwright)
- Chờ một khoảng thời gian (Delay)

Workflow được lưu tập trung trên server, nhiều người dùng có thể xem, chạy, hoặc chỉnh sửa theo phân quyền. Hệ thống hỗ trợ cả chạy ngay trên server lẫn chạy trên máy PC cục bộ qua **Local Agent**.

---

## 2. Kiến trúc hệ thống

```
┌─────────────────────────────────────────────┐
│              Trình duyệt người dùng          │
│         (React + Tailwind CSS + Vite)        │
└───────────────────┬─────────────────────────┘
                    │ HTTP / WebSocket
┌───────────────────▼─────────────────────────┐
│          Backend Server (FastAPI)            │
│  ┌────────────┐  ┌──────────────────────┐   │
│  │  REST API  │  │   WebSocket /ws      │   │
│  │  /api/...  │  │  (thực thi workflow) │   │
│  └────────────┘  └──────────────────────┘   │
│  ┌───────────────────────────────────────┐  │
│  │  Executor (executor.py)               │  │
│  │  Scheduler (scheduler.py)             │  │
│  └───────────────────────────────────────┘  │
│  ┌───────────────────────────────────────┐  │
│  │  SQLite Database (automation.db)      │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
                    │ WebSocket (tùy chọn)
┌───────────────────▼─────────────────────────┐
│     Local Agent (agent.py) – máy PC riêng   │
│  Chạy actions trực tiếp trên màn hình PC    │
└─────────────────────────────────────────────┘
```

**Thành phần chính:**

| Thành phần | Công nghệ | Vai trò |
|---|---|---|
| `app/main.py` | FastAPI | Khởi động server, khai báo routes, WebSocket |
| `app/executor.py` | asyncio | Thực thi từng step của workflow |
| `app/scheduler.py` | threading | Kiểm tra và kích hoạt lịch chạy mỗi 60 giây |
| `app/db.py` | SQLite | Khởi tạo & truy vấn CSDL |
| `app/auth.py` | JWT + bcrypt | Xác thực người dùng |
| `agent.py` | FastAPI | Agent cục bộ trên máy PC |
| `frontend/` | React + TypeScript | Giao diện web |

---

## 3. Cài đặt và khởi động

### 3.1 Yêu cầu

- Python 3.11+
- Node.js 18+ (chỉ cần nếu build lại frontend)
- Linux: cài `xdotool` để điều khiển chuột/bàn phím

```bash
# Linux
sudo apt install xdotool
```

### 3.2 Cài đặt thư viện Python

```bash
cd /home/ks/Thanh/AutomatedStep

# Tạo môi trường ảo (nếu chưa có)
python3 -m venv venv
source venv/bin/activate

# Cài thư viện
pip install -r requirements.txt

# Cài Playwright và trình duyệt (cho browser actions)
python -m playwright install chromium
```

### 3.3 Khởi động server

```bash
cd /home/ks/Thanh/AutomatedStep
source venv/bin/activate

uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Truy cập giao diện web tại: `http://<địa-chỉ-server>:8000`

### 3.4 Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `JWT_SECRET` | `auto-step-secret-key-2024-autostep!!` | Khóa bí mật ký JWT token |

> **Lưu ý bảo mật:** Thay đổi `JWT_SECRET` trong môi trường production.

---

## 4. Đăng nhập

Khi server khởi động lần đầu, hệ thống tự tạo tài khoản quản trị mặc định:

| Trường | Giá trị |
|---|---|
| Tên đăng nhập | `admin` |
| Mật khẩu | `123456` |

> **Bắt buộc:** Đổi mật khẩu admin sau lần đăng nhập đầu tiên.

**Các bước đăng nhập:**
1. Mở trình duyệt, truy cập `http://<server>:8000`
2. Nhập tên đăng nhập và mật khẩu
3. Nhấn **Login**

Token xác thực có hiệu lực **7 ngày**. Sau khi hết hạn, người dùng cần đăng nhập lại.

**Đổi mật khẩu:**
- Vào menu người dùng (góc phải) → **Change Password**
- Nhập mật khẩu hiện tại và mật khẩu mới (tối thiểu 6 ký tự)

---

## 5. Quản lý Workflow

### 5.1 Dashboard

Màn hình chính hiển thị danh sách các workflow mà bạn có quyền xem, bao gồm:
- Workflow bạn tạo
- Workflow được chia sẻ với bạn
- Workflow công khai (Public)

### 5.2 Tạo Workflow mới

1. Nhấn nút **New Workflow** trên Dashboard
2. Đặt **tên** và **mô tả** cho workflow
3. Thêm các Step (xem mục 6)
4. Nhấn **Save** → chọn chế độ công khai/riêng tư → xác nhận

### 5.3 Chỉnh sửa Workflow

1. Từ Dashboard, nhấn vào workflow cần sửa
2. Chỉnh sửa tên, mô tả, thêm/sửa/xóa/sắp xếp lại các Step
3. Nhấn **Save** để lưu thay đổi

> Chỉ chủ sở hữu (owner) hoặc người có quyền `Edit` mới thấy các nút chỉnh sửa.

### 5.4 Export / Import Workflow

- **Export:** Nhấn nút **Export** trên thanh công cụ → tải file `.json`
- **Import:** Nhấn **Open** → chọn file `.json` đã export

File JSON có cấu trúc:
```json
{
  "name": "Tên workflow",
  "description": "Mô tả",
  "steps": [...]
}
```

### 5.5 Xóa Workflow

Từ Dashboard, nhấn biểu tượng xóa bên cạnh workflow (cần quyền `Delete`).

---

## 6. Các loại Action

Mỗi **Step** trong workflow thực hiện một **Action**. Có 3 nhóm action:

### Nhóm Windows GUI (điều khiển màn hình desktop)

| Action | Trường Target | Trường Value | Mô tả |
|---|---|---|---|
| **Left Click** | Tọa độ `x,y` (vd: `500,300`) | – | Click trái chuột |
| **Right Click** | Tọa độ `x,y` | – | Click phải chuột |
| **Double Click** | Tọa độ `x,y` | – | Double click |
| **Keyboard Input** | Tiêu đề cửa sổ (tùy chọn) | Văn bản cần gõ | Gõ văn bản vào cửa sổ |
| **Open App** | Đường dẫn / lệnh mở app | – | Mở ứng dụng (vd: `/usr/bin/gedit`, `notepad.exe`) |
| **Hot Key** | Tổ hợp phím (vd: `ctrl+c`) | Tiêu đề cửa sổ (tùy chọn) | Gửi phím tắt |
| **Close App** | Tên app / tiêu đề cửa sổ | – | Đóng ứng dụng |
| **Move Window** | Tọa độ `x,y` | Tiêu đề cửa sổ (tùy chọn) | Di chuyển cửa sổ |

**Cách lấy tọa độ chuột (Linux):**
- Trong giao diện editor, nhấn nút **Pick Coordinate** (nếu có)
- Hoặc chạy lệnh: `xdotool getmouselocation`

**Tổ hợp phím Hot Key hỗ trợ:**
```
ctrl+c    ctrl+v    ctrl+z    ctrl+s    ctrl+a
alt+f4    ctrl+alt+t
f1..f12   enter    esc    tab    delete    backspace
home    end    space    up    down    left    right
```

### Nhóm Browser (Playwright – điều khiển trình duyệt)

| Action | Trường Target | Trường Value | Mô tả |
|---|---|---|---|
| **Browser: Navigate** | URL (vd: `https://example.com`) | – | Mở trang web |
| **Browser: Click** | CSS selector / XPath | – | Click vào phần tử |
| **Browser: Type** | CSS selector / XPath | Văn bản cần điền | Điền văn bản vào ô input |
| **Browser: Wait Element** | CSS selector / XPath | Timeout (ms), mặc định 5000 | Chờ phần tử xuất hiện |
| **Browser: Screenshot** | Đường dẫn lưu file (vd: `/home/user/sc.png`) | – | Chụp màn hình toàn trang |

**Cú pháp selector:**

| Loại | Ví dụ |
|---|---|
| CSS ID | `#submit-btn` |
| CSS class | `.btn-primary` |
| CSS kết hợp | `form.login input[name="user"]` |
| Text | `text=Đăng nhập` |
| XPath | `//button[@id="ok"]` |

> **Lưu ý:** Khi chạy browser actions trên Linux, hệ thống dùng **Chromium**. Trên Windows dùng **Microsoft Edge**.

### Nhóm Utility

| Action | Trường Value | Mô tả |
|---|---|---|
| **Delay** | Thời gian (ms), vd: `1000` | Dừng lại một khoảng thời gian |

### Trường "Delay after step"

Ngoài action `Delay`, mỗi step còn có trường **"Delay after step (ms)"** – chờ thêm sau khi step hoàn thành trước khi chuyển sang step tiếp theo.

---

## 7. Thực thi Workflow

### 7.1 Chạy thủ công từ giao diện

1. Mở workflow cần chạy
2. Nhấn nút **Run** (màu xanh lá)
3. Màn hình log bên phải hiển thị tiến trình thực thi
4. Trạng thái từng step:
   - **Vòng tròn xám** – chờ
   - **Vòng tròn vàng** (nhấp nháy) – đang chạy
   - **✓ Xanh lá** – thành công
   - **✗ Đỏ** – thất bại

### 7.2 Dừng giữa chừng

Nhấn nút **Stop** (màu đỏ) trong lúc workflow đang chạy.

### 7.3 Thứ tự thực thi

Các step chạy tuần tự từ trên xuống dưới. Nếu một step thất bại, workflow dừng lại tại đó và báo lỗi.

### 7.4 Chạy qua URL

Thêm tham số `?run=1` vào URL của workflow để tự động chạy ngay khi tải trang:
```
http://<server>:8000/workflow/<workflow-id>?run=1
```

---

## 8. Local Agent

**Local Agent** cho phép thực thi workflow trực tiếp trên máy PC của bạn thay vì trên server.

### Khi nào dùng Local Agent?

- Các action click chuột, gõ phím cần hiển thị trực tiếp trên màn hình máy bạn
- Server là máy Linux headless (không có màn hình), nhưng bạn muốn tự động hóa trên máy Windows/Linux có màn hình

### Cách chạy Local Agent

Trên máy PC của bạn (cần có Python + cài đặt thư viện):

```bash
cd /home/ks/Thanh/AutomatedStep
source venv/bin/activate

# Chạy với port mặc định 8001
python agent.py

# Hoặc chỉ định port khác
python agent.py --port 9001
```

Khi agent khởi động thành công:
```
════════════════════════════════════════════════════
  AutoStep Local Agent
════════════════════════════════════════════════════
  WebSocket : ws://localhost:8001/ws
  Health    : http://localhost:8001/health

  Mọi step sẽ chạy trực tiếp trên máy này.
  Mở AutoStep web app → bật "🖥 Local PC" → nhấn Run.
════════════════════════════════════════════════════
```

### Kết nối từ web app

Trong giao diện editor, bật chế độ **"Local PC"** trước khi nhấn Run. Web app sẽ kết nối WebSocket tới `ws://localhost:8001/ws` thay vì gửi lên server.

---

## 9. Triggers – Kích hoạt chuỗi Workflow

**Trigger** cho phép một workflow kích hoạt workflow khác chạy tự động.

### Các loại trigger

| Loại | Khi nào kích hoạt |
|---|---|
| `on_complete` | Khi workflow nguồn hoàn thành toàn bộ |
| `on_step` | Khi workflow nguồn hoàn thành một step cụ thể |

### Cách thiết lập Trigger

1. Mở workflow cần nhận trigger (workflow đích)
2. Vào tab **Triggers**
3. Nhấn **Add Trigger**
4. Chọn:
   - **Source Workflow**: Workflow sẽ kích hoạt workflow này
   - **Trigger Type**: `on_complete` hoặc `on_step`
   - **Step Index** (nếu chọn `on_step`): bước thứ mấy (tính từ 1)
5. Nhấn **Save**

**Ví dụ:**
- Workflow A hoàn thành → tự động kích hoạt Workflow B → Workflow B hoàn thành → kích hoạt Workflow C

### Lưu ý

- Trigger chạy **bất đồng bộ** (non-blocking) – không ảnh hưởng đến workflow đang chạy
- Khi workflow nguồn bị xóa, trigger liên quan tự động bị xóa theo

---

## 10. Lịch chạy tự động (Schedule)

Mỗi workflow có thể được lên lịch chạy tự động theo thời gian.

### Cấu hình Schedule

1. Mở workflow cần lên lịch
2. Vào tab **Schedule**
3. Điền thông tin:

| Trường | Mô tả | Ví dụ |
|---|---|---|
| **Time of Day** | Giờ chạy (HH:MM, 24h) | `09:00`, `14:30` |
| **Days of Week** | Các ngày trong tuần (0=T2, 6=CN) | `[0,1,2,3,4]` = Thứ 2–6 |
| **Days of Month** | Các ngày trong tháng | `[1,15]` = ngày 1 và 15 |
| **Active** | Bật/tắt lịch | ✓ |

4. Nhấn **Save**

### Logic kích hoạt

- Hệ thống kiểm tra mỗi **60 giây**
- Nếu `Days of Week` không rỗng: chỉ chạy vào các ngày trong tuần được chỉ định
- Nếu `Days of Month` không rỗng: chỉ chạy vào các ngày trong tháng được chỉ định
- Nếu cả hai đều rỗng: chạy mỗi ngày vào giờ được cài đặt
- Trường `last_run` ghi lại lần chạy gần nhất

**Ví dụ:** Chạy lúc 08:00 mỗi thứ Hai và thứ Tư:
- Time of Day: `08:00`
- Days of Week: `[0, 2]`

---

## 11. Phân quyền (Permissions)

### Các mức quyền

| Quyền | Ý nghĩa |
|---|---|
| **canView** | Xem workflow và danh sách steps |
| **canRun** | Chạy workflow |
| **canEdit** | Sửa steps, lên lịch, thiết lập trigger |
| **canDelete** | Xóa workflow |

### Quyền mặc định

- **Admin**: tự động có đầy đủ 4 quyền trên mọi workflow
- **Người tạo workflow**: tự động có đầy đủ 4 quyền
- **Manager của người tạo**: tự động được cấp đầy đủ 4 quyền
- **Workflow Public**: mọi người dùng đã đăng nhập có `canView` và `canRun`

### Cấp quyền cho người dùng

1. Mở workflow
2. Vào tab **Permissions**
3. Chọn người dùng và đánh dấu các quyền
4. Nhấn **Save**

### Chế độ Public/Private

- **Private**: chỉ người có quyền `canView` mới thấy
- **Public**: mọi người dùng đều thấy và chạy được (nhưng không tự động có quyền sửa/xóa)

---

## 12. API Key – Chạy qua HTTP

Mỗi workflow có một **API Key** dùng để kích hoạt chạy qua HTTP mà không cần đăng nhập.

### Lấy API Key

Vào tab **Permissions** (hoặc thông tin workflow) → copy API Key.

### Gọi API

```bash
curl -X POST "http://<server>:8000/api/run/<workflow-id>?api_key=<api-key>"
```

**Phản hồi thành công:**
```json
{"success": true, "error": null}
```

**Phản hồi thất bại:**
```json
{"success": false, "error": "Mô tả lỗi"}
```

Giới hạn thời gian thực thi: **5 phút**. Nếu quá thời gian, API trả về lỗi `Execution timed out`.

### Tạo lại API Key

1. Vào tab **Permissions**
2. Nhấn **Regenerate API Key**
3. Lưu lại key mới (key cũ sẽ bị vô hiệu hóa)

---

## 13. Quản trị người dùng (Admin)

Chỉ tài khoản **Admin** mới truy cập được trang `/admin`.

### Quản lý người dùng

Vào menu → **Admin** để:

#### Tạo người dùng mới

1. Nhấn **Create User**
2. Điền:
   - **Username**: tên đăng nhập (duy nhất)
   - **Password**: mật khẩu (tối thiểu 6 ký tự)
   - **Admin**: có/không
   - **Manager**: chọn người quản lý (tùy chọn)
3. Nhấn **Create**

Nếu không chỉ định Manager, hệ thống tự gán Admin đầu tiên làm Manager.

#### Cấu trúc Manager

- Mỗi người dùng có thể có một **Manager** (người cấp trên trực tiếp)
- Khi user tạo workflow, **chuỗi manager** (user → manager → manager của manager → ...) đều tự động nhận đủ quyền trên workflow đó
- Admin luôn có quyền trên tất cả workflow

#### Đổi mật khẩu người dùng (Admin)

1. Trong danh sách người dùng, nhấn **Change Password** bên cạnh user
2. Nhập mật khẩu mới
3. Xác nhận

#### Xóa người dùng

Nhấn **Delete** bên cạnh user (không thể xóa chính mình).

> Khi xóa user, các workflow do user đó tạo vẫn còn tồn tại nhưng `owner_id` sẽ hiển thị là `deleted`.

---

## 14. Bảo mật

### Xác thực

- Sử dụng **JWT (JSON Web Token)** với thuật toán **HS256**
- Token hết hạn sau **7 ngày**
- Mật khẩu được băm bằng **bcrypt**

### Khuyến nghị khi deploy production

1. **Đổi JWT_SECRET:**
   ```bash
   export JWT_SECRET="chuoi-bi-mat-phuc-tap-cua-ban"
   uvicorn app.main:app --host 0.0.0.0 --port 8000
   ```

2. **Đổi mật khẩu admin mặc định** (`admin` / `123456`) ngay sau lần đầu đăng nhập

3. **Dùng HTTPS** – đặt Nginx làm reverse proxy với TLS:
   ```nginx
   server {
       listen 443 ssl;
       location / { proxy_pass http://127.0.0.1:8000; }
       location /ws {
           proxy_pass http://127.0.0.1:8000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
       }
   }
   ```

4. **Giới hạn CORS** – trong `app/main.py`, thay `allow_origins=['*']` bằng domain cụ thể

5. **Backup CSDL** – sao lưu file `automation.db` định kỳ

---

## 15. Tham chiếu API REST

Tất cả API cần header: `Authorization: Bearer <token>` (trừ `/api/auth/login` và `/api/run/...`).

### Xác thực

| Method | Endpoint | Mô tả |
|---|---|---|
| `POST` | `/api/auth/login` | Đăng nhập, nhận token |
| `GET` | `/api/auth/me` | Thông tin user hiện tại |
| `PUT` | `/api/auth/password` | Đổi mật khẩu |

### Workflows

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/api/workflows` | Danh sách workflow có quyền xem |
| `POST` | `/api/workflows` | Tạo workflow mới |
| `GET` | `/api/workflows/{id}` | Chi tiết workflow |
| `PUT` | `/api/workflows/{id}` | Cập nhật workflow |
| `DELETE` | `/api/workflows/{id}` | Xóa workflow |
| `POST` | `/api/run/{id}?api_key=<key>` | Chạy workflow qua API Key |

### Phân quyền

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/api/workflows/{id}/permissions` | Danh sách quyền |
| `POST` | `/api/workflows/{id}/permissions` | Cấp/cập nhật quyền |
| `DELETE` | `/api/workflows/{id}/permissions/{perm_id}` | Thu hồi quyền |
| `POST` | `/api/workflows/{id}/permissions/apikey` | Tạo lại API Key |

### Triggers

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/api/workflows/{id}/triggers` | Danh sách trigger |
| `POST` | `/api/workflows/{id}/triggers` | Thêm trigger |
| `DELETE` | `/api/workflows/{id}/triggers/{trigger_id}` | Xóa trigger |

### Lịch chạy

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/api/workflows/{id}/schedule` | Xem lịch chạy |
| `PUT` | `/api/workflows/{id}/schedule` | Cài/cập nhật lịch chạy |
| `DELETE` | `/api/workflows/{id}/schedule` | Xóa lịch chạy |

### Người dùng (Admin only)

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/api/users` | Danh sách người dùng |
| `POST` | `/api/users` | Tạo người dùng mới |
| `PATCH` | `/api/users/{id}` | Cập nhật (admin/manager) |
| `PUT` | `/api/users/{id}/password` | Đổi mật khẩu người dùng |
| `DELETE` | `/api/users/{id}` | Xóa người dùng |

### Tools

| Method | Endpoint | Mô tả |
|---|---|---|
| `POST` | `/api/tools/pick-coordinate` | Lấy tọa độ chuột hiện tại |

### WebSocket

| Endpoint | Mô tả |
|---|---|
| `ws://<server>/ws?token=<jwt>` | Kết nối thực thi workflow real-time |

**Gửi message để chạy:**
```json
{"type": "start", "steps": [...], "workflowId": "<id>"}
```

**Gửi message để dừng:**
```json
{"type": "cancel"}
```

**Nhận events:**
- `{"type": "start", "total": 5}` – bắt đầu
- `{"type": "step", "index": 0, "status": "running"}` – trạng thái step
- `{"type": "log", "message": "..."}` – log message
- `{"type": "done", "total": 5}` – hoàn thành
- `{"type": "error", "stepIndex": 2, "error": "..."}` – lỗi
- `{"type": "cancelled", "stoppedAt": -1}` – đã dừng

---

*Tài liệu này mô tả hệ thống AutoStep dựa trên mã nguồn tại `/home/ks/Thanh/AutomatedStep`.*
