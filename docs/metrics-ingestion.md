# 📘 Metrics Ingestion System – Specification (Based on Current Prisma Schema)

---

## 1. 🎯 Mục tiêu

Xây dựng hệ thống analytics (analyst system) với các yêu cầu:

* Thu thập event từ website (tracker.js)
* Hỗ trợ multi-website (multi-tenant)
* Xử lý dữ liệu bất đồng bộ bằng Kafka
* Đảm bảo:

  * Idempotency (không duplicate event)
  * Security (API key + domain validation)
  * Scalability (high traffic)

---

## 2. 🧱 Database Design (Giữ nguyên schema hiện tại)

### ✔ Các entity chính

* User
* Website
* ApiKey
* Session
* Event
* EventDaily
* RefreshToken

---

### 🔑 ApiKey

```ts
revoked Boolean @default(false)
```

👉 Ý nghĩa:

* `revoked = false` → key đang hoạt động
* `revoked = true` → key đã bị vô hiệu hóa

👉 Khi ingest:

* bắt buộc check `revoked = false`

---

### 🧠 Session

```ts
@@unique([websiteId, externalSessionId])
```

👉 Lưu ý:

* `externalSessionId` được dùng để map session từ client
* Nếu null → có thể gây conflict nếu không xử lý

👉 Yêu cầu:

* Nếu có sessionId từ client → dùng lại
* Nếu không → generate mới

---

### 📦 Event

```ts
@@unique([websiteId, eventId])
```

👉 Đây là cơ chế **idempotency chính**

* Nếu event trùng `eventId` → bỏ qua

---

### 📊 EventDaily

* Dùng để aggregate:

  * pageviews
  * visits
  * uniques

---

## 3. 🧠 Kiến trúc hệ thống

```text
tracker.js
   ↓
POST /metrics/events
   ↓
NestJS API
   ↓
Kafka Producer
   ↓
Kafka Topic (metrics.events)
   ↓
Consumer Worker
   ↓
Database (Session, Event, EventDaily)
```

---

## 4. 🔐 Security Requirements

### 4.1 API Key Validation

* Lấy từ header:

```http
x-api-key: <key>
```

* Validate:

  * tồn tại trong DB
  * `revoked = false`

---

### 4.2 Domain Validation

* Lấy từ:

  * `origin` hoặc `referer`
* So sánh với:

```ts
Website.domain
```

* Nếu không match → reject

---

### 4.3 Không trust client

❌ Không dùng:

* ip từ body
* userAgent từ body

✔ Phải dùng:

* `x-forwarded-for`
* `user-agent`

---

## 5. 📥 Ingest Controller

### Yêu cầu:

* Không xử lý business logic
* Chỉ:

  * nhận request
  * validate header
  * gọi service

---

## 6. 🧠 Metrics Service

### 6.1 Validate API Key

* Query `ApiKey`
* Include `Website`

---

### 6.2 Normalize dữ liệu

* ip
* userAgent
* timestamp → convert sang `Date`

---

### 6.3 Push Kafka

```ts
kafka.send({
  topic: 'metrics.events',
  messages: [...]
});
```

---

## 7. 📨 Kafka Design

### Topic

```
metrics.events
```

---

### Partition key

* `websiteId` (recommended)

---

### Message format

```json
{
  "eventId": "string",
  "websiteId": "string",
  "externalSessionId": "string",
  "type": "PAGEVIEW | CLICK | CUSTOM",
  "timestamp": number,
  "url": "string",
  "referrer": "string",
  "ip": "string",
  "userAgent": "string",
  "metadata": {}
}
```

---

## 8. ⚙️ Consumer Logic

### 8.1 Session handling

* tìm session theo:

```ts
websiteId + externalSessionId
```

* nếu không tồn tại:

  * tạo session mới

---

### 8.2 Insert Event

* map:

  * `sessionId`
  * `websiteId`

* insert vào bảng Event

* nếu duplicate (`eventId`) → ignore

---

### 8.3 Update EventDaily

```ts
pageviews++
visits++
uniques++
```

---

## 9. 🚀 Performance Strategy

* Không ghi DB trực tiếp trong request
* Dùng Kafka để async processing
* Có thể batch insert trong consumer

---

## 10. 🧹 Data Growth Strategy

⚠️ Bắt buộc khi scale:

* Event table sẽ tăng rất nhanh
* cần:

  * archive dữ liệu cũ
  * hoặc partition theo thời gian

---

## 11. 🧪 Testing

* ingest event thành công
* reject API key sai
* reject key bị revoked
* reject sai domain
* duplicate event không bị insert

---

## 12. 🏗️ Folder Structure

```
metrics/
 ├── metrics.controller.ts
 ├── metrics.service.ts
 ├── dto/
 ├── kafka/
 │    ├── producer.service.ts
 │    ├── consumer.service.ts
 ├── workers/
```

---

## 13. ⚠️ Known Limitations (chấp nhận theo schema hiện tại)

* Event lưu nhiều field (ip, device, browser…) → có thể tăng size DB nhanh
* Session có unique constraint với `externalSessionId` → cần đảm bảo input hợp lệ
* ApiKey dùng boolean `revoked` → đủ dùng nhưng không linh hoạt như status enum

---

## 14. ✅ Acceptance Criteria

* Event → Kafka → DB thành công
* Không duplicate event
* Session được tạo đúng
* EventDaily được update
* API key validation đúng
* System chịu được traffic lớn

---
