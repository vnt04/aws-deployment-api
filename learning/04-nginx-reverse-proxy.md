# Giai đoạn 4 — Nginx Reverse Proxy

> Mục tiêu giai đoạn: Nginx chạy trên port 80/443, forward traffic đến NestJS :3000, xử lý SSL termination, rate limit, gzip, upload file lớn.

```
Internet ──▶ EC2 (Elastic IP)
              ├── Nginx :80/:443     ← Giai đoạn 4
              │       │
              │       ▼
              │   NestJS :3000       ← Giai đoạn 3 (PM2)
              └── MySQL :3306 (Docker, loopback)
                      │
                      └── IAM Role ──▶ S3
```

---

## 1. Tại sao cần Reverse Proxy?

| Vấn đề nếu Node.js trực tiếp nhận traffic | Giải pháp của Nginx |
|-------------------------------------------|---------------------|
| Port 3000 không phải port chuẩn HTTP/HTTPS | Listen port **80/443** (chuẩn web) |
| Node.js single-threaded, dễ bị DoS bởi slow clients | Buffer request/response, giới hạn timeout |
| Không có TLS termination | Offload SSL (Certbot giai đoạn 5) |
| Upload file lớn → block event loop | `client_max_body_size`, streaming lên upstream |
| Không có rate limit, gzip, caching | Built-in modules |

**Lesson**: *Application server (NestJS) nên tập trung business logic; infrastructure concerns (TLS, compression, security headers, load balancing) để reverse proxy lo.*

---

## 2. Cấu trúc config Nginx (`deploy/nginx/api.conf`)

```nginx
upstream aws_deployment_api {
    server 127.0.0.1:3000;
    keepalive 32;           # Giữ kết nối → giảm overhead handshake
}

server {
    listen 80;
    listen [::]:80;
    server_name api.yourdomain.com;  # ← SỬA THÀNH DOMAIN/IP THỰC

    # Avatar tối đa 5MB + multipart overhead
    client_max_body_size 6M;

    access_log /var/log/nginx/api.access.log;
    error_log  /var/log/nginx/api.error.log;

    gzip on;
    gzip_types application/json text/plain;
    gzip_min_length 1024;

    location / {
        proxy_pass http://aws_deployment_api;
        proxy_http_version 1.1; # Quan trọng: HTTP/1.1 mới hỗ trợ keepalive
        
        # Headers bắt buộc để NestJS biết client thật
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection        '';  # Keep-alive upstream

        proxy_connect_timeout 10s;
        proxy_read_timeout    60s;
        proxy_send_timeout    60s;
    }

    # Health check không log để tránh nhiễu log
    location = /health {
        proxy_pass http://aws_deployment_api/health;
        access_log off;
    }
}
```

### Giải thích các directive quan trọng

| Directive | Ý nghĩa | Tại sao quan trọng |
|-----------|---------|-------------------|
| `proxy_http_version 1.1` | Dùng HTTP/1.1 cho upstream | Hỗ trợ keepalive, chunked transfer |
| `keepalive 32` (trong upstream) | Giữ 32 kết nối idle | Giảm TCP handshake overhead |
| `Connection ''` | Gửi `Connection: keep-alive` lên upstream | Bật keepalive thực sự |
| `X-Forwarded-For` | Chuỗi IP client → proxy1 → proxy2 | NestJS đọc IP thật cho rate limit, audit |
| `X-Forwarded-Proto` | `http` hoặc `https` | NestJS biết request gốc là HTTP hay HTTPS |
| `client_max_body_size 6M` | Giới hạn body size | Cho phép upload avatar 5MB + overhead |

---

## 3. Trust Proxy trong NestJS (`src/main.ts:18`)

```typescript
// main.ts
app.set('trust proxy', 1);  // 1 = tin 1 hop proxy (Nginx)
```

Khi `trust proxy` được bật:
- `req.ip` đọc từ `X-Forwarded-For` (IP client thật) thay vì `socket.remoteAddress` (IP của Nginx = 127.0.0.1)
- `req.protocol` đọc từ `X-Forwarded-Proto`
- `@nestjs/throttler` rate limit đúng client thật

**Lesson**: *Không bao giờ tin `req.ip` trực tiếp khi chạy sau proxy*. Cấu hình sai → rate limit, audit log, geo-IP đều sai.

---

## 4. Security Group vs Application Layer — Defense in Depth

| Layer | Chức năng | Cấu hình trong project |
|-------|-----------|------------------------|
| **Security Group (AWS)** | Chặn traffic ở network level | Port 3000, 3306 **không bao giờ mở ra internet** |
| **Nginx** | Chặn ở application level | Rate limit, block bad UA, WAF rules, SSL termination |

```
Internet
    │
    ▼
┌─────────────────────────────────────┐
│ Security Group: chỉ mở 22, 80, 443  │  ← Lớp 1: Network firewall
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ Nginx: rate limit, SSL, gzip,       │  ← Lớp 2: Application firewall
│ client_max_body_size, access log    │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ NestJS: helmet(), CORS, validation, │  ← Lớp 3: Application logic
│ throttler, business logic           │
└─────────────────────────────────────┘
```

---

## 5. Client Body Size — Bẫy Thường Gặp

```nginx
client_max_body_size 6M;  # Avatar 5MB + multipart overhead
```

- Nginx default: `1M`
- Nếu không set → upload avatar 5MB bị **413 Request Entity Too Large** trước khi đến NestJS
- NestJS `FileInterceptor` có limit riêng (`5MB` trong code) nhưng Nginx chặn sớm hơn

**Lesson**: *Test upload file thật sớm*. Unit test không bắt được lỗi infra này.

---

## 6. Health Check Tách Biệt: Liveness vs Readiness

```nginx
# Chỉ check process sống — không log
location = /health {
    proxy_pass http://aws_deployment_api/health;
    access_log off;
}

# Check DB connection — dùng cho readiness probe
location = /health/ready {
    proxy_pass http://aws_deployment_api/health/ready;
}
```

| Endpoint | Mục đích | Dùng bởi |
|----------|----------|----------|
| `/health` | **Liveness** — process còn sống | Nginx upstream check, PM2, ALB |
| `/health/ready` | **Readiness** — DB kết nối OK | ALB target group, rolling deploy |

**Lesson**: *Liveness ≠ Readiness*. Container/process chạy không có nghĩa là sẵn sàng serve request.

---

## 7. Certbot Tự Động Hóa HTTPS (Giai đoạn 5)

```bash
sudo certbot --nginx -d api.yourdomain.com
```

Certbot sẽ tự động:
1. Sửa config thêm `listen 443 ssl` + certificate paths
2. Thêm redirect 301 HTTP → HTTPS trong block port 80
3. Cài cron renew tự động (`/etc/cron.d/certbot`)

**Lesson**: *Đừng config SSL tay*. Certbot + Nginx plugin = chuẩn, an toàn, tự gia hạn.

---

## 8. Debug Quy Trình Khi 502 Bad Gateway

| Bước | Lệnh | Mục đích |
|------|------|----------|
| 1 | `systemctl status nginx` | Nginx service có chạy không? |
| 2 | `sudo nginx -t` | Config syntax đúng không? |
| 3 | `pm2 status` / `curl http://127.0.0.1:3000/health` | Upstream (Node.js) sống không? |
| 4 | `tail -f /var/log/nginx/api.error.log` | Xem error chi tiết |
| 5 | `ss -tlnp \| grep :80` | Port 80 đang listen không? |

**Lesson**: *502 = Nginx không connect được upstream*. Thường do Node.js die, sai port, hoặc firewall local.

---

## 9. Các Lệnh Hữu Ích

```bash
# Test config
sudo nginx -t

# Reload không downtime
sudo systemctl reload nginx

# Xem log realtime
tail -f /var/log/nginx/api.access.log
tail -f /var/log/nginx/api.error.log

# Kiểm tra upstream keepalive
curl -v http://127.0.0.1/health 2>&1 | grep -i connection

# Test upload qua Nginx
curl -X POST http://<ELASTIC_IP>/users/1/avatar -F 'avatar=@./avatar.jpg'
```

---

## 10. Tự Kiểm Tra

1. **Tại sao NestJS không listen trực tiếp port 80?**
   - Port < 1024 cần root; Node.js không nên chạy root; Nginx drop privileges sau khi bind

2. **`proxy_http_version 1.1` thiếu thì sao?**
   - Mỗi request = 1 TCP handshake mới → latency cao, CPU cao

3. **`trust proxy` sai (0 hoặc >1) thì sao?**
   - `0`: `req.ip` = 127.0.0.1 (Nginx IP) → rate limit sai, log sai
   - `>1`: Tin header từ proxy giả → security risk

4. **`client_max_body_size` nhỏ hơn file upload thì sao?**
   - 413 trước khi đến NestJS, log Nginx: "client intended to send too large body"

5. **Health check `/health` trả 200 nhưng `/health/ready` trả 503 thì sao?**
   - Process sống nhưng DB down → không nhận traffic mới (ALB target group unhealthy)

6. **Security Group mở port 3000 ra internet có an toàn không?**
   - Không. Bypass Nginx → mất rate limit, SSL, WAF, logging. Chỉ mở 80/443.

---

## 11. Chuyển Giao Sang Giai Đoạn 5

| Giai đoạn 4 đã có | Giai đoạn 5 sẽ thêm |
|-------------------|---------------------|
| Nginx listen 80 | Certbot thêm listen 443 + SSL cert |
| `server_name <IP>` | `server_name api.yourdomain.com` |
| HTTP traffic | HTTPS + redirect 301 |
| `CORS_ORIGINS=*` | `CORS_ORIGINS=https://yourdomain.com` |

Giai đoạn 5 rất nhanh: có domain → trỏ A record → `sudo certbot --nginx -d api.yourdomain.com` → xong.