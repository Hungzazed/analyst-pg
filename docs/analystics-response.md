# Analystics Module - Response Data

Tai lieu nay mo ta response moi nhat cua cac endpoint trong module analystics.

## 1) Response envelope chung

Tat ca endpoint deu di qua ResponseInterceptor, nen response thanh cong co dang:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Success",
  "path": "/analytics/:websiteId/...",
  "timestamp": "2026-04-27T09:00:00.000Z",
  "data": {}
}
```

Phan ben duoi chi mo ta du lieu trong `data`.

## 2) GET /analytics/:websiteId/overview

### data

```json
{
  "website": {
    "id": "uuid",
    "name": "My Website",
    "domain": "example.com",
    "userId": "uuid"
  },
  "range": {
    "from": "2026-04-01T00:00:00.000Z",
    "to": "2026-04-30T23:59:59.999Z"
  },
  "previousRange": {
    "from": "2026-03-02T00:00:00.000Z",
    "to": "2026-04-01T00:00:00.000Z"
  },
  "summary": {
    "pageviews": 1200,
    "pageviewsChange": 12.5,
    "sessions": 430,
    "sessionsChange": -3.2,
    "uniqueVisitors": 300,
    "uniqueVisitorsChange": 8,
    "bounceRate": 0.42,
    "bounceRateChange": -2.1,
    "averageSessionDurationMs": 75231,
    "averageSessionDurationMsChange": 5.3,
    "averageSessionDurationSeconds": 75,
    "uniquePages": 52
  },
  "daily": [
    {
      "date": "2026-04-01T00:00:00.000Z",
      "pageviews": 120,
      "sessions": 48,
      "uniqueVisitors": 36,
      "bounceRate": 0.38
    }
  ]
}
```

Ghi chu:
- `previousRange` la khoang so sanh ngay truoc do, co cung do dai voi `range`.
- `*Change` la phan tram thay doi so voi ky truoc.
- `bounceRate` va `bounceRateChange` dang la so thap phan.

## 3) GET /analytics/:websiteId/events

### data

```json
{
  "range": {
    "from": "2026-04-01T00:00:00.000Z",
    "to": "2026-04-30T23:59:59.999Z"
  },
  "total": 240,
  "events": [
    {
      "value": "click",
      "type": "CLICK",
      "count": 160,
      "share": 0.6666666667,
      "metadataBreakdownTotal": 160,
      "metadataBreakdownLimit": 5,
      "metadataBreakdown": [
        {
          "key": "label",
          "value": "cta",
          "count": 90,
          "share": 0.5625
        }
      ]
    },
    {
      "value": "form_submit",
      "type": "CUSTOM",
      "count": 80,
      "share": 0.3333333333,
      "metadataBreakdownTotal": 80,
      "metadataBreakdownLimit": 5,
      "metadataBreakdown": []
    }
  ]
}
```

Ghi chu:
- Endpoint nay lay tat ca custom events, khong tinh PAGEVIEW.
- `value` duoc rut ra tu metadata neu co `eventName`, `name`, `action`, `label`, `event`, hoac fallback ve ten `type`.
- `metadataBreakdown` la top metadata keys/value phu tro trong moi event group.

## 4) GET /analytics/:websiteId/top-pages

### data

```json
{
  "website": {
    "id": "uuid",
    "name": "My Website",
    "domain": "example.com",
    "userId": "uuid"
  },
  "range": {
    "from": "2026-04-01T00:00:00.000Z",
    "to": "2026-04-30T23:59:59.999Z"
  },
  "total": 1200,
  "pages": [
    {
      "value": "/",
      "count": 500,
      "share": 0.4166666667,
      "avgTimeOnPageMs": 45000,
      "bounceRate": 0.38,
      "exitRate": 0.22
    }
  ]
}
```

Ghi chu:
- `bounceRate` va `exitRate` la so thap phan.
- `avgTimeOnPageMs` tinh theo pageview lien tiep trong cung session.

## 5) GET /analytics/:websiteId/traffic-sources

### data

```json
{
  "range": {
    "from": "2026-04-01T00:00:00.000Z",
    "to": "2026-04-30T23:59:59.999Z"
  },
  "total": 1200,
  "sources": [
    {
      "value": "google",
      "source": "google",
      "medium": "cpc",
      "campaign": "spring_sale",
      "count": 420,
      "share": 0.35
    },
    {
      "value": "direct",
      "source": "direct",
      "medium": null,
      "campaign": null,
      "count": 300,
      "share": 0.25
    },
    {
      "value": "internal",
      "source": "internal",
      "medium": "internal",
      "campaign": null,
      "count": 90,
      "share": 0.075
    }
  ]
}
```

Ghi chu:
- `value` van duoc giu lai de backward-compatible.
- Neu co UTM, `source`/`medium`/`campaign` duoc tach rieng.

## 6) GET /analytics/:websiteId/behavior

### data

```json
{
  "range": {
    "from": "2026-04-01T00:00:00.000Z",
    "to": "2026-04-30T23:59:59.999Z"
  },
  "journeysTotal": 430,
  "journeysLimit": 50,
  "journeys": [
    {
      "sessionId": "uuid",
      "entryPage": "/",
      "exitPage": "/checkout",
      "pages": ["/", "/pricing", "/checkout"],
      "pageviews": 3,
      "durationMs": 180000
    }
  ],
  "topEntryPages": [
    {
      "value": "/",
      "count": 180
    }
  ],
  "topExitPages": [
    {
      "value": "/checkout",
      "count": 90
    }
  ],
  "avgPagesPerSession": 2.8,
  "transitions": {
    "total": 340,
    "items": [
      {
        "value": "/ -> /pricing",
        "count": 120
      },
      {
        "value": "/pricing -> /checkout",
        "count": 70
      }
    ]
  },
  "averageSessionDurationMs": 75231
}
```

Ghi chu:
- `journeys` chi gom session co it nhat 1 pageview.
- `transitions.total` la tong so transition cua toan bo range, con `items` la top transitions.

## 7) GET /analytics/:websiteId/realtime

### data

```json
{
  "range": {
    "from": "2026-04-27T09:00:00.000Z",
    "to": "2026-04-27T09:05:00.000Z"
  },
  "windowMinutes": 5,
  "onlineUsers": 12,
  "activeSessionsLimit": 50,
  "activeSessions": [
    {
      "sessionId": "uuid",
      "currentPage": "/pricing",
      "lastSeenAt": "2026-04-27T09:04:31.000Z",
      "country": "Vietnam",
      "device": "desktop",
      "browser": "Chrome",
      "os": "Windows"
    }
  ],
  "currentPages": [
    {
      "value": "/pricing",
      "count": 5
    }
  ],
  "totalActivePages": 3
}
```

Ghi chu:
- `windowMinutes` la cua so hoat dong gan nhat de tinh realtime.
- `activeSessions` la danh sach session con active trong cua so nay.
- `activeSessionsLimit` la gioi han session duoc tra ve.
- `totalActivePages` la tong so trang dang co nguoi online.

## 8) GET /analytics/:websiteId/realtime/stream

### SSE stream

Endpoint nay tra ve SSE va push event theo nhan `snapshot`.

Mo hinh payload moi lan push giong het response cua `GET /analytics/:websiteId/realtime`:

```json
{
  "range": {
    "from": "2026-04-27T09:00:00.000Z",
    "to": "2026-04-27T09:05:00.000Z"
  },
  "windowMinutes": 5,
  "onlineUsers": 12,
  "activeSessionsLimit": 50,
  "activeSessions": [],
  "currentPages": [],
  "totalActivePages": 0
}
```

## 9) GET /analytics/:websiteId/devices

### data

```json
{
  "range": {
    "from": "2026-04-01T00:00:00.000Z",
    "to": "2026-04-30T23:59:59.999Z"
  },
  "totalSessions": 430,
  "deviceShare": [
    {
      "value": "mobile",
      "count": 260,
      "share": 0.6046511628
    },
    {
      "value": "desktop",
      "count": 150,
      "share": 0.3488372093
    },
    {
      "value": "unknown",
      "count": 20,
      "share": 0.0465116279
    }
  ],
  "browserUsage": [
    {
      "value": "Chrome",
      "count": 300,
      "share": 0.6976744186
    }
  ],
  "osUsage": [
    {
      "value": "Windows",
      "count": 180,
      "share": 0.4186046512
    }
  ],
  "mobileVsDesktop": [
    {
      "value": "mobile",
      "count": 260,
      "share": 0.6046511628
    },
    {
      "value": "desktop",
      "count": 150,
      "share": 0.3488372093
    },
    {
      "value": "other",
      "count": 20,
      "share": 0.0465116279
    }
  ]
}
```

## 10) GET /analytics/:websiteId/geo

### data

```json
{
  "range": {
    "from": "2026-04-01T00:00:00.000Z",
    "to": "2026-04-30T23:59:59.999Z"
  },
  "totalSessions": 430,
  "countries": [
    {
      "value": "Vietnam",
      "count": 220,
      "share": 0.511627907
    }
  ],
  "cities": [
    {
      "value": "Ho Chi Minh City",
      "country": "Vietnam",
      "count": 140,
      "share": 0.325,
      "shareOfTotal": 0.325,
      "shareOfCountry": 0.636
    },
    {
      "value": "unknown",
      "country": "Vietnam",
      "count": 80,
      "share": 0.186,
      "shareOfTotal": 0.186,
      "shareOfCountry": 0.364
    }
  ]
}
```

## 11) GET /analytics/:websiteId/retention

### data

```json
{
  "range": {
    "from": "2026-04-01T00:00:00.000Z",
    "to": "2026-04-30T23:59:59.999Z"
  },
  "granularity": "day",
  "periods": 7,
  "cohorts": [
    {
      "cohortStart": "2026-04-01T00:00:00.000Z",
      "cohortEnd": "2026-04-01T23:59:59.999Z",
      "users": 120,
      "retention": [
        {
          "period": 0,
          "count": 120,
          "rate": 1
        },
        {
          "period": 1,
          "count": 48,
          "rate": 0.4
        }
      ]
    }
  ]
}
```

Ghi chu:
- `granularity` co the la `day` hoac `week`.
- `periods` quyet dinh so cot retention tra ve.
- `period = 0` luon la baseline cohort, vi vay `rate` luon = 1.

## 12) GET /analytics/:websiteId/funnel

### data

```json
{
  "range": {
    "from": "2026-04-01T00:00:00.000Z",
    "to": "2026-04-30T23:59:59.999Z"
  },
  "steps": [
    {
      "name": "Landing page",
      "target": "/pricing",
      "count": 200
    },
    {
      "name": "Next page",
      "target": "/checkout",
      "count": 120
    },
    {
      "name": "Conversion",
      "target": "/success",
      "count": 75
    }
  ],
  "totalConversionRate": 0.375,
  "dropoff": [
    {
      "step": 1,
      "dropoff": null,
      "conversionRate": null
    },
    {
      "step": 2,
      "dropoff": 0.4,
      "conversionRate": 0.6
    },
    {
      "step": 3,
      "dropoff": 0.375,
      "conversionRate": 0.625
    }
  ]
}
```

Ghi chu:
- Neu khong truyen `landingUrl`: step 1 dung pageview dau tien.
- Neu khong truyen `nextUrl`: step 2 dung pageview thu 2.
- Neu khong truyen `conversionUrl`: conversion dua vao CUSTOM event co metadata `conversion=true` hoac `converted=true` hoac `isConversion=true`.

## 13) Cac truong query anh huong den response

- `from`, `to`: xac dinh `range`.
- `limit`: gioi han so phan tu cho `events`, `top-pages`, `traffic-sources`.
- `sessionLimit`: gioi han so `journeys` trong behavior, va gioi han session cho realtime.
- `windowMinutes`: cua so realtime.
- `limit` trong realtime la alias cu (deprecated), nen uu tien `sessionLimit`.
- `refreshSeconds`: toc do SSE stream.
- `periods`: so period retention tra ve.
- `granularity`: cap tinh retention (`day` hoac `week`).
- `maxSessions`: gioi han session mau cho funnel.

## 14) Cac loi thuong gap (khong nam trong data)

- `400 Bad Request`: `from`/`to` sai dinh dang ISO, `from >= to`.
- `403 Forbidden`: user khong so huu website.
- `404 Not Found`: `websiteId` khong ton tai.
