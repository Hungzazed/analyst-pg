# 📘 Authentication Module Specification – Analyst Application

## 1. 🎯 Mục tiêu

Xây dựng hệ thống xác thực (Authentication) cho ứng dụng Analyst với các yêu cầu:

* Đăng ký / đăng nhập người dùng
* Sử dụng JWT (Access Token + Refresh Token)
* Tự động refresh access token khi hết hạn
* Hỗ trợ đăng xuất và quản lý session
* Đảm bảo bảo mật (hash password, revoke token)

---

## 2. 👤 User Model

```ts
User {
  id: string (UUID)
  email: string (unique)
  password: string (hashed)
  role: 'USER' | 'ADMIN'
  createdAt: Date
  updatedAt: Date
}
```

---

## 3. 🔐 Token Strategy

### Access Token

* Dùng để xác thực request
* Thời gian sống: 15 phút
* Lưu ở frontend (memory hoặc localStorage)

### Refresh Token

* Dùng để cấp lại access token
* Thời gian sống: 7 ngày
* Lưu ở HTTP-only cookie hoặc DB
* Phải được hash trước khi lưu DB

---

## 4. 🔄 Authentication Flow

### 4.1 Đăng ký (Register)

**Endpoint:** `POST /auth/register`

**Request:**

```json
{
  "email": "user@example.com",
  "password": "123456",
}
```

**Process:**

1. Validate input
2. Check email tồn tại
3. Hash password (bcrypt)
4. Lưu user vào DB
5. Trả về user (không có password)

---

### 4.2 Đăng nhập (Login)

**Endpoint:** `POST /auth/login`

**Request:**

```json
{
  "email": "user@example.com",
  "password": "123456"
}
```

**Process:**

1. Kiểm tra user tồn tại
2. So sánh password (bcrypt.compare)
3. Generate:

   * accessToken
   * refreshToken
4. Hash refreshToken → lưu DB
5. Trả về:

```json
{
  "accessToken": "...",
  "refreshToken": "..."
}
```

---

### 4.3 Refresh Token

**Endpoint:** `POST /auth/refresh`

**Request:**

```json
{
  "refreshToken": "..."
}
```

**Process:**

1. Verify refreshToken
2. Tìm user tương ứng
3. So sánh với token đã hash trong DB
4. Nếu hợp lệ:

   * Generate accessToken mới
   * (optional) rotate refreshToken
5. Trả về:

```json
{
  "accessToken": "new_token"
}
```

---

### 4.4 Logout

**Endpoint:** `POST /auth/logout`

**Process:**

1. Xóa refreshToken khỏi DB

---

## 5. 🔒 Security Requirements

* Password phải hash bằng bcrypt (salt >= 10)
* Refresh token phải được hash trước khi lưu DB
* Access token không lưu DB
* Validate JWT ở mỗi request (Guard)
* Không trả password trong response
* Rate limit login (optional)

---

## 6. 🧩 Middleware / Guard

### Auth Guard

* Kiểm tra access token
* Decode JWT
* Attach user vào request

### Roles Guard (optional)

* Kiểm tra quyền USER / ADMIN

---

## 7. 📦 Error Handling

| Case               | Response         |
| ------------------ | ---------------- |
| Sai email/password | 401 Unauthorized |
| Token hết hạn      | 401 Unauthorized |
| Refresh token sai  | 403 Forbidden    |
| User không tồn tại | 404 Not Found    |

---

## 8. 🔁 Auto Refresh (Frontend Behavior)

1. Gửi request với accessToken
2. Nếu 401:

   * gọi `/auth/refresh`
   * lấy accessToken mới
   * retry request ban đầu

---

## 9. 🗄️ Database (Refresh Token)

```ts
RefreshToken {
  id: string (UUID)
  token: string (hashed)
  userId: string
  expiresAt: Date
  createdAt: Date
}
```

---

## 10. 🧠 Optional Enhancements

* Multi-device login (mỗi device 1 refresh token)
* Token rotation
* Detect suspicious login
* OTP / Email verification

---

## 11. 🏗️ Expected Structure (NestJS)

```
auth/
 ├── auth.module.ts
 ├── auth.controller.ts
 ├── auth.service.ts
 ├── dto/
 ├── guards/
 ├── strategies/
```

---

## 12. ✅ Acceptance Criteria

* User đăng ký và đăng nhập thành công
* Access token hết hạn → tự refresh
* Logout → không dùng lại refresh token được
* API protected không truy cập nếu không có token
* Password không bao giờ trả về client

```
```
