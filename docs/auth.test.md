# 🧪 Authentication Test Cases – Analyst Application

## Mục tiêu

Bộ testcase này bám theo tài liệu auth hiện có và cách triển khai thực tế trong codebase. Mục tiêu là xác nhận đầy đủ các luồng chính: register, login, refresh, logout, protected route và các ràng buộc bảo mật.

## Phạm vi

* API: `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`, `GET /auth/admin`
* Response format thực tế của app:
  * Success: `{ success: true, statusCode, message, path, timestamp, data }`
  * Error: `{ success: false, statusCode, message, error, path, timestamp }`
* Mức test ưu tiên: E2E ở tầng controller/service, dùng mock cho Prisma/JWT/guard để test độc lập với DB.

## Test cases theo endpoint

| ID | Kịch bản | Dữ liệu vào | Kỳ vọng |
| --- | --- | --- | --- |
| AUTH-001 | Register thành công | Email hợp lệ, password >= 8 ký tự | Trả `201`, `success=true`, `data.user` có `id/email/role/createdAt/updatedAt`, không có `password` |
| AUTH-002 | Register trùng email | Email đã tồn tại | Trả `409`, message `Email already exists` |
| AUTH-003 | Register email không hợp lệ | Email sai format | Trả `400`, lỗi validation |
| AUTH-004 | Register password quá ngắn | Password < 8 ký tự | Trả `400`, lỗi validation |
| AUTH-005 | Login thành công | Email + password đúng | Trả `201`, có `accessToken`, `refreshToken`, `tokenType`, `user` |
| AUTH-006 | Login sai email | Email không tồn tại | Trả `401`, message `Email or password is incorrect` |
| AUTH-007 | Login sai password | Email đúng, password sai | Trả `401`, message `Email or password is incorrect` |
| AUTH-008 | Refresh thành công | Refresh token hợp lệ và có session trong DB | Trả `201`, có `accessToken` mới, refresh session cũ bị revoke và session mới được tạo |
| AUTH-009 | Refresh token sai hoặc hết hạn | Refresh token không hợp lệ / JWT verify fail | Trả `403`, message `Invalid refresh token` |
| AUTH-010 | Refresh token hợp lệ nhưng user không còn tồn tại | JWT verify OK, user không tìm thấy | Trả `404`, message `User not found` |
| AUTH-011 | Refresh token không khớp session DB | Token hợp lệ nhưng không match hash trong DB | Trả `403`, message `Invalid refresh token` |
| AUTH-012 | Logout thành công với refresh token | Access token hợp lệ + refresh token hợp lệ | Trả `201`, `Logged out successfully`, session tương ứng bị xóa |
| AUTH-013 | Logout thành công không truyền refresh token | Chỉ có access token | Trả `201`, tất cả refresh session của user bị xóa |
| AUTH-014 | Logout với refresh token không hợp lệ | Access token hợp lệ + refresh token sai | Trả `403`, message `Invalid refresh token` |
| AUTH-015 | Get profile thành công | Access token hợp lệ | Trả `200`, `data.user` đúng user hiện tại |
| AUTH-016 | Get profile không có token | Không có Authorization header | Trả `401`, message `Invalid or missing access token` |
| AUTH-017 | Admin endpoint với role ADMIN | Access token của ADMIN | Trả `200`, message `Admin access granted` |
| AUTH-018 | Admin endpoint với role USER | Access token của USER | Trả `403`, message `Insufficient role` |

## Test cases bảo mật

| ID | Kịch bản | Kỳ vọng |
| --- | --- | --- |
| SEC-001 | Password khi register/login được hash trước khi lưu | Giá trị lưu vào DB không trùng password gốc, hash có thể verify bằng bcrypt |
| SEC-002 | Refresh token lưu DB phải là hash | `refreshToken.create` chỉ nhận token đã hash |
| SEC-003 | Response không trả về password | Không endpoint nào trả `password` trong body success |
| SEC-004 | Access token không được persist vào DB | Không có write nào lưu `accessToken` xuống DB |

## Test flow quan trọng

### Auto refresh

1. Gọi API bảo vệ bằng access token hết hạn.
2. Nhận `401`.
3. Gọi `POST /auth/refresh` bằng refresh token còn hiệu lực.
4. Nhận access token mới.
5. Retry request ban đầu và thành công.

## Dữ liệu test

* Dùng dữ liệu tách biệt cho test.
* Mỗi test phải độc lập, không phụ thuộc thứ tự chạy.
* Reset mock hoặc DB trước mỗi case.

## Ghi chú cho implementation

* Success response của app đang được bọc bởi interceptor, nên testcase phải assert vào `body.data`.
* Error response đang được bọc bởi exception filter, nên testcase phải assert `success=false`, `statusCode`, `message`, `error`.
* Các status code thực tế hiện tại: `register/login/refresh/logout` thường trả `201`, các route `GET` trả `200`.
