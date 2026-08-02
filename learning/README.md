# Sổ tay học — AWS Deployment API

Ghi lại **kiến thức** rút ra từ project, không phải hướng dẫn thao tác.
Hướng dẫn làm từng bước nằm ở [`docs/deployment.md`](../docs/deployment.md) — hai tài liệu này bổ sung cho nhau:

| Tài liệu | Trả lời câu hỏi |
|----------|-----------------|
| `docs/deployment.md` | **Làm thế nào?** — bấm nút nào, chạy lệnh gì |
| `learning/` (đang đọc) | **Tại sao?** — vì sao thiết kế như vậy, sai thì hỏng ở đâu |

## Tiến độ

| Giai đoạn | Nội dung | Trạng thái | Ghi chú |
|-----------|----------|-----------|---------|
| 1 | NestJS + MySQL (Docker) ở local | ✅ Xong | [01-nestjs-va-nen-mong.md](01-nestjs-va-nen-mong.md) |
| 2 | S3 + IAM — upload file lên AWS thật | ✅ Xong | [02-s3-va-iam.md](02-s3-va-iam.md) |
| 3 | Deploy lên EC2 + PM2 + IAM Role | ✅ Xong | [03-ec2-va-iam-role.md](03-ec2-va-iam-role.md) |
| 4 | Nginx reverse proxy | ✅ Xong | [04-nginx-reverse-proxy.md](04-nginx-reverse-proxy.md) |
| 5 | Domain + HTTPS (Certbot) | ✅ Xong | [05-domain-https.md](05-domain-https.md) |
| 6 | Chuyển sang RDS MySQL | ✅ Xong | [06-rds-mysql.md](06-rds-mysql.md) |

## Mục lục

1. [Kiến trúc tổng quan](00-kien-truc-tong-quan.md) — bức tranh lớn và một luận điểm xuyên suốt
2. [Giai đoạn 1 — NestJS và nền móng](01-nestjs-va-nen-mong.md) — kiến trúc tầng, config, envelope, migration
3. [Giai đoạn 2 — S3 và IAM](02-s3-va-iam.md) — quyền trên AWS, luồng upload, bảo mật file
4. [Giai đoạn 3 — EC2 và IAM Role](03-ec2-va-iam-role.md) — danh tính không cần mật khẩu, RAM, mạng, vận hành
5. [Giai đoạn 4 — Nginx Reverse Proxy](04-nginx-reverse-proxy.md) — reverse proxy, keepalive, trust proxy, SSL termination
6. [Giai đoạn 5 — Domain + HTTPS](05-domain-https.md) — DNS, Certbot, auto-renew, CORS, HSTS
7. [Giai đoạn 6 — RDS MySQL](06-rds-mysql.md) — managed DB, SG reference, least privilege, SSL, migration
8. [Nhật ký lỗi đã gặp](90-nhat-ky-loi.md) — lỗi thật, nguyên nhân thật, cách đọc lỗi
9. [Cheatsheet](91-cheatsheet.md) — lệnh hay dùng, tra nhanh

> Số 00–06 dành cho các giai đoạn, 90+ dành cho tài liệu tra cứu dùng chung.

## Cách dùng sổ tay này

Mỗi file có mục **"Tự kiểm tra"** ở cuối. Nếu trả lời được không cần mở lại tài liệu
thì coi như đã nắm; chưa trả lời được thì phần tương ứng ở trên đáng đọc lại.

---

## Bốn điều quan trọng nhất tính đến giờ

Nếu chỉ nhớ được bốn điều từ giai đoạn 1 → 3, hãy nhớ bốn điều này:

**1. Cấu hình là ranh giới giữa môi trường, không phải code.**
Cùng một file `.js` chạy được ở laptop và trên EC2. Cái đổi là `.env`. Mọi thứ khiến
code phải `if (isProduction)` đều là dấu hiệu thiết kế sai chỗ nào đó.

**2. Trên AWS, quyền đến từ hai phía và phục vụ hai luồng khác nhau.**
IAM policy gắn vào *identity* — trả lời "user/role này được làm gì?". Bucket policy gắn vào
*resource* — trả lời "bucket này cho ai vào?". App upload file đi bằng đường thứ nhất;
trình duyệt ẩn danh xem ảnh đi bằng đường thứ hai. Không phân biệt được hai đường này là
nguyên nhân của hầu hết lỗi 403 khi mới học AWS.

**3. Không tin dữ liệu client gửi lên.**
Tên file, `Content-Type`, kích thước khai báo — tất cả đều do client tự đặt và sửa được.
Chỉ tin thứ tự kiểm chứng được: magic bytes trong nội dung file, giới hạn do server áp.

**4. Secret không xoay vòng là secret sẽ rò rỉ — chỉ là vấn đề thời gian.**
Cách chống bền vững không phải giữ kín hơn, mà là rút ngắn thời gian sống của nó. IAM Role
làm đúng điều đó: EC2 mượn danh tính qua STS, nhận credential hết hạn sau vài giờ và tự làm
mới. Có cơ chế danh tính do nền tảng cấp thì đừng dùng secret tĩnh — GitHub Actions có OIDC,
Kubernetes có ServiceAccount, cùng một ý tưởng.

---

## Điều thứ năm (sau giai đoạn 4)

**5. Application server không nên lo infrastructure concerns.**
NestJS xử lý business logic; Nginx lo TLS, compression, rate limit, buffering, logging.
Tách biệt này cho phép:
- Scale Nginx và NestJS độc lập
- Swap Nginx bằng ALB/Traefik/Caddy không đổi code NestJS
- Security patch ở layer infra không đụng business logic

Đây là pattern **Reverse Proxy** — kiến trúc chuẩn cho mọi production web service.
