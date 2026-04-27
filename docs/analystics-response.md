# Analystics Module - Response Data

Tai lieu nay mo ta du lieu tra ve cua cac endpoint trong module analystics.

## 1) Response envelope chung

Tat ca endpoint deu di qua ResponseInterceptor, nen response HTTP thanh cong co dang:

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

Phan du lieu ben duoi tap trung vao truong data.

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
  "summary": {
    "pageviews": 1200,
    "sessions": 430,
    "uniqueVisitors": 300,
    "averageSessionDurationMs": 75231,
    "averageSessionDurationSeconds": 75,
    "pageviewCount": 1200,
    "uniquePages": 52
  },
  "daily": [
    {
      "date": "2026-04-01T00:00:00.000Z",
      "pageviews": 120,
      "sessions": 48,
      "uniqueVisitors": 36
    }
  ]
}
```

## 3) GET /analytics/:websiteId/top-pages

### data

```json
{
  "range": {
    "from": "2026-04-01T00:00:00.000Z",
    "to": "2026-04-30T23:59:59.999Z"
  },
  "total": 1200,
  "pages": [
    {
      "value": "/",
      "count": 500,
      "share": 0.4166666667
    },
    {
      "value": "/pricing",
      "count": 230,
      "share": 0.1916666667
    }
  ]
}
```

Ghi chu:
- share la ti le trong khoang [0, 1].
- value la normalized page path.

## 4) GET /analytics/:websiteId/traffic-sources

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
      "value": "google.com",
      "count": 420,
      "share": 0.35
    },
    {
      "value": "direct",
      "count": 300,
      "share": 0.25
    },
    {
      "value": "internal",
      "count": 90,
      "share": 0.075
    }
  ]
}
```

Ghi chu:
- source co the la ten host, utm_source, direct, hoac internal.

## 5) GET /analytics/:websiteId/behavior

### data

```json
{
  "range": {
    "from": "2026-04-01T00:00:00.000Z",
    "to": "2026-04-30T23:59:59.999Z"
  },
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
  "transitions": [
    {
      "value": "/ -> /pricing",
      "count": 120
    },
    {
      "value": "/pricing -> /checkout",
      "count": 70
    }
  ],
  "averageSessionDurationMs": 75231
}
```

Ghi chu:
- journeys da loc cac session co it nhat 1 pageview.
- transitions la top transitions, toi da 20 phan tu.

## 6) GET /analytics/:websiteId/devices

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
    },
    {
      "value": "Safari",
      "count": 90,
      "share": 0.2093023256
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

## 7) GET /analytics/:websiteId/geo

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
    },
    {
      "value": "Japan",
      "count": 80,
      "share": 0.1860465116
    },
    {
      "value": "unknown",
      "count": 15,
      "share": 0.0348837209
    }
  ]
}
```

## 8) GET /analytics/:websiteId/funnel

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
  "dropoff": [
    {
      "step": 1,
      "dropoff": 0
    },
    {
      "step": 2,
      "dropoff": 0.4
    },
    {
      "step": 3,
      "dropoff": 0.375
    }
  ]
}
```

Ghi chu:
- Neu khong truyen landingUrl: step 1 dung pageview dau tien.
- Neu khong truyen nextUrl: step 2 dung pageview thu 2.
- Neu khong truyen conversionUrl: conversion dua vao CUSTOM event co metadata conversion=true/converted=true/isConversion=true.

## 9) Cac truong query anh huong den response

- from, to: xac dinh range tra ve trong data.range.
- limit: gioi han so phan tu cho top-pages va traffic-sources.
- sessionLimit: gioi han so journeys trong behavior.
- maxSessions: gioi han mau session cho funnel.

## 10) Cac loi thuong gap (khong nam trong data)

- 400 Bad Request: from/to sai dinh dang ISO, from >= to.
- 403 Forbidden: user khong so huu website.
- 404 Not Found: websiteId khong ton tai.
