---
document_type: ai_system_docs
version: 2.0.0
project: analyst-pg
purpose: Exact specifications for AI code generators to build the frontend without ambiguity.
---

# SYSTEM API SPECIFICATION (AI-READABLE)

## 1. System Overview

Hệ thống `analyst-pg` là một nền tảng Web Analytics (giống Google Analytics nhưng tinh gọn hơn), bao gồm các chức năng quản lý người dùng (Authentication), quản lý Websites cần tracking, tiếp nhận dữ liệu đo lường (Metrics Ingestion), và cung cấp báo cáo thống kê (Analytics).

- **Actors**:
  - `USER`: Quản lý website, xem analytics.
  - `ADMIN`: Quản trị hệ thống (hiện có chung các quyền truy cập hệ thống của User).
  - `TRACKER SCRIPT`: Gọi API ingest event lên hệ thống.
- **Base URL**: `http://localhost:3000` (hoặc domain tương ứng khi deploy). Không có prefix `/api`.

---

## 2. Global Rules

### 2.1 Headers

Tùy thuộc vào từng API, đây là các Header thông dụng:

```http
Authorization: Bearer <access_token>
Content-Type: application/json
x-api-key: <api_key_cua_website>
```

### 2.2 Response Format (GLOBAL)

Tất cả các API trả về thành công đều tuân theo chuẩn sau (bởi `ResponseInterceptor`):

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Success",
  "path": "/url/called",
  "timestamp": "2026-04-28T00:00:00.000Z",
  "data": { ... } // Dữ liệu thực sự của API
}
```

- `success`: `boolean` - Luôn là `true` khi thành công.
- `statusCode`: `number` - HTTP Status Code (200, 201).
- `message`: `string` - Mặc định là `"Success"`.
- `path`: `string` - Endpoint được gọi.
- `timestamp`: `string` - ISO 8601 string.
- `data`: `any` - Object hoặc Array chứa kết quả trả về.

---

## 3. Authentication Flow

- **Login**: Frontend gọi `POST /auth/login` với email/password. 
  - Backend trả về `access_token` ở field `data.accessToken` và tự động set cookie `refresh_token` (HTTP-Only).
  - Frontend lưu `access_token` vào Memory hoặc LocalStorage.
- **Refresh token**: Khi `access_token` hết hạn (401), frontend gọi `POST /auth/refresh`. Backend đọc cookie `refresh_token` và trả về `access_token` mới.
- **Logout**: Frontend gọi `POST /auth/logout`. Backend xóa cookie và revoke token ở Database.

---

## 4. API Specification

### [POST] /auth/register

**Description:**
Đăng ký tài khoản mới.

**Auth Required:** No

**Headers:**

| Name | Required | Value |
| ---- | -------- | ----- |
| Content-Type | Yes | application/json |

**Request Body:**

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Success",
  "path": "/auth/register",
  "timestamp": "2026-04-28T00:00:00.000Z",
  "data": {
    "id": "uuid-string",
    "email": "user@example.com",
    "role": "USER",
    "createdAt": "2026-04-28T00:00:00.000Z",
    "updatedAt": "2026-04-28T00:00:00.000Z"
  }
}
```

**Field Breakdown (Request):**

| Field | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| email | string | Yes | Email định dạng hợp lệ |
| password | string | Yes | Tối thiểu 8 ký tự |

**Frontend Usage:**
- Gọi từ màn hình `/register`.

---

### [POST] /auth/login

**Description:**
Đăng nhập, lấy access token.

**Auth Required:** No

**Headers:**

| Name | Required | Value |
| ---- | -------- | ----- |
| Content-Type | Yes | application/json |

**Request Body:**

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Success",
  "path": "/auth/login",
  "timestamp": "2026-04-28T00:00:00.000Z",
  "data": {
    "accessToken": "eyJhbG...",
    "user": {
      "id": "uuid-string",
      "email": "user@example.com",
      "role": "USER",
      "createdAt": "2026-04-28T00:00:00.000Z",
      "updatedAt": "2026-04-28T00:00:00.000Z"
    }
  }
}
```

**Frontend Usage:**
- Gọi từ màn hình `/login`. 
- Ghi nhận `accessToken` vào Memory hoặc LocalStorage.

---

### [POST] /auth/refresh

**Description:**
Lấy access token mới từ refresh_token cookie.

**Auth Required:** No (But requires Cookie)

**Headers:** (Trình duyệt tự gửi Cookie)

**Response:**

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Success",
  "path": "/auth/refresh",
  "timestamp": "2026-04-28T...",
  "data": {
    "accessToken": "eyJhbG..."
  }
}
```

**Frontend Usage:**
- Gọi khi một API trả về 401 Unauthorized do token hết hạn.

---

### [POST] /auth/logout

**Description:**
Đăng xuất tài khoản.

**Auth Required:** Yes

**Headers:**

| Name | Required | Value |
| ---- | -------- | ----- |
| Authorization | Yes | Bearer <access_token> |

**Response:**

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Success",
  "path": "/auth/logout",
  "timestamp": "2026-04-28T...",
  "data": {
    "success": true
  }
}
```

---

### [GET] /auth/me

**Description:**
Lấy thông tin profile hiện tại.

**Auth Required:** Yes

**Headers:** (Authorization: Bearer <access_token>)

**Response:**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Success",
  "path": "/auth/me",
  "timestamp": "2026-04-28T...",
  "data": {
    "id": "uuid-string",
    "email": "user@example.com",
    "role": "USER",
    "createdAt": "2026-04-28T00:00:00.000Z",
    "updatedAt": "2026-04-28T00:00:00.000Z"
  }
}
```

---

### [GET] /websites

**Description:**
Lấy danh sách các Website của user hiện tại.

**Auth Required:** Yes

**Response:**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Success",
  "path": "/websites",
  "timestamp": "2026-04-28T...",
  "data": [
    {
      "id": "uuid-string",
      "name": "My Site",
      "domain": "example.com",
      "userId": "uuid-string",
      "createdAt": "2026-04-28T00:00:00.000Z"
    }
  ]
}
```

---

### [POST] /websites

**Description:**
Tạo mới một Website.

**Auth Required:** Yes

**Request Body:**

```json
{
  "name": "My Site",
  "domain": "example.com"
}
```

**Field Breakdown:**

| Field | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| name | string | Yes | Max 100 characters |
| domain | string | Yes | Max 255 chars. Without protocol (e.g., example.com) |

**Response:** Trả về Object Website vừa tạo giống format trong mảng `[GET] /websites`.

---

### [PATCH] /websites/:id

**Description:**
Sửa thông tin Website.

**Auth Required:** Yes

**Request Body:**

```json
{
  "name": "My Site Updated",
  "domain": "example2.com"
}
```
*(Các field đều Optional)*

---

### [DELETE] /websites/:id

**Description:**
Xóa website.

**Auth Required:** Yes

**Response:** Trả về Object `{"success": true}` trong `data`.

---

### [POST] /websites/:id/api-keys

**Description:**
Tạo API Key mới cho Website.

**Auth Required:** Yes

**Response:**

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Success",
  "path": "/websites/.../api-keys",
  "timestamp": "2026-04-28T...",
  "data": {
    "id": "uuid-string",
    "key": "sk_12345...",
    "websiteId": "uuid-string",
    "createdAt": "2026-04-28T00:00:00.000Z",
    "revoked": false
  }
}
```
*Lưu ý: Đây là lần duy nhất key thô được trả về. Cần show cho user copy.*

---

### [GET] /websites/:id/api-keys

**Description:**
Lấy danh sách các API Key đang active của website.

**Auth Required:** Yes

**Response:** Trả về mảng các API Key object. Lưu ý `key` ở API này có thể đã bị hash hoặc ẩn một phần từ DB (chỉ hiện một phần).

---

### [PATCH] /websites/:id/api-keys/:apiKeyId/revoke

**Description:**
Thu hồi API Key.

**Auth Required:** Yes

---

### [POST] /metrics/events

**Description:**
Tracker ingest data lên hệ thống.

**Auth Required:** No

**Headers:**

| Name | Required | Value |
| ---- | -------- | ----- |
| x-api-key | Yes | <api-key-cua-website> |

**Request Body:**

```json
{
  "eventId": "evt_123",
  "type": "PAGEVIEW",
  "timestamp": 1713945600000,
  "sessionId": "sess_123",
  "url": "https://example.com"
}
```

**Field Breakdown:**

| Field | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| eventId | string | Yes | Unique idempotency key (max 128) |
| type | string | Yes | Enum: PAGEVIEW, CLICK, CUSTOM |
| timestamp | number | Yes | Event timestamp (ms) |
| sessionId | string | No | External session id (max 128) |
| userId | string | No | External user id |
| url | string | No | Absolute URL |
| title | string | No | Page title |
| referrer | string | No | Absolute URL referrer |
| userAgent | string | No | Browser User-Agent |
| country | string | No | VN, US... |
| ip | string | No | IP Address |
| device | string | No | desktop, mobile... |
| browser | string | No | Chrome, Safari... |
| os | string | No | Windows, macOS... |
| metadata | object | No | Dữ liệu custom tùy ý |

---

### ANALYTICS APIs (Chung)

**Auth Required:** Yes
**Headers:** `Authorization: Bearer <access_token>`

Tất cả các API Analytics dưới đây đều chia sẻ chung Query params (trừ một số ngoại lệ được ghi chú riêng):

| Query | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| from | string | No | Start time (ISO-8601) |
| to | string | No | End time (ISO-8601) |
| limit | number | No | Max items returned (1-100) |
| sessionLimit | number | No | Max sessions returned (1-50) |

*(Note: Response Data của Analytics được bọc trong object `data` của Global Response Format. Dưới đây chỉ mô tả phần `data` object trả về).*

---

### [GET] /analytics/:websiteId/overview

**Description:** Lấy dữ liệu tổng quan và thông số từng ngày.

**Response `data` Field:**
```json
{
  "website": { "id": "...", "domain": "..." },
  "range": { "from": "...", "to": "..." },
  "previousRange": { "from": "...", "to": "..." },
  "summary": {
    "pageviews": 1000,
    "pageviewsChange": 0.1,
    "sessions": 500,
    "sessionsChange": 0.2,
    "uniqueVisitors": 300,
    "uniqueVisitorsChange": -0.05,
    "bounceRate": 0.35,
    "bounceRateChange": 0.01,
    "averageSessionDurationMs": 150000,
    "averageSessionDurationMsChange": 0.1,
    "averageSessionDurationSeconds": 150,
    "uniquePages": 5
  },
  "daily": [
    {
      "date": "2026-04-28T00:00:00.000Z",
      "pageviews": 100,
      "sessions": 50,
      "uniqueVisitors": 30,
      "bounceRate": 0.3
    }
  ]
}
```

---

### [GET] /analytics/:websiteId/events

**Description:** Lấy dữ liệu các custom event.

**Response `data` Field:**
```json
{
  "range": { "from": "...", "to": "..." },
  "total": 100,
  "events": [
    {
      "value": "click-button",
      "type": "CUSTOM",
      "count": 50,
      "share": 0.5,
      "metadataBreakdownTotal": 50,
      "metadataBreakdownLimit": 5,
      "metadataBreakdown": [
        { "key": "buttonId", "value": "submit", "count": 25, "share": 0.5 }
      ]
    }
  ]
}
```

---

### [GET] /analytics/:websiteId/top-pages

**Description:** Thống kê top pages (url).

**Response `data` Field:**
```json
{
  "website": { "id": "..." },
  "range": { "from": "...", "to": "..." },
  "total": 1000,
  "pages": [
    {
      "value": "/home",
      "count": 500,
      "share": 0.5,
      "avgTimeOnPageMs": 60000,
      "bounceRate": 0.2,
      "exitRate": 0.3
    }
  ]
}
```

---

### [GET] /analytics/:websiteId/traffic-sources

**Description:** Nguồn truy cập (Referrer/UTM).

**Response `data` Field:**
```json
{
  "range": { "from": "...", "to": "..." },
  "total": 500,
  "sources": [
    {
      "value": "Google",
      "source": "Google",
      "medium": "organic",
      "campaign": null,
      "count": 200,
      "share": 0.4
    }
  ]
}
```

---

### [GET] /analytics/:websiteId/behavior

**Description:** Hành vi người dùng, flow chuyển trang.

**Response `data` Field:**
```json
{
  "range": { "from": "...", "to": "..." },
  "journeysTotal": 100,
  "journeysLimit": 10,
  "journeys": [
    {
      "sessionId": "sess_123",
      "entryPage": "/home",
      "exitPage": "/checkout",
      "pages": ["/home", "/pricing", "/checkout"],
      "pageviews": 3,
      "durationMs": 120000
    }
  ],
  "topEntryPages": [{ "value": "/home", "count": 80 }],
  "topExitPages": [{ "value": "/checkout", "count": 30 }],
  "avgPagesPerSession": 2.5,
  "transitions": {
    "total": 150,
    "items": [{ "value": "/home -> /pricing", "count": 40 }]
  },
  "averageSessionDurationMs": 150000
}
```

---

### [GET] /analytics/:websiteId/devices

**Description:** Thiết bị, hệ điều hành, trình duyệt.

**Response `data` Field:**
```json
{
  "range": { "from": "...", "to": "..." },
  "totalSessions": 500,
  "deviceShare": [{ "value": "desktop", "count": 300, "share": 0.6 }],
  "browserUsage": [{ "value": "Chrome", "count": 250, "share": 0.5 }],
  "osUsage": [{ "value": "Windows", "count": 200, "share": 0.4 }],
  "mobileVsDesktop": { "mobile": 200, "desktop": 300 }
}
```

---

### [GET] /analytics/:websiteId/geo

**Description:** Thống kê theo quốc gia, thành phố.

**Response `data` Field:**
```json
{
  "range": { "from": "...", "to": "..." },
  "totalSessions": 500,
  "countries": [{ "value": "VN", "count": 400, "share": 0.8 }],
  "cities": [
    {
      "value": "Hanoi",
      "country": "VN",
      "count": 200,
      "share": 0.4,
      "shareOfTotal": 0.4,
      "shareOfCountry": 0.5
    }
  ]
}
```

---

### [GET] /analytics/:websiteId/retention

**Description:** Tỉ lệ quay lại (Cohort Analysis).

**Query parameters riêng:** `granularity` ('day' \| 'week'), `periods` (number).

**Response `data` Field:**
```json
{
  "range": { "from": "...", "to": "..." },
  "granularity": "day",
  "periods": 7,
  "cohorts": [
    {
      "cohortStart": "2026-04-20T00:00:00.000Z",
      "cohortEnd": "2026-04-20T23:59:59.999Z",
      "users": 100,
      "retention": [
        { "period": 0, "count": 100, "rate": 1 },
        { "period": 1, "count": 40, "rate": 0.4 }
      ]
    }
  ]
}
```

---

### [GET] /analytics/:websiteId/funnel

**Description:** Thống kê chuyển đổi (Funnel).

**Query parameters riêng:** `landingUrl`, `nextUrl`, `conversionUrl` (string), `maxSessions` (number).

**Response `data` Field:**
```json
{
  "range": { "from": "...", "to": "..." },
  "steps": [
    { "name": "Landing page", "target": "/home", "count": 500 },
    { "name": "Next page", "target": "/pricing", "count": 200 },
    { "name": "Conversion", "target": "/checkout", "count": 50 }
  ],
  "totalConversionRate": 0.1
}
```

---

### [GET] /analytics/:websiteId/realtime

**Description:** Lấy trạng thái realtime. 
**Query parameters riêng:** `windowMinutes` (number), `sessionLimit` (number).

**Response `data` Field:**
```json
{
  "range": { "from": "...", "to": "..." },
  "windowMinutes": 5,
  "onlineUsers": 10,
  "activeSessionsLimit": 50,
  "activeSessions": [
    {
      "sessionId": "sess_123",
      "currentPage": "/home",
      "lastSeenAt": "2026-04-28T...",
      "country": "VN",
      "device": "desktop",
      "browser": "Chrome",
      "os": "Windows"
    }
  ],
  "currentPages": [{ "value": "/home", "count": 5 }],
  "totalActivePages": 3
}
```

---

### [SSE] /analytics/:websiteId/realtime/stream

**Description:** API Server-Sent Events (SSE) trả về dữ liệu realtime dạng stream liên tục.

**Frontend Usage:** Sử dụng `EventSource` để lắng nghe. Response KHÔNG bọc theo chuẩn Interceptor JSON.

**Data stream event (Mỗi event trả về format này):**
```text
event: snapshot
data: { ...giống hệt object data trả về ở [GET] /realtime... }
retry: 5000
```

---

## 5. Error Handling

Bất kỳ lỗi nào (400 Validation, 401 Unauthorized, 404 Not Found, 409 Conflict) đều tuân theo chuẩn sau:

```json
{
  "success": false,
  "statusCode": 400,
  "message": [
    "email must be an email",
    "password must be longer than or equal to 8 characters"
  ],
  "error": "Bad Request",
  "path": "/auth/register",
  "timestamp": "2026-04-28T00:00:00.000Z"
}
```

- `message`: Có thể là `string` hoặc mảng các lỗi `string[]` (do `class-validator` sinh ra). Frontend cần handle mảng `message` để hiện toast báo lỗi.

---

## 6. Data Models

```ts
type Role = "USER" | "ADMIN";
type EventType = "PAGEVIEW" | "CLICK" | "CUSTOM";

type User = {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
}

type Website = {
  id: string;
  name: string;
  domain: string;
  userId: string;
  createdAt: string;
}

type ApiKey = {
  id: string;
  key: string;
  websiteId: string;
  createdAt: string;
  revoked: boolean;
}
```

---

## 7. Frontend Integration Guide

1. **Cách gọi API**: 
   Sử dụng Axios hoặc Fetch (qua một `apiClient` chung). Bắt buộc bọc config để thêm `Authorization: Bearer` vào mỗi request.
2. **Handle Interceptor**: 
   API Backend trả về `.data` bọc trong `data`. Nghĩa là nếu dùng Axios, để lấy được Website Object, bạn phải gọi `response.data.data`.
3. **Retry Flow (Token Expiration)**:
   - Nếu call api bị lỗi `401 Unauthorized`.
   - Bắt exception ở Interceptor của frontend, gọi `POST /auth/refresh`.
   - Nếu `refresh` thành công, lưu token mới và call lại API cũ.
   - Nếu `refresh` thất bại (lỗi 401/403), logout user ra trang `/login`.
4. **Token Storage**:
   - Lưu `accessToken` tại LocalStorage (hoặc In-memory store như Zustand/Redux tùy mức độ security). 
   - Không cần quan tâm `refreshToken` vì Backend set cookie tự động.
