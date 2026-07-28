# Cheatsheet

Lệnh hay dùng, tra nhanh. Đã đối chiếu với `package.json` và cấu hình thật của project.

---

## Chạy project

```bash
docker compose up -d mysql        # chỉ MySQL, Node chạy ở host
npm run start:dev                 # watch mode
npm run start:prod                # chạy bản đã build (node dist/main.js)

docker compose up -d --build      # cả API lẫn MySQL trong Docker
docker compose logs -f api        # xem log
docker compose down               # dừng (thêm -v để xoá luôn dữ liệu MySQL)
```

## Test và chất lượng code

```bash
npm test                          # unit test
npm run test:watch                # watch mode
npm run test:cov                  # kèm coverage (ngưỡng 80%)
npm run test:e2e                  # HTTP end-to-end, không cần MySQL/AWS
npm run lint                      # eslint --fix
npm run format                    # prettier
```

## Migration

```bash
npm run migration:run
npm run migration:revert
npm run migration:generate -- src/database/migrations/TenMigration
```

> `DB_RUN_MIGRATIONS=true` nên migration tự chạy lúc app khởi động. Các lệnh trên dùng khi
> cần chạy tay hoặc rollback.

---

## Gọi API

```bash
BASE=http://localhost:3000

# Tạo user
curl -X POST $BASE/users \
  -H 'Content-Type: application/json' \
  -d '{"name":"Nguyen Van A","email":"a@example.com"}'

# Danh sách (phân trang)
curl "$BASE/users?page=1&limit=20"

# Chi tiết / sửa / xoá
curl $BASE/users/1
curl -X PATCH $BASE/users/1 -H 'Content-Type: application/json' -d '{"name":"Ten Moi"}'
curl -X DELETE $BASE/users/1

# Upload avatar  ← nhớ cd vào thư mục có avatar.jpg
curl -X POST $BASE/users/1/avatar -F "avatar=@./avatar.jpg"

# Health
curl $BASE/health              # liveness — không chạm DB
curl $BASE/health/ready        # readiness — chạy SELECT 1
```

Thêm `-i` để xem cả header và HTTP status, `-v` để xem toàn bộ quá trình:

```bash
curl -i -X POST $BASE/users/1/avatar -F "avatar=@./avatar.jpg"
```

### Tạo ảnh test

```bash
python3 -c "
from PIL import Image
Image.new('RGB', (256, 256), (60, 110, 220)).save('avatar.jpg', 'JPEG')
"
```

---

## AWS CLI — S3

```bash
aws sts get-caller-identity                    # đang dùng credential của ai?

aws s3 cp avatar.jpg s3://$BUCKET/users/1/avatar.jpg
aws s3api head-object --bucket $BUCKET --key users/1/avatar.jpg
aws s3api get-bucket-policy --bucket $BUCKET
aws s3api get-public-access-block --bucket $BUCKET
```

> `aws s3 ls s3://$BUCKET` sẽ báo **AccessDenied** — đúng như thiết kế. IAM policy của
> project cố tình không cấp `s3:ListBucket`. Xem
> [02-s3-va-iam.md § Least privilege](02-s3-va-iam.md#6-least-privilege-trong-thực-tế).

---

## Kiểm tra bảo mật nhanh

```bash
git check-ignore -v .env          # phải in ra dòng .gitignore khớp
git status --short                # .env KHÔNG được xuất hiện

# Tìm access key lỡ commit trong toàn bộ lịch sử
git log -p --all -S 'AKIA' | head
```

Nếu lỡ commit access key: **vô hiệu hoá key trên AWS Console trước**, tạo key mới, rồi mới
tính chuyện dọn git history. Xem [02-s3-va-iam.md § Secret không bao giờ vào git](02-s3-va-iam.md#14-secret-không-bao-giờ-vào-git).

---

## Bảng tra nhanh

### Exit code của curl (lỗi phía client — request chưa gửi đi)

| Code | Nghĩa | Thường do |
|------|-------|-----------|
| 6 | Couldn't resolve host | sai domain, DNS chưa propagate |
| 7 | Failed to connect | server chưa chạy, sai port, Security Group chặn |
| 26 | Failed to open local file | file không tồn tại, sai đường dẫn, lỗi nháy đơn trên Windows |
| 60 | SSL certificate problem | certificate chưa hợp lệ |

### HTTP status hay gặp (server đã trả lời)

| Status | Ở đây nghĩa là | Xem ở đâu |
|--------|----------------|-----------|
| 400 | thiếu file, sai định dạng ảnh | `users.service.ts` `updateAvatar` |
| 404 | không tìm thấy user | `getExistingUser` |
| 409 | email trùng | `assertEmailAvailable` / unique index |
| 413 | file lớn hơn giới hạn | multer 5MB, hoặc Nginx `client_max_body_size` (giai đoạn 4) |
| 429 | vượt rate limit | `ThrottlerGuard`, mặc định 100 req/phút |
| 500 | lỗi ngoài dự kiến | **đọc log server**, response cố tình không nói chi tiết |
| 502 | Node chưa chạy | `pm2 status`, `pm2 logs` (giai đoạn 4) |

### Biến môi trường đổi khi lên AWS

| Biến | Local | AWS |
|------|-------|-----|
| `DB_HOST` | `127.0.0.1` | endpoint RDS |
| `DB_SSL` | `false` | `true` |
| `DB_SYNCHRONIZE` | `false` | `false` (luôn luôn) |
| `AWS_ACCESS_KEY_ID` | access key IAM User | **để trống** → dùng IAM Role |
| `AWS_SECRET_ACCESS_KEY` | secret key | **để trống** |
| `CORS_ORIGINS` | `*` | domain thật |

### Định dạng ảnh được chấp nhận

| Định dạng | Magic bytes | Đuôi file server đặt |
|-----------|-------------|----------------------|
| JPEG | `FF D8 FF` | `.jpg` |
| PNG | `89 50 4E 47 0D 0A 1A 0A` | `.png` |
| WEBP | `52 49 46 46` + `57 45 42 50` ở offset 8 | `.webp` |

Xem bằng: `xxd -l 16 avatar.jpg`

---

## Giai đoạn 3 sắp tới — chuẩn bị gì

```bash
ssh -i your-key.pem ubuntu@<ELASTIC_IP>

pm2 start ecosystem.config.js
pm2 status / pm2 logs / pm2 reload aws-deployment-api --update-env
pm2 save && pm2 startup

./deploy/deploy.sh                # các lần deploy sau
```

Ba điểm dễ sai đã biết trước:

1. **Không mở port 3000** ra Internet trong Security Group — chỉ 22 / 80 / 443
2. Trên EC2 phải **để trống** `AWS_ACCESS_KEY_ID` và `AWS_SECRET_ACCESS_KEY` để SDK dùng IAM Role
3. Xong giai đoạn 3 thì **xoá access key của IAM User `aws-deployment-api-local`** —
   nó không còn cần thiết
