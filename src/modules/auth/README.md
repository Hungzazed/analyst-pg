# Auth Module

## Mục tiêu

`AuthModule` cung cấp lớp xác thực cho ứng dụng NestJS hiện tại. Module này làm 3 việc chính:

1. Đăng ký người dùng mới.
2. Đăng nhập và cấp JWT access token.
3. Bảo vệ các endpoint cần đăng nhập, ví dụ `GET /auth/me`.

Module đang dựa trực tiếp trên schema Prisma hiện tại, cụ thể là model `User` với các trường `id`, `email`, `password`, `role`, `createdAt`, `updatedAt`.

## Thành phần chính

### `AuthController`

Controller expose các endpoint:

- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`

### `AuthService`

Service xử lý toàn bộ business logic:

- Kiểm tra email đã tồn tại khi đăng ký.
- Hash mật khẩu bằng `bcrypt` trước khi lưu vào database.
- So khớp mật khẩu khi đăng nhập.
- Ký JWT bằng `JwtService`.
- Lấy profile hiện tại từ `user.id` trong token.

### `JwtStrategy` và `JwtAuthGuard`

- `JwtStrategy` đọc token từ header `Authorization: Bearer <token>`.
- Token được xác thực bằng `JWT_SECRET`.
- Sau khi token hợp lệ, strategy gọi `AuthService.validateUserById()` để chắc chắn user vẫn còn tồn tại trong database.
- `JwtAuthGuard` dùng để chặn endpoint chưa đăng nhập.

### `Roles` decorator và `RolesGuard`

- `Roles` gắn metadata role yêu cầu lên handler hoặc controller.
- `RolesGuard` đọc metadata đó và so sánh với `request.user.role`.
- Nếu user không có role phù hợp, request bị từ chối bằng lỗi `403 Forbidden`.
- Cặp này dùng để tách rõ authentication và authorization.

### `CurrentUser` decorator

Decorator này lấy `request.user` sau khi JWT strategy chạy xong. Hiện tại nó được dùng trong `GET /auth/me`.

### DTO

- `RegisterDto` yêu cầu `email` hợp lệ và `password` tối thiểu 8 ký tự.
- `LoginDto` dùng cùng rule validation.

## Luồng hoạt động

### 1. Register

1. Client gửi `email` và `password` tới `POST /auth/register`.
2. Service kiểm tra email đã tồn tại hay chưa.
3. Password được hash bằng `bcrypt`.
4. User mới được tạo trong Prisma.
5. Ứng dụng trả về `accessToken` và thông tin user công khai.

### 2. Login

1. Client gửi `email` và `password` tới `POST /auth/login`.
2. Service tìm user theo email.
3. Service so khớp password với hash trong database.
4. Nếu hợp lệ, app trả về JWT access token.

### 3. Get profile

1. Client gọi `GET /auth/me` với header Bearer token.
2. `JwtAuthGuard` kiểm tra token.
3. `JwtStrategy` xác nhận token và nạp user.
4. `AuthService.getProfile()` trả về profile hiện tại.

### 4. Admin route mẫu

1. Client gọi `GET /auth/admin` với Bearer token.
2. `JwtAuthGuard` xác thực token.
3. `RolesGuard` kiểm tra user có role `ADMIN`.
4. Nếu hợp lệ, API trả về message xác nhận quyền admin.

## Dữ liệu trả về

Response sau đăng ký hoặc đăng nhập có dạng:

```ts
{
  accessToken: string;
  tokenType: 'Bearer';
  user: {
    id: string;
    email: string;
    role: 'USER' | 'ADMIN';
    createdAt: Date;
    updatedAt: Date;
  }
}
```

## Biến môi trường liên quan

- `JWT_SECRET`: secret dùng để ký và verify JWT.
- `JWT_EXPIRES_IN`: thời gian sống của access token, ví dụ `7d`.
- `DATABASE_URL`: cấu hình qua `prisma.config.ts` để Prisma Client kết nối database.

## Lưu ý hiện tại

- Password chỉ được hash khi đăng ký, không bao giờ trả về ra ngoài.
- Module mới chỉ có access token, chưa có refresh token.
- Chưa có phân quyền ở mức route, chỉ có xác thực đăng nhập.
- Đã có mẫu role-based authorization bằng `@Roles(Role.ADMIN)`.
- `GET /auth/me` trả về profile từ database tại thời điểm request.

## Cải tiến đề xuất

### 1. Thêm refresh token

Hiện tại access token sống ngắn thì user phải đăng nhập lại thường xuyên. Nên bổ sung refresh token để:

- Giữ phiên đăng nhập lâu hơn.
- Giảm số lần nhập lại mật khẩu.
- Cho phép xoay vòng token an toàn hơn.

### 2. Bổ sung logout và revoke token

Nếu có refresh token, nên lưu hash refresh token hoặc `tokenVersion` trong database để:

- Thu hồi toàn bộ token khi user logout.
- Vô hiệu hóa token cũ sau khi đổi mật khẩu.

### 3. Thêm role-based authorization

Schema đã có enum `Role` với `USER` và `ADMIN`, nên có thể thêm guard hoặc decorator kiểu `@Roles('ADMIN')` để:

- Giới hạn endpoint quản trị.
- Tách rõ authentication và authorization.

Đã triển khai sẵn trong repo bằng `Roles` + `RolesGuard`, và có ví dụ endpoint `GET /auth/admin`.

### 4. Thêm email verification

Nên xác thực email sau khi đăng ký để tránh tài khoản rác và tăng độ tin cậy của dữ liệu user.

### 5. Thêm quên mật khẩu / đổi mật khẩu

Nên có flow reset password bằng email token để hỗ trợ người dùng khi mất mật khẩu.

### 6. Cấu hình bcrypt và JWT bằng env

Hiện `bcrypt` dùng salt round cố định `10`. Có thể đưa các giá trị này vào env để dễ cân chỉnh theo môi trường.

### 7. Tách response DTO rõ ràng hơn

Hiện response auth đang trả object inline trong service. Có thể chuẩn hóa thành DTO riêng để:

- Dễ document API.
- Dễ maintain.
- Dễ dùng lại ở controller và test.

### 8. Thêm test e2e và unit test

Nên có test cho các case quan trọng:

- Register thành công.
- Register trùng email.
- Login thành công.
- Login sai mật khẩu.
- `/auth/me` khi có và không có token.

### 9. Thêm rate limiting cho login

Endpoint login nên có giới hạn request để giảm brute-force attack.

### 10. Thêm audit log

Với hệ thống production, nên log các hành vi:

- Đăng nhập thành công/thất bại.
- Đổi mật khẩu.
- Logout.

## Kết luận

Auth module hiện tại đã đủ để làm authentication cơ bản cho ứng dụng: register, login, verify token và lấy profile hiện tại. Nếu muốn đưa lên production, ưu tiên tiếp theo nên là refresh token, role-based authorization, email verification và test coverage.