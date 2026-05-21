# 🚀 Analyst PG Backend - NestJS API Server

Mã nguồn Backend của dự án Analyst là một ứng dụng **NestJS** xây dựng theo mô hình module hóa, sử dụng **Prisma ORM** để tương tác trực tiếp với cơ sở dữ liệu quan hệ **PostgreSQL**.

---

## 🛠️ Công Nghệ Sử Dụng (Tech Stack)

- **Framework**: NestJS (v11+)
- **Database ORM**: Prisma Client (v7+) & PostgreSQL (v16)
- **Bảo mật & Xác thực**: Passport.js, JWT, bcrypt (mã hóa mật khẩu)
- **Xử lý Metadata**:
  - `geoip-lite`: Định danh quốc gia/thành phố từ IP của client.
  - `ua-parser-js`: Phân tích hệ điều hành, trình duyệt, dòng thiết bị từ User-Agent.
- **Tài liệu API**: Swagger UI (tự động tạo tài liệu từ decorators)

---

## 🗄️ Thiết Kế Cơ Sở Dũ Liệu (Database Models)

Hệ thống sử dụng cơ sở dữ liệu PostgreSQL với các bảng chính được định nghĩa trong `prisma/schema.prisma`:

1. **User**: Quản lý thông tin tài khoản quản trị (email, mật khẩu băm, vai trò USER/ADMIN).
2. **RefreshToken**: Lưu giữ tokens phục vụ cơ chế tự động làm mới phiên đăng nhập (Token Rotation).
3. **Website**: Quản lý các website cần được theo dõi (mỗi website thuộc về 1 User, phân biệt bằng domain duy nhất).
4. **ApiKey**: Khóa bảo mật của website để xác thực các event gửi lên từ tracker (`x-api-key`). Có trường `revoked` để vô hiệu hóa khóa khi cần.
5. **Session**: Phiên truy cập của khách hàng, nhóm các event cùng phiên dựa trên tổ hợp `(websiteId, externalSessionId)`. Lưu trữ thông tin IP, thiết bị, trình duyệt, hệ điều hành và quốc gia.
6. **Event**: Bản ghi chi tiết của từng sự kiện thu thập được (PAGEVIEW, CLICK, CUSTOM). Có unique constraint `(websiteId, eventId)` để đảm bảo tính **Idempotency** (không trùng lặp dữ liệu).
7. **EventDaily**: Bảng tổng hợp (aggregate) số liệu theo ngày của từng website bao gồm: `pageviews` (lượt xem), `visits` (lượt ghé thăm), `uniques` (khách truy cập duy nhất) nhằm tăng tốc độ truy vấn báo cáo tổng quan.

---

## 📥 Luồng Thu Thập Dữ Liệu Đồng Bộ (Ingestion Pipeline)

Hệ thống thu thập dữ liệu qua endpoint công khai `POST /metrics/events`. Khi một request được gửi lên, NestJS sẽ xử lý **đồng bộ** trực tiếp theo trình tự sau:

1. **Xác thực API Key**: Kiểm tra header `x-api-key` có tồn tại và đang hoạt động (`revoked = false`) trong cơ sở dữ liệu.
2. **Domain Validation**: So khớp header `Origin` hoặc `Referer` với trường `domain` của Website đã được khai báo trong DB để chống gửi dữ liệu giả mạo từ domain lạ.
3. **Phân tích địa lý & thiết bị (Client Context)**:
   - Trích xuất Client IP từ header `x-forwarded-for` hoặc `request.ip`. Phối hợp các gợi ý CDN như Cloudflare (`cf-ipcountry`), Vercel (`x-vercel-ip-country`) để lấy Country Code nhanh hoặc phân tích bằng `geoip-lite` để có Quốc gia & Thành phố.
   - Phân tích User-Agent để có thông tin Hệ điều hành, Trình duyệt, Thiết bị.
4. **Database Transaction (Prisma $transaction)**:
   - **Idempotency Check**: Tra cứu xem `eventId` của website này đã tồn tại trong bảng `Event` chưa. Nếu đã có thì bỏ qua (bảo đảm không ghi trùng).
   - **Resolve or Create Session**: Kiểm tra sự tồn tại của session theo cặp `(websiteId, externalSessionId)`. Nếu có, cập nhật lại metadata (IP, OS, trình duyệt). Nếu chưa có, xác định xem đây có phải là Unique Visitor mới của ngày hay không và tạo Session mới.
   - **Create Event**: Lưu bản ghi sự kiện mới vào bảng `Event`.
   - **Update Daily Stats**: Tự động cập nhật cộng dồn các giá trị tương ứng (`pageviews`, `visits`, `uniques`) vào bảng `EventDaily` dựa theo thời gian xảy ra event.

Do chạy đồng bộ trực tiếp, endpoint sẽ trả về trạng thái `{ accepted: true, queued: false, ... }` ngay sau khi lưu trữ thành công vào PostgreSQL.

---

## 🧭 Danh sách các API Endpoints

Các API quản lý và báo cáo đều yêu cầu Header xác thực `Authorization: Bearer <JWT_Access_Token>` và được phân nhóm như sau:

### 1. Xác thực (Auth)

- `POST /auth/register`: Đăng ký tài khoản mới.
- `POST /auth/login`: Đăng nhập, trả về Access Token (in-memory) và thiết lập Refresh Token.
- `POST /auth/refresh`: Làm mới Access Token bằng cách sử dụng Refresh Token.
- `POST /auth/logout`: Đăng xuất, hủy hiệu lực của Refresh Token hiện tại.

### 2. Quản lý Website (`/websites`)

- `GET /websites`: Lấy danh sách website thuộc quyền sở hữu của người dùng hiện tại.
- `POST /websites`: Đăng ký thêm website mới cần theo dõi.
- `GET /websites/:id`: Lấy chi tiết thông tin của website theo ID.
- `PATCH /websites/:id`: Cập nhật thông tin website (tên, domain).
- `DELETE /websites/:id`: Xóa website và toàn bộ dữ liệu (Event, Session, API Keys, Daily Stats) liên quan.
- `GET /websites/:id/api-keys`: Lấy danh sách các API Keys đang hoạt động của website.
- `POST /websites/:id/api-keys`: Sinh một API Key mới cho website.
- `PATCH /websites/:id/api-keys/:apiKeyId/revoke`: Vô hiệu hóa một API Key.

### 3. Báo cáo Analytics (`/analytics/:websiteId/...`)

- `/overview`: Lấy số liệu tổng quan (Pageviews, Sessions, Unique Visitors, Bounce Rate, Average Duration) cùng biểu đồ chi tiết theo ngày trong khoảng thời gian lựa chọn. Có so sánh tương quan với chu kỳ trước đó (`previousRange`).
- `/realtime`: Lấy snapshot số người dùng đang online trong 5 phút gần nhất, danh sách session đang hoạt động và danh sách các trang đang được xem.
- `/realtime/stream` (SSE): Tạo kết nối Server-Sent Events tự động stream dữ liệu realtime liên tục về client dashboard.
- `/events`: Thống kê các custom events (Click, Form Submit,...) và thông tin breakdown chi tiết của metadata kèm theo.
- `/top-pages`: Danh sách các trang được xem nhiều nhất, thời gian ở lại trang trung bình (`avgTimeOnPageMs`), tỉ lệ thoát trang (`exitRate`).
- `/traffic-sources`: Phân tích nguồn truy cập (Direct, Google, Facebook...) và các chiến dịch quảng cáo UTM (Source, Medium, Campaign).
- `/devices`: Báo cáo tỉ lệ thiết bị sử dụng (Mobile vs Desktop), Hệ điều hành, Trình duyệt.
- `/geo`: Báo cáo phân bố địa lý của khách hàng theo quốc gia và thành phố.
- `/retention`: Thống kê tỷ lệ quay lại của người dùng theo mô hình Cohort phân tích theo ngày/tuần.
- `/funnel`: Báo cáo tỷ lệ chuyển đổi qua các bước định nghĩa sẵn trên website.

---

## ⚙️ Cấu Hình Môi Trường (.env)

Tạo file `.env` ở thư mục gốc của backend và điền các giá trị thích hợp:

```env
# Xác thực JWT
JWT_SECRET=your_super_secret_jwt_key_here
JWT_EXPIRES_IN=3600s # Thời hạn tồn tại của Access Token (1 giờ)

# Cấu hình Redis (Hạ tầng sẵn có)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# Cấu hình PostgreSQL & Prisma (Active)
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=analyst_db
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/analyst_db?schema=public

# Cấu hình chung cho App
NODE_ENV=development
PORT=3000
```

---

## 🛠️ Hướng Dẫn Cài Đặt & Phát Triển

### Khởi chạy môi trường Local:

1. **Khởi động Containers phụ trợ**:
   ```bash
   docker compose up -d
   ```
2. **Cài đặt các thư viện**:
   ```bash
   npm install
   ```
3. **Đẩy Database Schema & Sinh Prisma Client**:
   ```bash
   npx prisma db push
   # Hoặc chạy migration dev:
   npx prisma migrate dev --name init
   ```
4. **Khởi chạy dev server**:
   ```bash
   npm run start:dev
   ```

---

## 🔌 Tích Hợp JavaScript Tracker vào Website

Để theo dõi một trang web bất kỳ, hãy nhúng mã tracker sau vào thẻ `<head>` của trang web của bạn:

```html
<!-- Cấu hình API key và endpoint nhận dữ liệu -->
<script
  async
  src="http://localhost:3000/tracker.js"
  data-website-id="YOUR_WEBSITE_ID_FROM_DASHBOARD"
  data-api-key="YOUR_WEBSITE_API_KEY"
  id="analyst-tracker"
></script>
```

### Cách thức hoạt động của `tracker.js`:

- Tự động bắt sự kiện tải trang đầu tiên (`PAGEVIEW`).
- Lắng nghe sự thay đổi của History API (đối với ứng dụng Single Page App như React/Vue/Next.js) để gửi event `PAGEVIEW` khi người dùng chuyển trang mà không tải lại toàn bộ website.
- Lắng nghe các thẻ HTML có thuộc tính `data-analytics` để ghi nhận sự kiện click tự động.
- Cung cấp hàm global để dev gửi custom event thủ công từ code JS:
  ```javascript
  window.analyst &&
    window.analyst.track('button_click', {
      label: 'đăng ký ngay',
      section: 'hero',
    });
  ```
