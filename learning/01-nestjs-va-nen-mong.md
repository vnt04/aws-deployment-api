# Giai đoạn 1 — NestJS và nền móng

> Mục tiêu giai đoạn: API chạy được ở local với MySQL trong Docker.
> Kiến thức thu được lại vượt xa mục tiêu đó — đây là phần đặt nền cho tất cả giai đoạn sau.

## 1. Kiến trúc tầng: Controller → Service → Repository

Mỗi tầng có đúng một việc:

| Tầng | Trách nhiệm | Được biết gì | **Không** được biết gì |
|------|-------------|--------------|------------------------|
| Controller | Nhận HTTP, trả HTTP | route, param, status code | SQL, S3, business rule |
| Service | Business logic | quy tắc nghiệp vụ | Express, HTTP, SQL cụ thể |
| Repository | Truy cập dữ liệu | TypeORM, câu query | quy tắc nghiệp vụ |

Xem [`src/users/users.controller.ts`](../src/users/users.controller.ts) — mỗi method đúng
một dòng, chỉ gọi xuống service:

```ts
@Post(':id/avatar')
@UseInterceptors(FileInterceptor('avatar', { limits: { fileSize: MAX_AVATAR_BYTES, files: 1 } }))
async uploadAvatar(
  @Param('id', ParseIntPipe) id: number,
  @UploadedFile() file?: Express.Multer.File,
): Promise<UserResponse> {
  return this.usersService.updateAvatar(id, file);
}
```

**Vì sao tách?** Không phải để "cho đẹp". Lý do thực tế:

- **Test được.** `UsersService` test được mà không cần dựng HTTP server, không cần MySQL —
  chỉ cần repository giả. Xem [`test/fakes.ts`](../test/fakes.ts).
- **Đổi được vỏ ngoài.** Muốn thêm giao diện GraphQL hay CLI cho cùng nghiệp vụ, viết
  controller mới, service giữ nguyên.
- **Lỗi có địa chỉ.** Sai định dạng response → controller/interceptor. Sai nghiệp vụ →
  service. Sai dữ liệu → repository. Không phải đọc cả file 500 dòng.

Dấu hiệu tầng bị rò rỉ: service `import` thứ gì từ `express`, hoặc controller viết câu SQL.

## 2. Cấu hình: validate lúc khởi động, không phải lúc dùng

[`src/config/env.validation.ts`](../src/config/env.validation.ts) khai báo toàn bộ biến môi
trường như một class có ràng buộc, rồi `validateEnv()` (dòng 133) kiểm tra **một lần khi app boot**:

```ts
if (errors.length > 0) {
  throw new Error(`Cấu hình môi trường không hợp lệ:\n  - ${details}`);
}
```

Thiếu `S3_BUCKET` → app **không khởi động được**, và báo rõ thiếu biến nào.

**So sánh hai cách làm:**

```ts
// Cách phổ biến — hỏng ở thời điểm tệ nhất
const bucket = process.env.S3_BUCKET;   // undefined, chưa ai biết
// ...30 phút sau, user đầu tiên upload ảnh → 500, log khó hiểu

// Cách của project — hỏng ở thời điểm tốt nhất
// app chết ngay lúc deploy, thấy ngay trên màn hình, chưa user nào bị ảnh hưởng
```

Đây là nguyên tắc **fail fast**: lỗi cấu hình nên nổ lúc khởi động, khi bạn đang nhìn màn hình,
chứ đừng nổ lúc 2 giờ sáng ở request của khách hàng.

### Ba chi tiết nhỏ đáng chú ý

**`process.env` luôn trả về string.** `PORT=3000` trong `.env` là chuỗi `"3000"`, không phải
số. Nên phải có `ToNumber()` (dòng 32) ép kiểu trước khi validate `@IsInt()`.

**Chuỗi rỗng ≠ chưa set.** Hàm `isBlank()` (dòng 23) coi `AWS_ACCESS_KEY_ID=` (để trống)
là *không set*. Quan trọng ở giai đoạn 3: trên EC2 ta để trống biến này, và SDK phải hiểu
là "không có credential, đi tìm IAM Role" chứ không phải "credential là chuỗi rỗng".

**Giá trị mặc định nằm ngay trong class.** `PORT = 3000`, `DB_SSL = false`. Không cần
`||` rải rác khắp code, và đọc file này là biết đủ mọi biến app cần.

## 3. Envelope response: mọi phản hồi cùng một hình dạng

Client gọi API luôn nhận về cùng một cấu trúc, dù thành công hay thất bại:

```jsonc
{ "success": true,  "data": { ... }, "error": null }
{ "success": false, "data": null,    "error": { "code": "NOT_FOUND", "message": "..." } }
```

Thực hiện bằng hai mảnh ghép đăng ký toàn cục ở
[`src/app.module.ts:29-33`](../src/app.module.ts):

- [`ResponseInterceptor`](../src/common/interceptors/response.interceptor.ts) — bọc mọi
  kết quả **thành công**
- [`AllExceptionsFilter`](../src/common/filters/all-exceptions.filter.ts) — bắt mọi
  **exception**, kể cả lỗi không lường trước

Giá trị: code trong service chỉ cần `return user` hoặc `throw new NotFoundException(...)`.
Không ai phải nhớ tự bọc. Không có endpoint nào lỡ trả về format khác.

### Chi tiết bảo mật quan trọng

Hàm `describe()` ([all-exceptions.filter.ts:51](../src/common/filters/all-exceptions.filter.ts)):

```ts
if (!(exception instanceof HttpException)) {
  return { status: 500, message: 'Đã có lỗi xảy ra' };
}
```

Lỗi **không phải** `HttpException` (tức lỗi ngoài dự kiến: mất kết nối DB, null pointer,
S3 timeout) chỉ trả ra đúng một câu chung chung. Stack trace và chi tiết thật đi vào **log
phía server**, không đi vào response.

Vì sao: message lỗi hệ thống thường lộ thông tin hạ tầng — tên bảng, tên cột, đường dẫn
file, phiên bản thư viện, thậm chí endpoint RDS. Đó là nguyên liệu miễn phí cho người đang
dò tìm lỗ hổng. Đây là mục **A05: Security Misconfiguration** trong OWASP Top 10.

## 4. Migration là nguồn sự thật của schema

```ts
synchronize: config.synchronize,      // false ở production
migrationsRun: config.runMigrations,  // true — tự chạy khi boot
```

TypeORM có `synchronize: true` — tự sửa bảng cho khớp entity. Rất tiện lúc code, và
**rất nguy hiểm ở production**: nó có thể `DROP COLUMN` khi bạn đổi tên một field, mang
theo toàn bộ dữ liệu cột đó. Không hỏi, không backup.

Migration ([`src/database/migrations/`](../src/database/migrations/)) thì ngược lại:

- Là file, nên **vào git** — biết ai đổi schema, đổi lúc nào, vì sao
- **Có thứ tự** — timestamp trong tên file quyết định thứ tự chạy
- **Đảo ngược được** — mỗi migration có `down()`, hỏng thì `npm run migration:revert`
- **Giống nhau ở mọi môi trường** — local, staging, prod chạy cùng một chuỗi thay đổi

Quy tắc: `DB_SYNCHRONIZE=false` ở mọi nơi trừ lúc thử nghiệm nhanh trên máy cá nhân.

## 5. Unique index là chốt chặn cuối, không phải câu `SELECT`

Đoạn này ở [`users.service.ts:40-52`](../src/users/users.service.ts) dạy một bài học về
đồng thời (concurrency):

```ts
async create(dto: CreateUserDto): Promise<UserResponse> {
  await this.assertEmailAvailable(dto.email);   // SELECT ... WHERE email = ?
  try {
    return toUserResponse(await this.usersRepository.create(dto));
  } catch (error) {
    // Hai request cùng email có thể vượt qua assertEmailAvailable, unique index là chốt chặn cuối.
    if (isDuplicateEntryError(error)) {
      throw new ConflictException(`Email ${dto.email} đã được sử dụng`);
    }
    throw error;
  }
}
```

**Vì sao kiểm tra trước vẫn chưa đủ?** Hai request đến gần như đồng thời:

```
t=0ms   Request A: SELECT email → không thấy → coi như hợp lệ
t=1ms   Request B: SELECT email → không thấy → coi như hợp lệ   ← A chưa INSERT xong
t=2ms   Request A: INSERT → OK
t=3ms   Request B: INSERT → ER_DUP_ENTRY
```

Khoảng trống giữa lúc kiểm tra và lúc ghi gọi là **race condition**. Không thể bịt bằng
cách kiểm tra kỹ hơn ở tầng ứng dụng — chỉ database mới đảm bảo được tính duy nhất, vì
chỉ nó nhìn thấy toàn bộ các ghi đang diễn ra.

Nên mô hình đúng là: `SELECT` để có **thông báo lỗi đẹp** cho trường hợp thường gặp,
unique index để có **tính đúng đắn** cho trường hợp hiếm.

Ràng buộc nằm ở [`user.entity.ts:18`](../src/users/entities/user.entity.ts):
`@Index('uq_users_email', { unique: true })`.

## 6. Các lớp bảo vệ mặc định

Trong [`src/main.ts`](../src/main.ts) và [`app.module.ts`](../src/app.module.ts), bật một lần
cho toàn app:

| Thành phần | Chống lại | Ghi chú |
|-----------|-----------|---------|
| `helmet()` | clickjacking, MIME sniffing, XSS phản chiếu | set các HTTP security header |
| `enableCors({ origin })` | domain lạ gọi API bằng cookie của user | siết về domain thật ở giai đoạn 5 |
| `ValidationPipe({ whitelist, forbidNonWhitelisted })` | mass assignment | field lạ trong body → **báo lỗi**, không âm thầm bỏ qua |
| `ThrottlerGuard` | brute force, lạm dụng API | mặc định 100 req/phút |
| `app.set('trust proxy', 1)` | rate limit đếm nhầm | xem bên dưới |

**`trust proxy` — vì sao cần:** Khi Nginx đứng trước (giai đoạn 4), mọi request đến Node
đều mang IP nguồn là `127.0.0.1` (chính Nginx). Không có `trust proxy`, rate limiter sẽ
thấy *toàn bộ* traffic đến từ một IP duy nhất → một người dùng nhiều có thể chặn cả hệ thống.
Bật lên, Express đọc IP thật từ header `X-Forwarded-For`.

Con số `1` nghĩa là "tin đúng một proxy phía trước". Đặt `true` (tin tất cả) là lỗ hổng:
client tự gửi `X-Forwarded-For` giả để né rate limit.

## 7. Liveness và readiness là hai câu hỏi khác nhau

| Endpoint | Câu hỏi | Chạm database? | Ai gọi |
|----------|---------|:---:|--------|
| `/health` | *Tiến trình còn sống?* | không | Nginx, PM2 |
| `/health/ready` | *Sẵn sàng nhận traffic?* | có — `SELECT 1` | ALB, script deploy |

Tách ra vì hai câu hỏi dẫn tới hai hành động khác nhau. App sống nhưng mất kết nối DB thì
đáp án đúng là **tạm ngừng gửi traffic vào, chờ DB hồi phục** — không phải giết và khởi động
lại tiến trình (restart không làm DB sống lại, chỉ làm mất thêm thời gian warm-up).

Ở giai đoạn 6, `/health/ready` là công cụ xác nhận app đã nói chuyện được với RDS.

## 8. Docker Compose: `DB_HOST` có hai giá trị khác nhau

Điểm dễ nhầm trong [`docker-compose.yml:26-30`](../docker-compose.yml):

```yaml
environment:
  # DB_HOST/DB_PORT trong .env là địa chỉ nhìn từ host. Trong network của compose,
  # MySQL nằm ở service name và luôn lắng nghe cổng 3306 gốc.
  DB_HOST: mysql
  DB_PORT: 3306
```

Cùng một MySQL, hai địa chỉ tuỳ theo ai đang gọi:

```
npm run start:dev  (Node ở host)     ──▶ 127.0.0.1:3306   qua port mapping
docker compose up  (Node trong mạng) ──▶ mysql:3306       qua DNS nội bộ của compose
```

Docker Compose tạo một mạng riêng, trong đó **tên service là hostname**. Container `api` gọi
`mysql` là tới được, không cần biết IP. Còn `127.0.0.1` bên trong container trỏ về chính
container đó — nên nếu để nguyên `DB_HOST=127.0.0.1`, `api` sẽ tự gọi vào mình và báo
connection refused.

Bài học tổng quát: **"localhost" luôn tương đối với người đang nói.** Sẽ gặp lại đúng khái
niệm này ở giai đoạn 4 (Nginx `proxy_pass` tới `127.0.0.1:3000` — hợp lệ vì Nginx và Node
ở cùng một EC2).

## Tự kiểm tra

1. Vì sao `assertEmailAvailable()` vẫn cần thiết dù đã có unique index? Bỏ hàm đó đi thì mất gì?
2. `DB_SYNCHRONIZE=true` ở production có thể gây ra chuyện gì cụ thể?
3. App trả 500 kèm message `"Đã có lỗi xảy ra"` — chi tiết lỗi thật tìm ở đâu, và vì sao
   không đưa vào response?
4. Khai báo `trust proxy` sai (`true` thay vì `1`) thì kẻ tấn công lợi dụng được điều gì?
