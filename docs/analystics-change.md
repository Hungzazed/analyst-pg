# Analytics Module v2 — Danh sách cần sửa

## 1. Overview endpoint (`GET /analytics/:websiteId/overview`)

### 1.1 Thêm `bounceRate` vào từng phần tử `daily`

`summary` đã có `bounceRate` nhưng mảng `daily` thiếu — client không vẽ được biểu đồ bounce rate theo ngày.

```json
"daily": [
  {
    "date": "2026-04-01T00:00:00.000Z",
    "pageviews": 120,
    "sessions": 48,
    "uniqueVisitors": 36,
    "bounceRate": 0.38        // thêm mới
  }
]
```

### 1.2 Xóa trường `pageviewCount` trong `summary`

`pageviews` và `pageviewCount` đang trả về cùng một giá trị (đều = 1200). Xóa `pageviewCount` để tránh nhầm lẫn.

```json
"summary": {
  "pageviews": 1200,
  "pageviewsChange": 12.5,
  // xóa "pageviewCount" — trùng với "pageviews"
  "sessions": 430,
  ...
}
```

---

## 2. Realtime endpoint (`GET /analytics/:websiteId/realtime` và SSE stream)

### 2.1 Giới hạn `activeSessions` và thêm metadata về limit

Trả về toàn bộ raw session list sẽ không scale được khi có nhiều traffic. Cần giới hạn và thông báo rõ cho client.

```json
{
  "onlineUsers": 500,
  "activeSessions": [...],        // chỉ trả về tối đa N session gần nhất
  "activeSessionsLimit": 50,      // thêm mới — số session tối đa trả về
  "currentPages": [...],
  "totalActivePages": 12          // thêm mới — tổng số trang đang có người xem
}
```

Query param tương ứng: thêm `sessionLimit` để client tự control (default 50, max 200).

### 2.2 Thêm `totalActivePages` vào response

`currentPages` trả về list nhưng không rõ tổng có bao nhiêu trang đang có người — thêm trường này để client hiển thị đúng.

---

## 3. Retention endpoint (`GET /analytics/:websiteId/retention`)

### 3.1 Thêm `cohortEnd` vào từng cohort

`cohortStart` có nhưng không có `cohortEnd` — client phải tự tính dựa vào `granularity`, dễ sai với edge case cuối tháng.

```json
"cohorts": [
  {
    "cohortStart": "2026-04-01T00:00:00.000Z",
    "cohortEnd": "2026-04-07T23:59:59.999Z",    // thêm mới
    "users": 120,
    "retention": [...]
  }
]
```

### 3.2 Document rõ `period: 0` là baseline

`period: 0` luôn có `rate: 1` vì đây là cohort gốc — không có ý nghĩa thống kê nhưng vẫn nên giữ để client render đúng bảng retention. Thêm ghi chú vào document: *"period 0 luôn là baseline, rate luôn = 1"*.

---

## 4. Events endpoint (`GET /analytics/:websiteId/events`)

### 4.1 Thêm metadata về `metadataBreakdown`

Client không biết còn bao nhiêu metadata value khác không nằm trong list trả về. Thêm 2 trường:

```json
{
  "value": "click",
  "count": 160,
  "metadataBreakdownTotal": 160,    // thêm mới — tổng events có metadata key này
  "metadataBreakdownLimit": 5,      // thêm mới — số item tối đa trong breakdown
  "metadataBreakdown": [
    { "key": "label", "value": "cta", "count": 90, "share": 0.5625 }
  ]
}
```

---

## 5. Behavior endpoint (`GET /analytics/:websiteId/behavior`)

### 5.1 Thêm `journeysTotal` và `journeysLimit`

`journeys` trả về raw list không rõ đây là toàn bộ hay sample — client không biết có bao nhiêu session thực tế.

```json
{
  "journeysTotal": 430,      // thêm mới — tổng số session trong range
  "journeysLimit": 100,      // thêm mới — số journeys tối đa trả về
  "journeys": [...]
}
```

Query param tương ứng: `sessionLimit` đã có, nhưng response cần echo lại giá trị đang dùng qua `journeysLimit`.

---

## 6. Geo endpoint (`GET /analytics/:websiteId/geo`)

### 6.1 Làm rõ `share` của `cities` — tách thành `shareOfTotal` và `shareOfCountry`

Hiện tại `share` trong `cities` không rõ mẫu số là tổng sessions hay tổng sessions của country đó — gây nhầm lẫn khi render.

```json
"cities": [
  {
    "value": "Ho Chi Minh City",
    "country": "Vietnam",
    "count": 140,
    "shareOfTotal": 0.325,       // thay thế "share" — % trên tổng tất cả sessions
    "shareOfCountry": 0.636      // thêm mới — % trong sessions của Vietnam
  }
]
```

> Nếu muốn giữ backward-compatible thì giữ lại `share` (= `shareOfTotal`) và bổ sung thêm `shareOfCountry`.

---

## 7. Không có thay đổi

Các endpoint sau không cần sửa:
- `top-pages` — đã đầy đủ
- `traffic-sources` — đã đầy đủ
- `devices` — đã đầy đủ
- `funnel` — đã đầy đủ
- Error codes (400, 403, 404) — đã đầy đủ
- Query params hiện tại — đã đầy đủ