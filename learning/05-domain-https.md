# Giai đoạn 5 — Domain + HTTPS (Certbot)

> Mục tiêu giai đoạn: Có domain thật, HTTPS với certificate tự động gia hạn, redirect HTTP→HTTPS, CORS chặt chẽ.

```
Internet ──▶ api.yourdomain.com (DNS A record)
              │
              ▼
         Elastic IP
              │
              ▼
         EC2: Nginx :80/:443 (SSL termination)
              │       │
              │       ▼ (proxy_pass)
              │   NestJS :3000 (PM2)
              └── MySQL :3306 (Docker)
```

---

## 1. DNS — Trỏ Domain Về Elastic IP

### Tạo A Record

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | `api` | `<ELASTIC_IP>` | 300 (hoặc Auto) |

> **Lưu ý Cloudflare**: Nếu dùng Cloudflare, tắt proxy (gray cloud) lúc đầu để test trực tiếp IP EC2. Bật proxy sau khi HTTPS chạy ổn.

### Kiểm tra DNS Propagate

```bash
dig +short api.yourdomain.com
# Phải trả về Elastic IP (ví dụ: 54.79.8.211)

# Test HTTP trước khi có SSL
curl http://api.yourdomain.com/health
# Phải trả về: {"success":true,"data":{"status":"ok"}}
```

**Lesson**: *DNS không phải tức thì*. TTL quyết định thời gian cache. Test bằng `dig` trước khi chạy Certbot.

---

## 2. Certbot — Tự Động Hóa HTTPS

### Cài đặt

```bash
sudo apt-get update
sudo apt-get install -y certbot python3-certbot-nginx
```

### Chạy Certbot

```bash
sudo certbot --nginx -d api.yourdomain.com
```

**Certbot hỏi 4 câu:**
1. **Email** — nhập email thật (nhận thông báo hết hạn)
2. **Agree Terms** — `Y`
3. **Share email with EFF** — `N` (tuỳ ý)
4. **Redirect HTTP to HTTPS** — **Chọn 2 (Redirect)** — quan trọng nhất

### Certbot tự động làm gì?

1. **Xác thực domain** qua HTTP-01 challenge (cần port 80 mở)
2. **Lấy certificate** từ Let's Encrypt (miễn phí, 90 ngày)
3. **Sửa config Nginx** (`/etc/nginx/sites-enabled/api.conf`):
   - Thêm block `server { listen 443 ssl; ... }` với `ssl_certificate`, `ssl_certificate_key`
   - Sửa block port 80 thành **redirect 301** sang HTTPS
4. **Cài cron job auto-renew** (`/etc/cron.d/certbot` hoặc systemd timer)

### Kiểm tra Certbot đã làm gì

```bash
# Xem config sau khi Certbot sửa
cat /etc/nginx/sites-enabled/api.conf

# Test config
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

**Kết quả config mong đợi:**
```nginx
# Block port 80 — chỉ redirect
server {
    listen 80;
    server_name api.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

# Block port 443 — SSL termination
server {
    listen 443 ssl;
    server_name api.yourdomain.com;
    
    ssl_certificate /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;
    
    # ... proxy_pass config giữ nguyên ...
}
```

---

## 3. Kiểm Tra HTTPS

```bash
# Test HTTPS trực tiếp
curl -i https://api.yourdomain.com/health
# Phải trả về 200 OK + JSON

# Test redirect HTTP → HTTPS
curl -I http://api.yourdomain.com/health
# Phải trả về: HTTP/1.1 301 Moved Permanently
# Location: https://api.yourdomain.com/health

# Mở trình duyệt ẩn danh: https://api.yourdomain.com/health
# Phải thấy JSON response, khóa xanh 🔒
```

---

## 4. Auto-Renew — Certificate Tự Gia Hạn

Let's Encrypt certificate hết hạn sau **90 ngày**. Certbot cài sẵn cơ chế renew tự động.

```bash
# Test dry-run (không thực sự renew, chỉ test quy trình)
sudo certbot renew --dry-run

# Xem cron job
cat /etc/cron.d/certbot
# Hoặc systemd timer
systemctl list-timers | grep certbot
```

**Cơ chế renew:**
- Chạy 2 lần/ngày (random minute)
- Chỉ renew khi còn < 30 ngày
- Nếu renew thành công → reload Nginx tự động
- Log: `/var/log/letsencrypt/letsencrypt.log`

**Lesson**: *Đừng lo certificate hết hạn*. Certbot + cron/systemd timer lo mọi thứ. Chỉ cần kiểm tra `certbot renew --dry-run` định kỳ.

---

## 5. CORS — Siết Về Domain Thật

### Vấn đề

Giai đoạn 3-4: `CORS_ORIGINS=*` — cho phép mọi origin (dev local). Production **không được dùng `*`** khi có credentials.

### Sửa `.env` trên EC2

```bash
cd /home/ubuntu/aws-deployment-api
nano .env
```

```env
# Trước
CORS_ORIGINS=*

# Sau — thay yourdomain.com bằng domain thật
CORS_ORIGINS=https://yourdomain.com

# Hoặc nhiều origin (frontend + admin)
# CORS_ORIGINS=https://app.yourdomain.com,https://admin.yourdomain.com
```

### Reload PM2 với env mới

```bash
pm2 reload aws-deployment-api --update-env
```

> `--update-env` nạp lại biến môi trường từ `.env` mà không downtime (nhờ `exec_mode: cluster`).

---

## 6. Kiểm Tra CORS

```bash
# Test preflight (OPTIONS) — browser gửi trước request thật
curl -i -X OPTIONS https://api.yourdomain.com/users \
  -H "Origin: https://yourdomain.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type"

# Phải trả về headers:
# Access-Control-Allow-Origin: https://yourdomain.com
# Access-Control-Allow-Methods: GET,POST,PATCH,DELETE,OPTIONS
# Access-Control-Allow-Headers: Content-Type,Authorization
# Access-Control-Allow-Credentials: true
# Access-Control-Max-Age: 86400
```

Test từ browser console (F12 → Console):
```javascript
fetch('https://api.yourdomain.com/health', { credentials: 'include' })
  .then(r => r.json())
  .then(console.log)
// Phải thành công, không báo CORS error
```

**Lesson**: *CORS là bảo vệ browser, không phải server*. Server phải trả đúng header, browser mới cho phép JS gọi API cross-origin.

---

## 7. (Tùy chọn) Hardening SSL

Thêm vào block `server { listen 443 ssl; }` trong `/etc/nginx/sites-enabled/api.conf`:

```nginx
# SSL Settings mạnh hơn mặc định
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
ssl_prefer_server_ciphers off;

# HSTS — bắt browser chỉ dùng HTTPS (1 năm)
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

# OCSP Stapling — giảm latency SSL handshake
ssl_stapling on;
ssl_stapling_verify on;
resolver 8.8.8.8 8.8.4.4 valid=300s;
resolver_timeout 5s;
```

Sau khi thêm:
```bash
sudo nginx -t && sudo systemctl reload nginx
```

Test SSL grade: https://www.ssllabs.com/ssltest/analyze.html?d=api.yourdomain.com
**Mục tiêu: Grade A+**

---

## 8. Troubleshooting

| Vấn đề | Nguyên nhân | Khắc phục |
|--------|-------------|-----------|
| Certbot "Connection refused" | Nginx chưa chạy hoặc SG chặn 80/443 | `systemctl status nginx`, check SG inbound 80, 443 |
| Certbot "DNS problem" | DNS chưa propagate hoặc sai A record | `dig api.yourdomain.com`, chờ DNS |
| HTTPS 502 Bad Gateway | NestJS chưa chạy | `pm2 status`, `pm2 logs` |
| Avatar URL trả `http://` | `S3_PUBLIC_URL` chưa set | Set `S3_PUBLIC_URL=https://<bucket>.s3.ap-southeast-2.amazonaws.com` |
| CORS error trên browser | `CORS_ORIGINS` sai hoặc thiếu `credentials: true` | Kiểm tra `.env`, reload PM2 |
| Certificate gần hết hạn | Cron renew fail | `sudo certbot renew --dry-run`, check `/var/log/letsencrypt/letsencrypt.log` |
| Redirect loop (too many redirects) | Nginx config sai, hoặc load balancer trước đó đã terminate SSL | Kiểm tra `X-Forwarded-Proto`, `proxy_set_header` |

---

## 9. Checklist Hoàn Thành Giai Đoạn 5

- [ ] DNS A record `api.yourdomain.com` → Elastic IP
- [ ] `dig api.yourdomain.com` trả về đúng IP
- [ ] `sudo certbot --nginx -d api.yourdomain.com` chạy thành công (chọn Redirect)
- [ ] `curl https://api.yourdomain.com/health` trả `200`
- [ ] `curl -I http://api.yourdomain.com/health` trả `301` → HTTPS
- [ ] `sudo certbot renew --dry-run` thành công
- [ ] `.env` trên EC2: `CORS_ORIGINS=https://yourdomain.com`
- [ ] `pm2 reload aws-deployment-api --update-env` chạy xong
- [ ] CORS preflight test thành công (headers đúng)
- [ ] Upload avatar qua HTTPS thành công, ảnh xem được trên browser
- [ ] (Tùy chọn) SSL Labs grade A+

---

## 10. Tự Kiểm Tra

1. **Tại sao Certbot cần port 80 mở?**
   - HTTP-01 challenge: Let's Encrypt gọi `http://api.yourdomain.com/.well-known/acme-challenge/...` để xác thực sở hữu domain.

2. **Chọn Redirect (option 2) thay vì No redirect (option 1) có khác gì?**
   - Option 1: Cả HTTP và HTTPS đều hoạt động độc lập → user có thể truy cập HTTP không bảo mật.
   - Option 2: HTTP tự động redirect 301 sang HTTPS → **buộc HTTPS**.

3. **`CORS_ORIGINS=*`-dangerous khi có credentials?**
   - Với `Access-Control-Allow-Credentials: true`, browser **bắt buộc** `Access-Control-Allow-Origin` phải là origin cụ thể (không được `*`). Dùng `*` + credentials = lỗi CORS.

4. **Certificate Let's Encrypt hết hạn 90 ngày — sao không lo?**
   - Certbot cài cron/systemd timer chạy 2 lần/ngày, tự renew trước 30 ngày, reload Nginx. Chỉ cần server online.

5. **HSTS header (`Strict-Transport-Security`) làm gì?**
   - Browser nhớ "domain này chỉ dùng HTTPS" trong `max-age` giây. Lần sau user gõ `http://...` → browser tự chuyển `https://` **trước khi request ra mạng**. Chống SSL stripping attack.

6. **OCSP Stapling là gì?**
   - Server (Nginx) cache OCSP response từ CA, gửi kèm trong TLS handshake. Client không cần gọi CA riêng → handshake nhanh hơn, privacy tốt hơn.

---

## 11. Kiến Thức Chuyển Giao Sang Giai Đoạn 6

Giai đoạn 6 (RDS) **hoàn toàn tách biệt** với giai đoạn 5:

| Giai đoạn 5 đã có | Giai đoạn 6 sẽ thêm |
|-------------------|---------------------|
| Domain + HTTPS | RDS MySQL managed |
| Nginx SSL termination | `DB_SSL=true` |
| CORS chặt chẽ | Chỉ đổi `.env` DB config |

**Không cần sửa Nginx, Certbot, DNS** khi làm giai đoạn 6. Chỉ đổi `.env` → `migration:run` → `pm2 reload`.