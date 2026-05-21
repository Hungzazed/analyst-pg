# 🚀 Analyst PG Backend - NestJS API Server

Mã nguồn Backend của dự án Analyst là một ứng dụng **NestJS** xây dựng theo mô hình module hóa, tích hợp **Prisma ORM** để quản trị cơ sở dữ liệu PostgreSQL, đi kèm với hệ thống bộ nhớ đệm **Redis** và hệ thống hàng đợi thông điệp **Kafka** phục vụ xử lý thu thập dữ liệu bất đồng bộ.

---

## 🛠️ Công Nghệ Sử Dụng (Tech Stack)

- **Framework**: NestJS (v11+)
- **Database ORM**: Prisma Client (v7+) & PostgreSQL (v16)
- **Caching & Realtime state**: Redis (v5/7)
- **Message Broker**: Kafka (KafkaJS)
- **Bảo mật & Xác thực**: Passport.js, JWT, bcrypt (mã hóa mật khẩu)
- **Xử lý Metadata**:
  - `geoip-lite`: Định danh quốc gia/thành phố từ IP của client.
  - `ua-parser-js`: Phân tích hệ điều hành, trình duyệt, dòng thiết bị từ User-Agent.
- **Tài liệu API**: Swagger UI (tự động tạo tài liệu từ decorators)

---

## 🗄️ Thiết Kế Cơ Sở Dữ Liệu (Database Models)

Hệ thống sử dụng cơ sở dữ liệu PostgreSQL với các bảng chính được định nghĩa trong `prisma/schema.prisma`:

1. **User**: Quản lý thông tin tài khoản quản trị (email, mật khẩu băm, vai trò USER/ADMIN).
2. **RefreshToken**: Lưu giữ tokens phục vụ cơ chế tự động làm mới phiên đăng nhập (Token Rotation).
3. **Website**: Quản lý các website cần được theo dõi (mỗi website thuộc về 1 User, phân biệt bằng domain duy nhất).
4. **ApiKey**: Khóa bảo mật của website để xác thực các event gửi lên từ tracker (`x-api-key`). Có trường `revoked` để vô hiệu hóa khóa khi cần.
5. **Session**: Phiên truy cập của khách hàng, nhóm các event cùng phiên dựa trên tổ hợp `(websiteId, externalSessionId)`. Lưu trữ thông tin IP, thiết bị, trình duyệt, hệ điều hành và quốc gia.
6. **Event**: Bản ghi chi tiết của từng sự kiện thu thập được (PAGEVIEW, CLICK, CUSTOM). Có unique constraint `(websiteId, eventId)` để đảm bảo tính **Idempotency** (không trùng lặp dữ liệu).
7. **EventDaily**: Bảng tổng hợp (aggregate) số liệu theo ngày của từng website bao gồm: `pageviews` (lượt xem), `visits` (lượt ghé thăm), `uniques` (khách truy cập duy nhất) nhằm tăng tốc độ truy vấn báo cáo tổng quan.

---

## 📥 Hệ Thống Thu Thập Dữ Liệu (Ingestion Pipeline)

Hệ thống thu thập dữ liệu qua endpoint công khai `/metrics/events`. Quá trình hoạt động diễn ra như sau:

1. **Xác thực API Key**: Kiểm tra header `x-api-key` có hợp lệ và chưa bị vô hiệu hóa (`revoked = false`) hay không.
2. **Domain Validation**: Lấy header `Origin` hoặc `Referer` để đối chiếu với domain đã đăng ký của `Website` trong DB. Nếu không trùng khớp sẽ từ chối request.
3. **Độ tin cậy dữ liệu**: Để tránh giả mạo dữ liệu, các thông tin nhạy cảm được trích xuất trực tiếp từ Request Headers thay vì tin tưởng nội dung gửi lên từ client body:
   - **IP Client**: Trích xuất từ `x-forwarded-for` (hỗ trợ proxy/load balancer) hoặc `request.ip`.
   - **User-Agent**: Trích xuất trực tiếp từ header `user-agent`.
   - **Country Hint**: Hỗ trợ nhận diện quốc gia trước qua các header của CDN lớn như Cloudflare (`cf-ipcountry`), Vercel (`x-vercel-ip-country`), CloudFront (`cloudfront-viewer-country`).
4. **Phân tích địa lý & thiết bị**:
   - Sử dụng `geoip-lite` để phân tích IP ra tên Quốc gia (Country) và Thành phố (City).
   - Sử dụng `ua-parser-js` để phân tích cấu hình phần cứng (Mobile, Tablet, Desktop), Trình duyệt (Chrome, Safari, Firefox) và Hệ điều hành (Windows, macOS, iOS, Android).
5. **Hàng đợi Kafka**: Đẩy thông tin sự kiện thô vào topic `metrics.events` sử dụng partition key là `websiteId` nhằm bảo đảm thứ tự event của website luôn nhất quán. Worker ngầm sẽ lấy event từ đây để xử lý ghi vào DB nhằm giảm tải tức thời cho Postgres.

---

## 🧭 Các API Endpoints Chính

Tất cả các API trả về dữ liệu báo cáo (trừ Ingestion `/metrics/events`) đều yêu cầu Header xác thực `Authorization: Bearer <JWT_Access_Token>` và được phân nhóm như sau:

### 1. Xác thực (Auth)
- `POST /auth/register`: Đăng ký tài khoản mới.
- `POST /auth/login`: Đăng nhập, trả về Access Token (thời hạn ngắn) và Refresh Token (thời hạn 7 ngày).
- `POST /auth/refresh`: Làm mới Access Token bằng cách sử dụng Refresh Token.
- `POST /auth/logout`: Đăng xuất, hủy hiệu lực của Refresh Token hiện tại.

### 2. Quản lý Website
- `POST /website`: Đăng ký website mới cần theo dõi.
- `GET /website`: Danh sách website của người dùng hiện tại.
- `DELETE /website/:id`: Xóa website và toàn bộ dữ liệu liên quan.
- `POST /website/:id/keys`: Tạo thêm API Key mới cho website.

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

# Cấu hình Kafka (Tùy chọn xử lý hàng đợi)
KAFKA_BROKER_URL=localhost:9092
KAFKA_CLIENT_ID=analyst-service
KAFKA_GROUP_ID=analyst-group
KAFKA_LOG_LEVEL=WARN

# Cấu hình Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# Cấu hình PostgreSQL & Prisma
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
   # Hoặc
   pnpm install
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

### Các tập lệnh kiểm thử (Testing):
- **Chạy unit tests**: `npm run test`
- **Chạy kiểm thử tích hợp (e2e)**: `npm run test:e2e`
- **Chạy kiểm thử và xuất báo cáo độ bao phủ**: `npm run test:cov`

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
  window.analyst && window.analyst.track('button_click', { label: 'đăng ký ngay', section: 'hero' });
  ```
