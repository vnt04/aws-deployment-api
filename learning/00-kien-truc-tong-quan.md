# Kiến trúc tổng quan

## Bức tranh đích

```
                        User
                          │
                          ▼
                 api.yourdomain.com          ← Giai đoạn 5: DNS + HTTPS
                          │
                          ▼
                     Elastic IP              ← Giai đoạn 3: IP tĩnh
                          │
              ┌───────────┴─────────┐
              │        EC2          │
              │   Nginx  :80/:443   │        ← Giai đoạn 4: reverse proxy
              │         │           │
              │   NestJS :3000      │        ← Giai đoạn 3: PM2
              │      (PM2)          │
              └──────────┬──────────┘
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
          RDS MySQL                S3
          dữ liệu user          file avatar
          (Giai đoạn 6)        (Giai đoạn 2 ✅)
```

Hiện tại (sau giai đoạn 4), phần đang chạy là:

```
Internet ──▶ EC2 (Elastic IP)
              ├── Nginx  :80         ← Giai đoạn 4 ✅
              │       │
              │       ▼
              │   NestJS :3000       ← Giai đoạn 3 ✅
              └── MySQL :3306 (Docker)
```

Tức là **code đã chạy trên EC2, traffic qua Nginx reverse proxy, upload lên S3 thật**. Giai đoạn 5 thêm DNS + HTTPS, giai đoạn 6 chuyển MySQL sang RDS.

## Luận điểm xuyên suốt: code không đổi, chỉ đổi cấu hình

Đây là điều toàn bộ project được thiết kế để chứng minh. Cùng một artifact build ra chạy được
ở mọi môi trường; thứ thay đổi nằm hoàn toàn trong `.env`.

| Biến | Local | Trên AWS | Đổi cái gì bên dưới |
|------|-------|----------|---------------------|
| `DB_HOST` | `127.0.0.1` | endpoint RDS | MySQL container → RDS managed |
| `DB_SSL` | `false` | `true` | kết nối DB có mã hoá đường truyền |
| `AWS_ACCESS_KEY_ID` | access key IAM User | **để trống** | secret trên đĩa → IAM Role tạm thời |
| `CORS_ORIGINS` | `*` | domain thật | mở cho mọi origin → chỉ frontend của mình |

Nhìn kỹ hàng thứ ba: **để trống lại là cấu hình an toàn hơn.** Lý do nằm ở
[`src/storage/storage.module.ts:22-30`](../src/storage/storage.module.ts) — khi không có
access key, AWS SDK tự đi tìm credential từ IAM Role. Chi tiết ở
[file giai đoạn 2](02-s3-va-iam.md#iam-user-vs-iam-role).

### Vì sao điều này quan trọng

Một codebase phải sửa mới deploy được sẽ sinh ra hai vấn đề:

- **Không tái lập được.** Bản chạy trên server khác bản đã test ở local, nên bug chỉ xuất hiện ở prod.
- **Không rollback được.** Muốn quay lại phiên bản cũ phải nhớ đã sửa những gì.

Ngược lại, khi cấu hình tách khỏi code thì một commit = một artifact = chạy ở mọi nơi.
Đây chính là factor III của [12-Factor App](https://12factor.net/config) — không phải lý
thuyết suông mà là thứ giai đoạn 6 sẽ kiểm chứng trực tiếp: đổi `DB_HOST` sang RDS, restart,
app chạy tiếp, không build lại.

## Bản đồ source code

```
src/
├── common/          # thứ dùng chung cho mọi module
│   ├── dto/             envelope response, DTO phân trang
│   ├── filters/         bắt mọi exception → format lỗi thống nhất
│   └── interceptors/    bọc mọi response thành công
├── config/          # đọc + validate biến môi trường (chạy 1 lần lúc boot)
├── database/        # TypeORM datasource, migrations
├── health/          # liveness / readiness — Nginx và ALB gọi vào đây
├── storage/         # S3 client, nhận diện định dạng ảnh
└── users/           # controller → service → repository → entity
```

Nguyên tắc chia thư mục: **theo tính năng (feature), không theo loại file (type).**
Mọi thứ liên quan tới user nằm chung trong `users/`, thay vì rải ra
`controllers/`, `services/`, `entities/`. Sửa một tính năng thì chỉ mở một thư mục.

## Luồng của một request

Lấy `POST /users/1/avatar` làm ví dụ, đi qua các tầng theo thứ tự:

```
HTTP request
   │
   ├─▶ ThrottlerGuard          rate limit (100 req/phút mặc định)
   │
   ├─▶ FileInterceptor         parse multipart, chặn file > 5MB
   │
   ├─▶ ValidationPipe          validate + transform param/body
   │
   ├─▶ UsersController         chỉ nhận HTTP, không có logic
   │      │
   │      ▼
   │   UsersService            business logic: kiểm định dạng, đặt key, dọn ảnh cũ
   │      │
   │      ├──▶ StorageService  ──▶ S3 PutObject
   │      └──▶ UsersRepository ──▶ MySQL UPDATE
   │
   ├─▶ ResponseInterceptor     bọc kết quả vào envelope { success, data, error }
   │
   └─▶ AllExceptionsFilter     nếu có lỗi ở bất kỳ đâu → envelope lỗi
```

Ba tầng đầu và hai tầng cuối là **hạ tầng** — viết một lần, áp dụng cho mọi endpoint.
Chỉ Controller/Service/Repository là code riêng của tính năng. Tỷ lệ này là dấu hiệu
của framework dùng đúng cách: thêm endpoint mới không phải viết lại phần bọc response,
không phải nhớ tự validate.

## Tự kiểm tra

1. Vì sao giai đoạn 2 (S3) làm trước giai đoạn 3 (EC2), dù kiến trúc đích có EC2 đứng trước S3?
2. Trên EC2, để trống `AWS_ACCESS_KEY_ID` thì app lấy quyền gọi S3 từ đâu?
3. Nếu một ngày phải thêm `if (process.env.NODE_ENV === 'production')` vào business logic,
   đó là dấu hiệu của vấn đề gì?
