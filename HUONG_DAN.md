# Hướng dẫn sử dụng AutoStep

## Mục lục

1. [Tại sao dùng AutoStep?](#1-tại-sao-dùng-autostep)
2. [Tạo workflow đầu tiên](#2-tạo-workflow-đầu-tiên)
3. [Các loại thao tác (Action)](#3-các-loại-thao-tác-action)
4. [Chia sẻ workflow trong team](#4-chia-sẻ-workflow-trong-team)
5. [Kết nối các workflow với nhau](#5-kết-nối-các-workflow-với-nhau)
6. [Lập lịch chạy tự động](#6-lập-lịch-chạy-tự-động)
7. [Kích hoạt qua API](#7-kích-hoạt-qua-api)
8. [Quản lý người dùng (Admin)](#8-quản-lý-người-dùng-admin)
9. [Tham chiếu API REST](#9-tham-chiếu-api-rest)

---

## 1. Tại sao dùng AutoStep?

Trong công việc hàng ngày, nhiều tác vụ được làm đi làm lại theo đúng một quy trình: mở ứng dụng, điền form, click nút xác nhận, gửi báo cáo... AutoStep được xây dựng để **biến những quy trình đó thành tự động**.

**Tầm nhìn:**
Mỗi team tự xây dựng bộ workflow riêng cho công việc của mình. Khi một team hoàn thành công việc, workflow tự động thông báo cho team tiếp theo — không cần email, không cần nhắc nhở thủ công.

```
Team Kế toán                Team IT                  Team Báo cáo
──────────────              ──────────────           ──────────────
Xuất dữ liệu  ──trigger──►  Chuyển đổi   ──trigger──► Gửi email
(9:00 hàng ngày)            (tự động)                 (tự động)
```

Kết quả: một chuỗi 3 bước thủ công → **1 nút bấm** hoặc **hoàn toàn tự động theo lịch**.

---

## 2. Tạo workflow đầu tiên

### 2.1 Đăng nhập

Truy cập `http://<địa-chỉ-server>:8000` và đăng nhập bằng tài khoản của bạn.

> Tài khoản mặc định: `admin` / `123456` — đổi ngay sau lần đăng nhập đầu tiên qua menu người dùng → **Change Password**.

### 2.2 Tạo workflow mới

1. Trên trang **Dashboard**, nhấn **New Workflow** (góc phải)
2. Nhập tên workflow vào ô tiêu đề (ví dụ: `Gửi báo cáo tuần`)
3. Thêm mô tả ngắn bên dưới tiêu đề (tùy chọn)

### 2.3 Thêm step đầu tiên

Nhấn **Add Step** → dialog hiện ra:

| Trường | Bắt buộc | Mô tả |
|--------|----------|-------|
| **Step Name** | Có | Tên mô tả bước này làm gì, ví dụ: `Mở Chrome` |
| **Action Type** | Có | Loại thao tác (xem mục 3) |
| **Target** | Tùy action | Đối tượng bị tác động (tọa độ, selector, URL...) |
| **Value** | Tùy action | Nội dung nhập vào (văn bản, thời gian...) |
| **Delay after step** | Không | Chờ thêm (ms) trước khi sang step tiếp theo |

Nhấn **Save Step** để thêm vào danh sách.

### 2.4 Sắp xếp và chỉnh sửa steps

- Dùng mũi tên ▲▼ để đổi thứ tự
- Nhấn biểu tượng bút ✏ để sửa step
- Nhấn biểu tượng thùng rác để xóa

### 2.5 Lưu workflow

Nhấn **Save** → chọn chế độ hiển thị:

| Chế độ | Ai thấy được |
|--------|-------------|
| **Private** | Chỉ bạn (và manager của bạn) |
| **Public** | Tất cả thành viên đã đăng nhập có thể xem và chạy |

### 2.6 Chạy thử

Nhấn **Run** (nút xanh). Panel log xuất hiện bên phải, hiển thị tiến trình từng bước:

- **Vòng tròn xám** — chưa chạy
- **Vòng tròn vàng nhấp nháy** — đang thực thi
- **✓ Xanh lá** — thành công
- **✗ Đỏ** — thất bại (kèm thông báo lỗi)

Nhấn **Stop** để dừng giữa chừng.

### 2.7 Export / Import

- **Export:** Nhấn **Export** để tải về file `.json` — dùng để backup hoặc chia sẻ
- **Import:** Nhấn **Open** để tải file `.json` lên và tạo bản sao workflow

---

## 3. Các loại thao tác (Action)

### Nhóm Windows GUI — điều khiển màn hình desktop

| Action | Cần điền | Ví dụ |
|--------|----------|-------|
| **Left Click** | Tọa độ `x,y` | `500,300` |
| **Right Click** | Tọa độ `x,y` | `500,300` |
| **Double Click** | Tọa độ `x,y` | `500,300` |
| **Keyboard Input** | (Target) tiêu đề cửa sổ; (Value) văn bản | Target: `Notepad`, Value: `Hello` |
| **Open App** | Đường dẫn hoặc lệnh | `/usr/bin/gedit`, `notepad.exe` |
| **Hot Key** | Tổ hợp phím | `ctrl+s`, `alt+f4`, `ctrl+v` |
| **Close App** | Tên app / tiêu đề cửa sổ | `Notepad` |
| **Move Window** | Tọa độ `x,y`; (Value) tiêu đề cửa sổ | `100,100` |

**Cách lấy tọa độ chuột trên Linux:**
```bash
xdotool getmouselocation
```

### Nhóm Browser — điều khiển trình duyệt (Playwright)

| Action | Target | Value |
|--------|--------|-------|
| **Browser: Navigate** | URL đầy đủ | — |
| **Browser: Click** | CSS selector hoặc XPath | — |
| **Browser: Type** | CSS selector hoặc XPath | Văn bản cần điền |
| **Browser: Wait Element** | CSS selector hoặc XPath | Timeout (ms), mặc định 5000 |
| **Browser: Screenshot** | Đường dẫn lưu file | — |

**Cú pháp selector:**

```
#submit-btn          → phần tử có id="submit-btn"
.btn-primary         → phần tử có class="btn-primary"
text=Đăng nhập       → phần tử chứa text "Đăng nhập"
//button[@id="ok"]   → XPath
```

### Nhóm Utility

| Action | Value | Mô tả |
|--------|-------|-------|
| **Delay** | Thời gian (ms) | Dừng lại, ví dụ `2000` = chờ 2 giây |

**Lưu ý về "Delay after step":**
Ngoài action `Delay` độc lập, mỗi step đều có trường **"Delay after step (ms)"** — đây là thời gian chờ sau khi step hoàn thành, trước khi bắt đầu step kế tiếp. Dùng để trang web hoặc ứng dụng kịp tải.

---

## 4. Chia sẻ workflow trong team

### Tại sao cần phân quyền?

Mỗi team có workflow của riêng mình. Một số workflow nhạy cảm (ví dụ: tự động thanh toán) không nên cho tất cả mọi người chạy. Phân quyền giúp kiểm soát điều đó.

### Các mức quyền

| Quyền | Ý nghĩa |
|-------|---------|
| **canView** | Thấy workflow và danh sách steps |
| **canRun** | Chạy workflow |
| **canEdit** | Sửa steps, lên lịch, thiết lập trigger |
| **canDelete** | Xóa workflow |

### Ai tự động có quyền gì?

| Đối tượng | Quyền tự động |
|-----------|--------------|
| Người tạo workflow | Toàn quyền (View + Run + Edit + Delete) |
| Manager của người tạo (và toàn bộ chuỗi manager lên trên) | Toàn quyền |
| Admin | Toàn quyền trên tất cả workflow |
| Workflow Public | Mọi user đã đăng nhập: View + Run |

### Chia sẻ qua chế độ Public/Private

Cách đơn giản nhất: khi lưu workflow, chọn **Public** để toàn bộ team có thể thấy và chạy. Chọn **Private** nếu chỉ dành cho bạn và team trực tiếp.

### Cấp quyền chi tiết cho từng người (qua API)

Để kiểm soát tinh hơn — ví dụ: cho user A chỉ được **Run** chứ không được **Edit**:

```bash
# Cấp quyền canRun cho user có id=5 trên workflow <wf-id>
curl -X POST "http://<server>:8000/api/workflows/<wf-id>/permissions" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"userId": 5, "canView": true, "canRun": true, "canEdit": false, "canDelete": false}'
```

### Cấu trúc Manager — Quyền thừa hưởng

Khi Admin tạo user, có thể chỉ định **Manager** (cấp trên trực tiếp).

```
Admin
 └── Manager A (trưởng phòng)
      ├── Nhân viên 1  → tạo workflow → Manager A tự động có toàn quyền
      └── Nhân viên 2  → tạo workflow → Manager A tự động có toàn quyền
```

Điều này đảm bảo trưởng phòng luôn có thể xem và kiểm soát workflow của nhân viên trong nhóm.

---

## 5. Kết nối các workflow với nhau

Đây là tính năng cốt lõi để xây dựng **chuỗi tự động hóa liên team**.

### Trigger là gì?

Trigger cho phép workflow B **tự động chạy** ngay khi workflow A đạt một trạng thái nhất định — không cần ai nhấn nút.

### Các loại trigger

| Loại | Khi nào B được kích hoạt |
|------|--------------------------|
| `on_complete` | Khi A hoàn thành **toàn bộ** |
| `on_step` | Khi A hoàn thành **một step cụ thể** |

### Ví dụ thực tế

**Tình huống:** Team Kế toán xuất báo cáo xong → Team IT tự động xử lý file → Team Giám đốc tự động nhận email tổng hợp.

```
Workflow A (Kế toán): Xuất báo cáo tháng
     ↓ on_complete
Workflow B (IT): Xử lý & chuyển định dạng file
     ↓ on_complete
Workflow C (Admin): Gửi email tổng hợp lên ban lãnh đạo
```

**Kết quả:** Kế toán chỉ cần chạy Workflow A — hai bước còn lại tự động diễn ra.

### Thiết lập trigger (qua API)

Trigger được cấu hình trên **workflow đích** (workflow sẽ bị kích hoạt):

```bash
# Workflow B sẽ tự chạy khi Workflow A (source_workflow_id) hoàn thành
curl -X POST "http://<server>:8000/api/workflows/<wf-B-id>/triggers" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceWorkflowId": "<wf-A-id>",
    "triggerType": "on_complete"
  }'

# Hoặc khi Workflow A hoàn thành step số 3
curl -X POST "http://<server>:8000/api/workflows/<wf-B-id>/triggers" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceWorkflowId": "<wf-A-id>",
    "triggerType": "on_step",
    "stepIndex": 3
  }'
```

### Xem danh sách trigger của một workflow

```bash
curl "http://<server>:8000/api/workflows/<wf-id>/triggers" \
  -H "Authorization: Bearer <token>"
```

### Xóa trigger

```bash
curl -X DELETE "http://<server>:8000/api/workflows/<wf-id>/triggers/<trigger-id>" \
  -H "Authorization: Bearer <token>"
```

### Lưu ý quan trọng

- Trigger chạy **bất đồng bộ** — workflow A không chờ B hoàn thành mới kết thúc
- Có thể tạo **chuỗi trigger dài** bao nhiêu bước tùy ý
- Khi workflow A bị xóa, tất cả trigger có nguồn từ A cũng bị xóa

---

## 6. Lập lịch chạy tự động

Thay vì ai đó nhấn Run mỗi ngày, workflow có thể **tự chạy theo lịch**.

### Cấu hình lịch (qua API)

```bash
curl -X PUT "http://<server>:8000/api/workflows/<wf-id>/schedule" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "timeOfDay": "08:00",
    "daysOfWeek": [0, 1, 2, 3, 4],
    "daysOfMonth": [],
    "active": true
  }'
```

### Các trường cấu hình

| Trường | Mô tả | Ví dụ |
|--------|-------|-------|
| `timeOfDay` | Giờ chạy (HH:MM, 24h) | `"09:00"`, `"14:30"` |
| `daysOfWeek` | Các ngày trong tuần (0=Thứ Hai, 6=Chủ Nhật) | `[0,1,2,3,4]` = Thứ Hai–Sáu |
| `daysOfMonth` | Các ngày trong tháng | `[1, 15]` = ngày 1 và 15 hàng tháng |
| `active` | Bật hoặc tắt lịch | `true` / `false` |

**Logic ưu tiên:**
- Nếu `daysOfWeek` không rỗng → chỉ chạy vào các ngày đó trong tuần
- Nếu `daysOfMonth` không rỗng → chỉ chạy vào các ngày đó trong tháng
- Nếu cả hai đều rỗng → chạy mỗi ngày vào `timeOfDay`

### Ví dụ thực tế

**Chạy báo cáo lúc 8:00 mỗi Thứ Hai:**
```json
{ "timeOfDay": "08:00", "daysOfWeek": [0], "daysOfMonth": [], "active": true }
```

**Chốt sổ ngày 1 và 15 hàng tháng lúc 23:59:**
```json
{ "timeOfDay": "23:59", "daysOfWeek": [], "daysOfMonth": [1, 15], "active": true }
```

### Kết hợp Schedule + Trigger

Đây là mô hình mạnh nhất: **lịch kích hoạt workflow đầu tiên**, workflow đó trigger dây chuyền tiếp theo.

```
Lịch 8:00 Thứ Hai
    ↓ (tự động)
WF A: Lấy dữ liệu từ hệ thống kế toán
    ↓ on_complete
WF B: Tổng hợp và tạo file báo cáo
    ↓ on_complete
WF C: Upload báo cáo lên Drive và gửi email
```

**Kết quả:** Sáng thứ Hai mọi người mở email đã thấy báo cáo — không ai cần làm gì cả.

---

## 7. Kích hoạt qua API

Ngoài trigger nội bộ và lịch, workflow còn có thể được gọi từ **hệ thống bên ngoài** (ERP, CRM, webhook...) qua HTTP.

### Lấy API Key của workflow

```bash
# Xem thông tin permissions và API Key
curl "http://<server>:8000/api/workflows/<wf-id>/permissions" \
  -H "Authorization: Bearer <token>"
```

Trường `apiKey` trong response là key để gọi workflow không cần đăng nhập.

### Gọi chạy workflow qua API

```bash
curl -X POST "http://<server>:8000/api/run/<wf-id>?api_key=<api-key>"
```

**Phản hồi:**
```json
// Thành công
{"success": true, "error": null}

// Thất bại
{"success": false, "error": "Mô tả lỗi"}
```

Giới hạn thời gian chờ: **5 phút**. Nếu workflow chạy quá 5 phút, API trả về lỗi `Execution timed out`.

### Tạo lại API Key (khi bị lộ)

```bash
curl -X POST "http://<server>:8000/api/workflows/<wf-id>/permissions/apikey" \
  -H "Authorization: Bearer <token>"
```

API Key cũ lập tức mất hiệu lực.

### Ví dụ tích hợp

**Tình huống:** Hệ thống ERP xử lý xong đơn hàng → gọi AutoStep để tự động in phiếu xuất kho:

```python
import requests

def trigger_warehouse_print(order_id):
    response = requests.post(
        "http://autostep-server:8000/api/run/wf-xuat-kho-123",
        params={"api_key": "your-api-key"}
    )
    return response.json()["success"]
```

---

## 8. Quản lý người dùng (Admin)

Chỉ tài khoản **Admin** mới truy cập được trang `/admin`.

### Tạo người dùng mới

1. Vào menu → **Admin** → nhấn **Add User**
2. Điền **Username** và **Password** (tối thiểu 6 ký tự)
3. Tích **Admin** nếu cần cấp quyền quản trị
4. Nhấn **Create**

> Nếu muốn thiết lập cấu trúc Manager (cấp trên/nhân viên), dùng API:
> ```bash
> curl -X POST "http://<server>:8000/api/users" \
>   -H "Authorization: Bearer <token>" \
>   -H "Content-Type: application/json" \
>   -d '{"username": "nhanvien1", "password": "123456", "isAdmin": false, "managerId": 3}'
> ```

### Cấu trúc cấp quản lý

Khi tạo user, chỉ định `managerId` để phân cấp:

```
Admin (id=1)
 └── Trưởng phòng A (id=3, managerId=1)
      ├── Nhân viên 1 (managerId=3)  → WF của NV1 → TP A tự có toàn quyền
      └── Nhân viên 2 (managerId=3)  → WF của NV2 → TP A tự có toàn quyền
```

Quyền thừa hưởng truyền lên toàn bộ chuỗi: Nhân viên → Trưởng phòng → Giám đốc.

### Xóa người dùng

Nhấn **Delete** bên cạnh user. Các workflow của user đó vẫn còn, `owner` hiển thị là `deleted`.

### Đổi mật khẩu người dùng

Trong giao diện Admin, dùng nút **Change Password** bên cạnh mỗi user.

Người dùng tự đổi mật khẩu: menu góc phải → **Change Password**.

---

## 9. Tham chiếu API REST

Tất cả endpoint (trừ login và `/api/run/...`) cần header:
```
Authorization: Bearer <jwt-token>
```

Lấy token bằng cách đăng nhập:
```bash
curl -X POST "http://<server>:8000/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "123456"}'
# → {"token": "eyJ..."}
```

### Workflows

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/workflows` | Danh sách workflow có quyền xem |
| `POST` | `/api/workflows` | Tạo workflow mới |
| `GET` | `/api/workflows/{id}` | Chi tiết workflow |
| `PUT` | `/api/workflows/{id}` | Cập nhật workflow |
| `DELETE` | `/api/workflows/{id}` | Xóa workflow |
| `POST` | `/api/run/{id}?api_key=<key>` | Chạy workflow qua API Key |

### Phân quyền

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/workflows/{id}/permissions` | Xem danh sách quyền + API Key |
| `POST` | `/api/workflows/{id}/permissions` | Cấp/cập nhật quyền cho user |
| `DELETE` | `/api/workflows/{id}/permissions/{perm_id}` | Thu hồi quyền |
| `POST` | `/api/workflows/{id}/permissions/apikey` | Tạo lại API Key |

Body để cấp quyền:
```json
{
  "userId": 5,
  "canView": true,
  "canRun": true,
  "canEdit": false,
  "canDelete": false
}
```

### Triggers

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/workflows/{id}/triggers` | Danh sách trigger của workflow |
| `POST` | `/api/workflows/{id}/triggers` | Thêm trigger mới |
| `DELETE` | `/api/workflows/{id}/triggers/{trigger_id}` | Xóa trigger |

Body để thêm trigger:
```json
{
  "sourceWorkflowId": "<wf-id-nguon>",
  "triggerType": "on_complete"
}
```
hoặc:
```json
{
  "sourceWorkflowId": "<wf-id-nguon>",
  "triggerType": "on_step",
  "stepIndex": 2
}
```

### Lịch chạy

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/workflows/{id}/schedule` | Xem lịch hiện tại |
| `PUT` | `/api/workflows/{id}/schedule` | Cài/cập nhật lịch |
| `DELETE` | `/api/workflows/{id}/schedule` | Xóa lịch |

### Người dùng (chỉ Admin)

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/users` | Danh sách người dùng |
| `POST` | `/api/users` | Tạo người dùng |
| `PATCH` | `/api/users/{id}` | Cập nhật (isAdmin, managerId) |
| `PUT` | `/api/users/{id}/password` | Đổi mật khẩu |
| `DELETE` | `/api/users/{id}` | Xóa người dùng |

---

*Để được hỗ trợ hoặc báo lỗi, liên hệ đội phát triển nội bộ.*
