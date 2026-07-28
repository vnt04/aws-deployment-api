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

## Trên EC2 (giai đoạn 3)

```bash
ssh -i your-key.pem ubuntu@<ELASTIC_IP>
```

### PM2

```bash
pm2 status                                    # tiến trình nào đang chạy
pm2 logs aws-deployment-api --lines 100       # log gần nhất
pm2 logs --err                                # chỉ stderr
pm2 reload aws-deployment-api --update-env    # nạp lại .env, không downtime
pm2 restart aws-deployment-api                # có downtime, dùng khi reload không ăn
pm2 monit                                     # CPU/RAM theo thời gian thực
pm2 save                                      # ghi lại danh sách sau khi đổi
```

> `reload` chỉ không downtime khi `exec_mode: 'cluster'`. Xem
> [03-ec2-va-iam-role.md § PM2](03-ec2-va-iam-role.md#pm2-instances).

### Kiểm tra IAM Role

```bash
TOKEN=$(curl -sX PUT http://169.254.169.254/latest/api/token \
  -H 'X-aws-ec2-metadata-token-ttl-seconds: 21600')

ROLE=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/iam/security-credentials/)
echo "Role: $ROLE"

curl -s -H "X-aws-ec2-metadata-token: $TOKEN" \
  "http://169.254.169.254/latest/meta-data/iam/security-credentials/$ROLE" | python3 -m json.tool
```

`AccessKeyId` bắt đầu bằng `ASIA` = credential tạm thời từ Role. `AKIA` = key vĩnh viễn của
IAM User. Kết quả rỗng thì kiểm tra HTTP status trước khi kết luận:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/iam/security-credentials/
# 401 = token hết hạn   |   200 = ổn
```

### Tài nguyên máy

```bash
free -h                           # RAM và swap
df -h                             # dung lượng đĩa
htop                              # tiến trình (apt install htop)
dmesg | grep -i 'killed process'  # kiểm tra OOM killer có ra tay không
sudo swapon --show                # swap đang bật
```

### MySQL trong Docker

```bash
docker compose ps
docker compose logs -f mysql
docker compose exec mysql mysql -uroot -p aws_deployment    # vào shell SQL
docker compose restart mysql
```

### Deploy

```bash
./deploy/deploy.sh                # pull → npm ci → build → migration → reload → health check
BRANCH=feature/x ./deploy/deploy.sh
```

Ba điểm dễ sai:

1. **Đừng `export NODE_ENV=production`** trong shell — npm sẽ bỏ `devDependencies`, mất
   `ts-node` và `migration:run` chết. App vẫn nhận biến này qua `.env` và `ecosystem.config.js`.
2. **Đừng sửa code trực tiếp trên server** — `deploy.sh` chạy `git reset --hard`, thay đổi
   local sẽ bị xoá không cảnh báo.
3. **`pm2 save` sau mỗi lần đổi danh sách tiến trình**, nếu không reboot sẽ khôi phục về trạng
   thái cũ.

---

## Giai đoạn 4 sắp tới — chuẩn bị gì

```bash
sudo apt-get install -y nginx
sudo nginx -t                     # kiểm tra cú pháp TRƯỚC khi reload
sudo systemctl reload nginx
sudo tail -f /var/log/nginx/api.error.log
```

Điểm đã biết trước sẽ vấp: `client_max_body_size` mặc định của Nginx là **1MB**, nhỏ hơn giới
hạn 5MB của app. `deploy/nginx/api.conf:12` đã đặt sẵn `6M` — nhưng nếu quên thì file 3MB bị
chặn bằng `413` **trước khi tới Node**, và log của Node sẽ hoàn toàn trống.
