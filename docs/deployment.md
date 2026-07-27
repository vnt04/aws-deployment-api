# Lộ trình deploy lên AWS

Tài liệu này đi theo đúng 6 giai đoạn trong plan. Mỗi giai đoạn đều có phần **Kiểm tra** —
làm xong mới sang bước tiếp theo.

Kiến trúc đích:

```
                        User
                          │
                          ▼
                   api.yourdomain.com
                          │
                          ▼
                         DNS
                          │
                          ▼
                     Elastic IP
                          │
              ┌───────────┴─────────┐
              │        EC2          │
              │   Nginx  :80/:443   │
              │         │           │
              │   NestJS :3000      │
              │      (PM2)          │
              └──────────┬──────────┘
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
          RDS MySQL                S3
          User Data              Avatar Files
```

---

## Giai đoạn 1 — Code local (NestJS + MySQL Docker)

```bash
cp .env.example .env
docker compose up -d mysql
npm ci
npm run start:dev
```

Migration tự chạy khi app khởi động (`DB_RUN_MIGRATIONS=true`). Chạy tay khi cần:

```bash
npm run migration:run
```

### Kiểm tra

```bash
curl -X POST http://localhost:3000/users \
  -H 'Content-Type: application/json' \
  -d '{"name":"Nguyen Van A","email":"a@example.com"}'

curl http://localhost:3000/users
curl http://localhost:3000/health/ready
```

---

## Giai đoạn 2 — S3 + IAM

### 2.1 Tạo bucket

```bash
aws s3api create-bucket \
  --bucket my-aws-deployment-bucket \
  --region ap-southeast-1 \
  --create-bucket-configuration LocationConstraint=ap-southeast-1
```

Avatar cần đọc được công khai, nên phải tắt 2 cờ chặn public policy:

```bash
aws s3api put-public-access-block \
  --bucket my-aws-deployment-bucket \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false"

aws s3api put-bucket-policy \
  --bucket my-aws-deployment-bucket \
  --policy file://deploy/aws/s3-bucket-policy-public-read.json
```

> Nhớ thay `REPLACE_WITH_YOUR_BUCKET` trong file policy trước khi chạy.
> Policy chỉ mở đọc cho prefix `users/*`, không mở toàn bucket.

### 2.2 Test từ máy local bằng IAM User

Giai đoạn này dùng access key để chạy nhanh. Tạo IAM User (không cần console access),
gắn policy inline từ `deploy/aws/s3-iam-policy.json`, rồi điền vào `.env`:

```env
AWS_REGION=ap-southeast-1
S3_BUCKET=my-aws-deployment-bucket
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
```

### Kiểm tra

```bash
curl -X POST http://localhost:3000/users/1/avatar -F 'avatar=@./avatar.jpg'
```

Response phải trả về `avatarUrl`, và mở URL đó trên trình duyệt phải xem được ảnh.

---

## Giai đoạn 3 — Deploy lên EC2

### 3.1 Tạo EC2

- AMI: Ubuntu 22.04 / 24.04 LTS
- Type: t3.micro (đủ cho môi trường học)
- Security Group inbound:

| Port | Source | Mục đích |
|------|--------|----------|
| 22   | IP của bạn | SSH |
| 80   | 0.0.0.0/0 | HTTP |
| 443  | 0.0.0.0/0 | HTTPS |

> **Không** mở port 3000 ra ngoài. Node chỉ nhận traffic qua Nginx.

Gán **Elastic IP** cho instance để IP không đổi sau mỗi lần restart.

### 3.2 IAM Role thay cho access key

Đây là điểm quan trọng nhất của giai đoạn này:

1. Tạo IAM Role, trusted entity = **EC2**
2. Gắn policy từ `deploy/aws/s3-iam-policy.json`
3. Attach role vào EC2 instance
4. Trên EC2, **để trống** `AWS_ACCESS_KEY_ID` và `AWS_SECRET_ACCESS_KEY` trong `.env`

AWS SDK sẽ tự lấy credential tạm thời từ instance metadata. Không còn secret nào nằm trên đĩa.

### 3.3 Cài môi trường

```bash
ssh -i your-key.pem ubuntu@<ELASTIC_IP>

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
sudo npm install -g pm2

git clone https://github.com/<user>/aws-deployment-api.git
cd aws-deployment-api
cp .env.example .env   # sửa lại giá trị thật
npm ci
npm run build
mkdir -p logs
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # chạy tiếp lệnh mà PM2 in ra để tự khởi động sau reboot
```

### Kiểm tra

```bash
curl http://127.0.0.1:3000/health      # trên EC2
```

Các lần deploy sau chỉ cần:

```bash
./deploy/deploy.sh
```

---

## Giai đoạn 4 — Nginx reverse proxy

```bash
sudo apt-get install -y nginx
sudo cp deploy/nginx/api.conf /etc/nginx/sites-available/api.conf
sudo ln -s /etc/nginx/sites-available/api.conf /etc/nginx/sites-enabled/api.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

Sửa `server_name` trong file config thành domain thật của bạn.

### Kiểm tra

```bash
curl http://<ELASTIC_IP>/health
```

---

## Giai đoạn 5 — Domain + HTTPS

### 5.1 DNS

Tạo bản ghi A tại nhà cung cấp domain (hoặc Route 53):

```
api.yourdomain.com   A   <ELASTIC_IP>
```

Chờ DNS propagate rồi kiểm tra:

```bash
dig +short api.yourdomain.com
```

### 5.2 Certificate

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.yourdomain.com
```

Certbot tự thêm block `listen 443 ssl` và chuyển port 80 thành redirect. Cron gia hạn
cũng được cài sẵn — kiểm tra bằng `sudo certbot renew --dry-run`.

Siết CORS lại sau khi có domain:

```env
CORS_ORIGINS=https://yourdomain.com
```

### Kiểm tra

```bash
curl https://api.yourdomain.com/health
```

---

## Giai đoạn 6 — Chuyển sang RDS MySQL

Đây là phần chứng minh luận điểm chính của plan: **code không đổi, chỉ đổi biến môi trường.**

### 6.1 Tạo RDS

- Engine: MySQL 8
- Class: db.t4g.micro
- **Public access: No** — chỉ EC2 được gọi vào
- Security Group của RDS: inbound port 3306, source = Security Group của EC2
  (chọn security group chứ đừng nhập IP — EC2 đổi IP vẫn chạy)

### 6.2 Tạo database và user riêng cho app

Từ EC2:

```bash
mysql -h <rds-endpoint> -u admin -p
```

```sql
CREATE DATABASE aws_deployment CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'app'@'%' IDENTIFIED BY '<mật khẩu mạnh>';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES
  ON aws_deployment.* TO 'app'@'%';
FLUSH PRIVILEGES;
```

> App cần quyền DDL vì migration tự chạy lúc khởi động. Nếu muốn siết chặt hơn, bỏ
> `DB_RUN_MIGRATIONS` và chạy `npm run migration:run` bằng tài khoản admin riêng.

### 6.3 Đổi `.env` trên EC2

```env
DB_HOST=aws-deployment.abcdefg.ap-southeast-1.rds.amazonaws.com
DB_PORT=3306
DB_USERNAME=app
DB_PASSWORD=<mật khẩu mạnh>
DB_NAME=aws_deployment
DB_SSL=true
```

```bash
npm run migration:run
pm2 reload aws-deployment-api --update-env
```

### Kiểm tra

```bash
curl https://api.yourdomain.com/health/ready
```

Endpoint này thật sự chạy `SELECT 1` xuống RDS — trả `200` nghĩa là app đã nói chuyện được
với database mới.

---

## Checklist bảo mật trước khi coi là xong

- [ ] Port 3000 và 3306 **không** mở ra Internet trong Security Group
- [ ] EC2 dùng IAM Role, `.env` trên server không chứa access key
- [ ] `.env` không nằm trong git (đã có trong `.gitignore`)
- [ ] `DB_SYNCHRONIZE=false` trên production
- [ ] `CORS_ORIGINS` đã siết về domain thật, không còn `*`
- [ ] RDS bật `DB_SSL=true`
- [ ] Bucket policy chỉ mở đọc `users/*`, không mở ghi
- [ ] Đã bật automated backup cho RDS

---

## Xử lý sự cố

| Triệu chứng | Nguyên nhân thường gặp |
|-------------|------------------------|
| `502 Bad Gateway` | Node chưa chạy — kiểm tra `pm2 status`, `pm2 logs` |
| `413 Request Entity Too Large` | `client_max_body_size` trong Nginx nhỏ hơn file upload |
| Upload trả 500 | IAM Role thiếu `s3:PutObject`, hoặc sai `S3_BUCKET` / `AWS_REGION` |
| Ảnh trả về 403 khi mở URL | Chưa apply bucket policy public-read cho `users/*` |
| App không kết nối được RDS | Security Group của RDS chưa cho phép SG của EC2 |
| `ER_NOT_SUPPORTED_AUTH_MODE` | User MySQL dùng plugin auth cũ — tạo lại user trên MySQL 8 |
