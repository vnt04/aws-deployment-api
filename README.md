# AWS Deployment API

File Management API viết bằng NestJS — project thực hành đầy đủ một luồng deploy AWS thật:
EC2, Nginx, PM2, Domain, HTTPS, RDS MySQL, S3 và IAM Role.

```
Client ──▶ Nginx (HTTPS) ──▶ NestJS (PM2) ──┬──▶ RDS MySQL   (user data)
                                            └──▶ S3          (avatar files)
```

Điểm chính: **cùng một codebase chạy được cả local lẫn AWS** — chỉ đổi biến môi trường.

## Yêu cầu

- Node.js >= 20
- Docker (chạy MySQL ở local)
- AWS account (từ giai đoạn 2 trở đi)

## Chạy local

```bash
cp .env.example .env
docker compose up -d mysql
npm ci
npm run start:dev
```

API chạy tại `http://localhost:3000`. Migration tự chạy khi khởi động.

Chạy cả API trong Docker:

```bash
docker compose up -d --build
```

## API

Tất cả response dùng chung một envelope:

```jsonc
// Thành công
{ "success": true, "data": { ... }, "error": null }

// Có phân trang
{ "success": true, "data": [ ... ], "error": null,
  "meta": { "total": 25, "page": 1, "limit": 20, "totalPages": 2 } }

// Lỗi
{ "success": false, "data": null,
  "error": { "code": "NOT_FOUND", "message": "Không tìm thấy user với id 1" } }
```

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `POST` | `/users` | Tạo user |
| `GET` | `/users?page=1&limit=20` | Danh sách user (phân trang) |
| `GET` | `/users/:id` | Chi tiết user |
| `PATCH` | `/users/:id` | Cập nhật user |
| `DELETE` | `/users/:id` | Xoá user (xoá luôn avatar trên S3) |
| `POST` | `/users/:id/avatar` | Upload avatar (`multipart/form-data`, field `avatar`) |
| `GET` | `/health` | Liveness — dùng cho Nginx/ALB |
| `GET` | `/health/ready` | Readiness — chạy `SELECT 1` xuống database |

### Ví dụ

```bash
# Tạo user
curl -X POST http://localhost:3000/users \
  -H 'Content-Type: application/json' \
  -d '{"name":"Nguyen Van A","email":"a@example.com"}'

# Upload avatar
curl -X POST http://localhost:3000/users/1/avatar -F 'avatar=@./avatar.jpg'
```

Luồng upload:

```
Client ──▶ NestJS ──▶ S3 PutObject ──▶ avatar URL ──▶ MySQL (cột avatar_url)
```

File nằm ở `users/<id>/avatar.<ext>`; database chỉ lưu URL, không lưu binary.
Ảnh cũ được xoá khỏi S3 khi user upload ảnh định dạng khác.

Giới hạn upload: 5MB, chỉ nhận JPEG / PNG / WEBP. Định dạng được xác thực bằng
magic bytes chứ không tin `Content-Type` do client gửi lên.

## Cấu trúc

```
src/
├── common/          # envelope response, exception filter, DTO dùng chung
├── config/          # đọc + validate biến môi trường
├── database/        # TypeORM datasource, migrations
├── health/          # liveness / readiness
├── storage/         # S3 client, nhận diện định dạng ảnh
└── users/           # controller, service, repository, entity, DTO
```

## Biến môi trường

Xem `.env.example` để biết danh sách đầy đủ. Những biến thay đổi khi lên AWS:

| Biến | Local | AWS |
|------|-------|-----|
| `DB_HOST` | `127.0.0.1` | endpoint RDS |
| `DB_SSL` | `false` | `true` |
| `AWS_ACCESS_KEY_ID` | access key của IAM User | **để trống** (dùng IAM Role) |
| `AWS_SECRET_ACCESS_KEY` | secret key | **để trống** |
| `CORS_ORIGINS` | `*` | domain thật |

App validate toàn bộ biến môi trường lúc khởi động và fail ngay nếu thiếu — không để
lỗi cấu hình lộ ra ở request đầu tiên.

## Test

```bash
npm test           # unit test
npm run test:cov   # kèm coverage (ngưỡng tối thiểu 80%)
npm run test:e2e   # test HTTP end-to-end (không cần MySQL/AWS)
```

## Migration

```bash
npm run migration:run
npm run migration:revert
npm run migration:generate -- src/database/migrations/TenMigration
```

## Deploy

Hướng dẫn từng bước cho cả 6 giai đoạn nằm ở **[docs/deployment.md](docs/deployment.md)**.

File hỗ trợ sẵn có:

| File | Dùng cho |
|------|----------|
| `deploy/deploy.sh` | Deploy trên EC2 (pull → build → migrate → reload PM2) |
| `deploy/nginx/api.conf` | Nginx reverse proxy |
| `ecosystem.config.js` | PM2 cluster mode |
| `deploy/aws/s3-iam-policy.json` | Policy gắn vào IAM Role của EC2 |
| `deploy/aws/s3-bucket-policy-public-read.json` | Cho phép đọc công khai `users/*` |
