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

Mục tiêu: máy local upload được file lên S3 thật.

```
Local Node.js ──▶ S3
```

Giai đoạn này dùng **IAM User + access key** vì code chạy ngoài AWS. Từ giai đoạn 3
(code chạy trên EC2) sẽ thay bằng IAM Role và xoá hẳn access key này.

### 2.1 Tạo bucket (Console)

S3 → **Create bucket**

| Mục | Giá trị |
|-----|---------|
| Bucket type | General purpose |
| Bucket name | duy nhất toàn cầu, ví dụ `aws-deployment-api-<tên>-01` |
| Region | Asia Pacific (Sydney) `ap-southeast-2` — mọi tài nguyên sau này phải cùng region |
| Object Ownership | ACLs disabled (mặc định) |
| Bucket Versioning | Disable |
| Encryption | SSE-S3 (mặc định) |

Phần **Block Public Access** — đây là chỗ dễ sai nhất. Bỏ tick "Block *all* public access",
rồi chỉnh lại để **chỉ mở đường policy, vẫn chặn đường ACL**:

| Tuỳ chọn | Trạng thái |
|----------|-----------|
| Block public access ... through **new ACLs** | ✅ giữ tick |
| Block public access ... through **any ACLs** | ✅ giữ tick |
| Block public access ... through **new public bucket policies** | ⬜ bỏ tick |
| Block public and cross-account access ... through **any public bucket policies** | ⬜ bỏ tick |

Console sẽ bắt tick xác nhận. Ý nghĩa: object chỉ public khi **bucket policy** cho phép,
không ai public được bằng ACL trên từng file.

### 2.2 Bucket policy — mở đọc cho `users/*`

Bucket → tab **Permissions** → **Bucket policy** → Edit → dán nội dung
`deploy/aws/s3-bucket-policy-public-read.json`, thay `REPLACE_WITH_YOUR_BUCKET` bằng tên bucket thật.

Policy này chỉ mở `s3:GetObject` cho prefix `users/*` — không mở toàn bucket, không mở quyền ghi.

### 2.3 Tạo IAM User cho máy local

IAM → **Users** → **Create user**

1. User name: `aws-deployment-api-local`
2. **Không** tick "Provide user access to the AWS Management Console" — user này chỉ dùng cho code
3. Permissions options → **Attach policies directly** → **Create policy** → tab **JSON**
4. Dán nội dung `deploy/aws/s3-iam-policy.json`, thay `REPLACE_WITH_YOUR_BUCKET`
5. Đặt tên policy: `aws-deployment-api-s3-avatars` → Create
6. Quay lại tab tạo user, refresh danh sách policy, chọn policy vừa tạo → Create user

Policy cho đúng 3 quyền `PutObject` / `GetObject` / `DeleteObject`, giới hạn trong `users/*`.
Không có `s3:ListBucket`, không có quyền trên bucket khác.

### 2.4 Tạo access key

User vừa tạo → tab **Security credentials** → **Create access key**

- Use case: **Application running outside AWS**
- Secret access key chỉ hiện **một lần duy nhất** — copy ngay hoặc tải file `.csv`

### 2.5 Điền vào `.env`

```env
AWS_REGION=ap-southeast-2
S3_BUCKET=<tên bucket của bạn>
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...

# Để trống — chỉ dùng khi test bằng MinIO/LocalStack
S3_ENDPOINT=
# Để trống — app tự suy ra https://<bucket>.s3.<region>.amazonaws.com
S3_PUBLIC_URL=
```

> `.env` đã nằm trong `.gitignore`. Kiểm tra lại bằng `git check-ignore -v .env` trước khi commit.

### Kiểm tra

```bash
docker compose up -d mysql
npm run start:dev

curl -X POST http://localhost:3000/users \
  -H 'Content-Type: application/json' \
  -d '{"name":"Nguyen Van A","email":"a@example.com"}'

curl -X POST http://localhost:3000/users/1/avatar -F 'avatar=@./avatar.jpg'
```

Đạt khi cả hai điều sau đúng:

1. Response trả về `avatarUrl` dạng `https://<bucket>.s3.ap-southeast-2.amazonaws.com/users/1/avatar.jpg`
2. Mở URL đó trên trình duyệt (cửa sổ ẩn danh) xem được ảnh

Nếu (1) đúng mà (2) trả 403 → upload đã chạy được, chỉ thiếu bucket policy ở bước 2.2.

### Tương đương bằng CLI

```bash
aws s3api create-bucket --bucket <BUCKET> --region ap-southeast-2 \
  --create-bucket-configuration LocationConstraint=ap-southeast-2

aws s3api put-public-access-block --bucket <BUCKET> \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false"

aws s3api put-bucket-policy --bucket <BUCKET> \
  --policy file://deploy/aws/s3-bucket-policy-public-read.json
```

---

## Giai đoạn 3 — Deploy lên EC2

Mục tiêu: app chạy trên EC2 và upload được lên S3 **mà không có access key nào trên đĩa**.

```
Internet ──▶ EC2 (Elastic IP)
              ├── NestJS :3000  (PM2)
              └── MySQL  :3306  (Docker, chỉ bind loopback)
                      │
                      └── IAM Role ──▶ S3
```

RDS tận giai đoạn 6 mới có, nhưng `DB_RUN_MIGRATIONS=true` khiến TypeORM kết nối DB ngay
lúc bootstrap — không có MySQL thì app không khởi động nổi. Nên giai đoạn 3 chạy MySQL
bằng Docker ngay trên EC2, giai đoạn 6 chỉ việc đổi `.env` trỏ sang RDS.

### 3.1 IAM Role — làm trước khi tạo EC2

IAM → **Roles** → **Create role**

1. Trusted entity type: **AWS service** → Use case: **EC2**
2. Permissions: chọn lại đúng policy `aws-deployment-api-s3-avatars` đã tạo ở giai đoạn 2 —
   **không cần sửa gì**, cùng 3 action, cùng prefix `users/*`
3. Role name: `aws-deployment-api-ec2`

Console tự sinh **trust policy** — nội dung đúng bằng `deploy/aws/ec2-trust-policy.json`.
Đây là loại policy thứ ba, khác cả hai loại ở giai đoạn 2: nó gắn vào chính Role và trả lời
"*ai* được phép mượn danh tính này?". `Principal` ở đây là một **service** chứ không phải người:

```json
"Principal": { "Service": "ec2.amazonaws.com" },
"Action": "sts:AssumeRole"
```

Thiếu trust policy thì Role tồn tại nhưng EC2 không mượn được — permission policy đúng cũng vô nghĩa.

### 3.2 Tạo EC2

EC2 → Launch instance. **Kiểm tra region ở góc trên phải là `ap-southeast-2`** — phải cùng
region với bucket, khác region là trả thêm phí data transfer cho mỗi lần upload.

| Mục | Giá trị |
|-----|---------|
| AMI | Ubuntu Server 24.04 LTS |
| Instance type | t3.micro |
| Key pair | tạo mới, tải file `.pem` về, `chmod 400` |
| Advanced details → **IAM instance profile** | `aws-deployment-api-ec2` ← đừng bỏ sót |

Security Group inbound:

| Port | Source | Mục đích |
|------|--------|----------|
| 22   | IP của bạn | SSH |
| 80   | 0.0.0.0/0 | HTTP (giai đoạn 4) |
| 443  | 0.0.0.0/0 | HTTPS (giai đoạn 5) |

> **Không** mở 3000 và 3306. Node chỉ nhận traffic qua Nginx, MySQL chỉ nghe trên loopback.

Xong thì gán **Elastic IP** để IP không đổi sau mỗi lần stop/start.

```bash
ssh -i your-key.pem ubuntu@<ELASTIC_IP>
```

### 3.3 Swap 2GB — làm trước khi build

t3.micro chỉ có 1GB RAM. `npm run build` (tsc) đỉnh điểm ~400MB, cộng MySQL ~400MB là chạm trần.
Không có swap thì kernel OOM-kill giữa chừng, và thông báo lỗi thường rất khó hiểu.

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab   # giữ sau reboot
free -h
```

### 3.4 Cài Node, PM2, Docker

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git docker.io docker-compose-v2
sudo npm install -g pm2

sudo usermod -aG docker ubuntu
newgrp docker            # hoặc thoát SSH rồi vào lại
```

> Đừng `export NODE_ENV=production` trong shell. npm coi đó là `--omit=dev`, bỏ luôn
> `ts-node` — mà `npm run migration:run` cần nó (`package.json:22`). App vẫn nhận
> `NODE_ENV=production` qua `.env` và `ecosystem.config.js:11`, không cần export.

### 3.5 Deploy key và clone repo

Repo private nên cần deploy key. Tạo key **trên EC2**:

```bash
ssh-keygen -t ed25519 -C "ec2-aws-deployment-api" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

GitHub → repo → **Settings** → **Deploy keys** → **Add deploy key** → dán public key.
**Không** tick "Allow write access" — EC2 chỉ cần đọc.

```bash
ssh -T git@github.com    # xác nhận fingerprint, hiện "successfully authenticated"

git clone git@github.com:vnt04/aws-deployment-api.git
cd aws-deployment-api
```

> Đường dẫn phải đúng `/home/ubuntu/aws-deployment-api` — `ecosystem.config.js:6` và
> `deploy/deploy.sh:5` đều hardcode nó.

### 3.6 `.env` trên EC2

```bash
cp .env.example .env && nano .env
```

```env
NODE_ENV=production
PORT=3000
CORS_ORIGINS=*                    # siết về domain thật ở giai đoạn 5

DB_HOST=127.0.0.1
DB_PORT=3306                      # local là 3307, trên EC2 là 3306
DB_USERNAME=root
DB_PASSWORD=<mật khẩu mạnh>
DB_NAME=aws_deployment
DB_SSL=false                      # bật ở giai đoạn 6 khi sang RDS
DB_SYNCHRONIZE=false
DB_RUN_MIGRATIONS=true

AWS_REGION=ap-southeast-2
S3_BUCKET=<tên bucket của bạn>
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_ENDPOINT=
S3_PUBLIC_URL=
```

Hai dòng key **để trống là có chủ đích**, không phải quên điền. `storage.module.ts:22-30`
chỉ truyền `credentials` khi cả hai có giá trị; để trống là ra lệnh cho SDK đi tiếp xuống
instance metadata.

### 3.7 MySQL bằng Docker Compose

```bash
docker compose up -d mysql        # chỉ service mysql, KHÔNG up service api
docker compose ps
```

App chạy trực tiếp bằng PM2 trên host nên không dùng service `api` trong compose.
Compose đọc `.env` để lấy `DB_NAME` / `DB_PASSWORD` / `DB_PORT`, nên phải sửa `.env` **trước** khi up.

> `MYSQL_ROOT_PASSWORD` chỉ có tác dụng lần đầu tạo volume. Đổi `DB_PASSWORD` sau đó mà
> muốn có hiệu lực thì phải `docker compose down -v` — và mất sạch dữ liệu.

### 3.8 Build và chạy

```bash
npm ci
npm run build
mkdir -p logs
pm2 start ecosystem.config.js
pm2 save
pm2 startup      # chạy tiếp lệnh mà PM2 in ra để tự khởi động sau reboot
```

### Kiểm tra

```bash
curl http://127.0.0.1:3000/health          # process sống
curl http://127.0.0.1:3000/health/ready    # chạy SELECT 1 xuống MySQL container

curl -X POST http://127.0.0.1:3000/users \
  -H 'Content-Type: application/json' \
  -d '{"name":"EC2 Test","email":"ec2@example.com"}'

curl -X POST http://127.0.0.1:3000/users/1/avatar -F 'avatar=@./avatar.jpg'
```

Đạt khi upload trả về `avatarUrl` **trong lúc `.env` không chứa access key nào**. Đó là bằng
chứng credential đến từ IAM Role. Xem tận mắt:

```bash
TOKEN=$(curl -sX PUT http://169.254.169.254/latest/api/token \
  -H 'X-aws-ec2-metadata-token-ttl-seconds: 21600')

ROLE=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/iam/security-credentials/)
echo "Role: $ROLE"

curl -s -H "X-aws-ec2-metadata-token: $TOKEN" \
  "http://169.254.169.254/latest/meta-data/iam/security-credentials/$ROLE" | python3 -m json.tool
```

Credential trả về có `AccessKeyId` bắt đầu bằng `ASIA` (tạm thời, từ STS) chứ không phải
`AKIA` (vĩnh viễn, của IAM User), kèm `Token` và `Expiration` — SDK tự lấy bản mới trước khi hết hạn.

> IMDS trả về **không có ký tự xuống dòng** nên kết quả dính liền vào prompt — dễ tưởng là rỗng.
> Token cũng hết hạn đúng theo TTL đã xin; hết hạn thì IMDS trả `401` với body rỗng, và `curl -s`
> không hiện gì cả. Kiểm tra bằng `curl -s -o /dev/null -w '%{http_code}\n' ...`.

| Triệu chứng | Nguyên nhân |
|---|---|
| Metadata trả rỗng | quên gắn IAM instance profile lúc launch — gắn sau rồi `pm2 restart` |
| Upload 500, log `AccessDenied` | Role thiếu policy, hoặc sai `S3_BUCKET` / `AWS_REGION` |
| Upload 500, log `CredentialsProviderError` | `.env` còn sót key sai — xoá hẳn giá trị |
| `/health/ready` trả 503 | container mysql chưa up, hoặc `DB_PORT` trong `.env` không phải 3306 |

### 3.9 Xoá access key của giai đoạn 2

Chỉ làm **sau khi** upload từ EC2 đã chạy: IAM → user `aws-deployment-api-local` →
Security credentials → **Deactivate** → **Delete**.

Từ đây máy local không upload lên S3 thật được nữa — đúng như thiết kế. Muốn dev local tiếp
thì chạy MinIO và set `S3_ENDPOINT=http://127.0.0.1:9000`; `storage.module.ts:32` đã có sẵn
nhánh `forcePathStyle` cho việc đó.

### Các lần deploy sau

```bash
./deploy/deploy.sh
```

Script `git reset --hard origin/main` nhưng `.env`, `logs/`, `dist/` đều nằm trong
`.gitignore` nên không bị xoá.

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
DB_HOST=aws-deployment.abcdefg.ap-southeast-2.rds.amazonaws.com
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
