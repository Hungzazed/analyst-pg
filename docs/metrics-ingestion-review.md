# Metrics Ingestion Review Notes

Tai lieu nay ghi lai cac yeu cau trong docs/metrics-ingestion.md ma minh KHONG ap dung nguyen van, vi khong hop ly hoac khong phu hop voi codebase hien tai.

## 1) EventDaily khong the tang visits++ va uniques++ cho moi event

- Spec hien tai ghi `pageviews++`, `visits++`, `uniques++` trong consumer step 8.3.
- Neu ap dung nhu vay, `visits` va `uniques` se bi thoi phong khi 1 session gui nhieu event.
- Da ap dung logic phu hop hon:
  - `pageviews`: tang khi event type = PAGEVIEW.
  - `visits`: tang khi tao session moi.
  - `uniques`: tang theo heuristic unique visitor (session moi co externalSessionId, hoac IP chua xuat hien trong ngay).

## 2) Session unique constraint voi externalSessionId null

- Spec canh bao "neu null co the gay conflict".
- Trong PostgreSQL + Prisma, unique composite co cot nullable cho phep nhieu ban ghi `NULL`.
- Vi vay khong co conflict truc tiep khi `externalSessionId = null`.
- He thong van tao session moi neu khong co `sessionId` tu client (phu hop acceptance).

## 3) Folder structure de xuat trong spec

- Spec de xuat structure rieng cho metrics (`metrics/kafka`, `workers`).
- Du an hien tai da co `src/infrastructure/kafka` dung chung cho toan bo he thong.
- Da trien khai theo huong lai:
  - Bo sung producer/consumer cho metrics trong `src/modules/metrics/kafka`.
  - Tai su dung `KafkaService` o `src/infrastructure/kafka` de dong bo kien truc hien co.

## 4) Time partition / archive strategy

- Spec neu yeu cau partition/archive khi scale (muc 10), nhung day la van de van hanh va migration schema o giai doan sau.
- Chua ap dung migration partition trong lan nay de tranh thay doi schema lon va anh huong toi cac module analytics hien tai.

## 5) Khong trust client IP/User-Agent

- Spec yeu cau khong lay IP/User-Agent tu body.
- Da ap dung dung yeu cau:
  - IP lay tu `x-forwarded-for` (fallback `request.ip`).
  - User-Agent lay tu header `user-agent`.
- Du lieu cung ten trong body (neu co) se bi bo qua khi enqueue.
