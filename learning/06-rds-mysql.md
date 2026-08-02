# Giai đoạn 6 — Chuyển sang RDS MySQL

> Mục tiêu giai đoạn: Chuyển MySQL từ Docker container (local EC2) sang **RDS MySQL managed service**. **Code không đổi, chỉ đổi biến môi trường.**

```
Internet ──▶ api.yourdomain.com (DNS)
              │
              ▼
         Elastic IP
              │
              ▼
         EC2: Nginx :80/:443
              │       │
              │       ▼
              │   NestJS :3000 (PM2)
              └── RDS MySQL (managed, SSL, backup, HA)
```

---

## 1. Tại sao dùng RDS thay vì MySQL Docker?

| MySQL Docker trên EC2 | RDS MySQL Managed |
|----------------------|-------------------|
| Self-manage: backup, patch, monitor | **AWS lo toàn bộ** |
| Single point of failure (1 EC2) | **Multi-AZ** (tuỳ chọn) |
| Scale thủ công (resize volume, restart) | **Scale storage/compute** vài click |
| Không tự động backup point-in-time | **Automated backup + Point-in-time recovery** |
| Không có monitoring built-in | **CloudWatch metrics, Enhanced Monitoring** |
| SSL tự config | **SSL mặc định, certificate AWS quản lý** |
| Password trong `.env` plaintext | **Có thể dùng Secrets Manager** |

**Lesson**: *Database là stateful service khó vận hành nhất. Offload lên managed service = giảm operational burden, tăng reliability.*

---

## 2. RDS Architecture & Networking

### Security Group Reference (Key Concept)

```
┌─────────────────────────────────────────────────────────────┐
│ VPC                                                          │
│  ┌─────────────┐         ┌──────────────────┐              │
│  │   EC2       │         │      RDS         │              │
│  │             │         │                  │              │
│  │ SG: launch- │────────►│ SG: rds-mysql-sg │              │
│  │ wizard-3    │  3306   │ Inbound: launch- │              │
│  │             │         │ wizard-3         │              │
│  └─────────────┘         └──────────────────┘              │
└─────────────────────────────────────────────────────────────┘
```

**Quan trọng**: SG RDS inbound rule source = **SG của EC2** (`launch-wizard-3`), **KHÔNG** phải IP.

| Cách làm | Ưu điểm | Nhược điểm |
|----------|---------|------------|
| **SG reference SG** (đúng) | EC2 đổi IP/scale/replace → vẫn kết nối | Phải cùng VPC |
| IP cụ thể | Dễ hiểu | EC2 đổi IP → phải sửa SG RDS |

**Lesson**: *Security Group reference Security Group = infrastructure as code, resilient to IP changes.*

---

### Private Access Only

- **Public access: No** — RDS không có public IP
- Chỉ EC2 trong cùng VPC (qua SG) mới kết nối được
- Không ai từ internet truy cập trực tiếp DB

---

## 3. Database User & Least Privilege

### Tạo user riêng cho app (không dùng `root`)

```sql
CREATE USER 'app'@'%' IDENTIFIED BY 'StrongPassword123!';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES
  ON aws_deployment.* TO 'app'@'%';

FLUSH PRIVILEGES;
```

| Quyền | Cần cho migration? | Giải thích |
|-------|-------------------|------------|
| `SELECT, INSERT, UPDATE, DELETE` | ✅ | CRUD cơ bản |
| `CREATE, ALTER, DROP, INDEX` | ✅ | Migration tự chạy (`DB_RUN_MIGRATIONS=true`) |
| `REFERENCES` | ✅ | Foreign key |

**Lesson**: *Không bao giờ dùng `root` cho application. Tạo user per-app, chỉ đủ quyền trên 1 database.*

### Nếu muốn siết chặt hơn (production)

```env
DB_RUN_MIGRATIONS=false
```

Chạy migration trong CI/CD bằng user admin riêng, app user chỉ có `SELECT, INSERT, UPDATE, DELETE`.

---

## 4. SSL/TLS trên RDS — Bắt Buộc

### Local Docker MySQL vs RDS

| Môi trường | SSL | Config |
|------------|-----|--------|
| Local Docker | Tắt (`DB_SSL=false`) | Self-signed hoặc không SSL |
| RDS MySQL | **Bật buộc** (`DB_SSL=true`) | AWS certificate, CA bundle |

### Trong code (`src/database/data-source.ts`)

```typescript
ssl: config.get('database.ssl') ? { rejectUnauthorized: false } : false,
```

- `rejectUnauthorized: false` — chấp nhận AWS RDS certificate (không verify hostname)
- Production có thể dùng CA bundle để verify đầy đủ

**Lesson**: *Managed DB luôn yêu cầu SSL. Code phải handle được cả 2 mode (local không SSL, production có SSL).*

---

## 5. Migration Strategy

### Auto-run trên bootstrap (`DB_RUN_MIGRATIONS=true`)

```typescript
// src/database/data-source.ts
migrationsRun: config.get('database.runMigrations'),
```

**Ưu điểm**: Zero-downtime deploy, migration tự chạy khi app start.

**Rủi ro**: 
- App crash nếu migration fail
- Cần user có quyền DDL
- Race condition nếu multiple instances start cùng lúc

### Production recommendation

```bash
# CI/CD pipeline
npm run migration:run  # Chạy trước khi deploy
pm2 reload --update-env  # Reload app
```

Tắt `DB_RUN_MIGRATIONS=false` trên production.

---

## 6. Config-Driven Deployment — Luận Điểm Xuyên Suốt

### Chỉ đổi `.env`, code không đổi

| Biến | Local Docker | RDS Production |
|------|--------------|----------------|
| `DB_HOST` | `127.0.0.1` | `aws-deployment-db.xxx.ap-southeast-2.rds.amazonaws.com` |
| `DB_PORT` | `3306` | `3306` |
| `DB_USERNAME` | `root` | `app` |
| `DB_PASSWORD` | `localpass` | `StrongPassword123!` |
| `DB_NAME` | `aws_deployment` | `aws_deployment` |
| `DB_SSL` | `false` | `true` |
| `DB_SYNCHRONIZE` | `false` | `false` |
| `DB_RUN_MIGRATIONS` | `true` | `false` (khuyến nghị) |

**Code thay đổi**: **0 dòng**

**Lesson**: *12-Factor App — Config trong environment. Cùng 1 artifact build chạy được mọi môi trường.*

---

## 7. RDS Operational Benefits

### Backup & Recovery

```bash
# Automated backup (mặc định 7 ngày, có thể tăng 35 ngày)
# Point-in-time recovery: restore đến bất kỳ second nào trong 7 ngày

# Manual snapshot
aws rds create-db-snapshot \
  --db-instance-identifier aws-deployment-db \
  --db-snapshot-identifier aws-deployment-db-20240115
```

### Monitoring

```bash
# CloudWatch metrics (mặc định 1 phút)
# - CPUUtilization
# - DatabaseConnections
# - FreeStorageSpace
# - ReadIOPS / WriteIOPS
# - ReadLatency / WriteLatency

# Enhanced Monitoring (1 giây, cần IAM role)
# - OS-level metrics: CPU, memory, disk, network
```

### Maintenance Window

- AWS tự patch minor version trong maintenance window
- Có thể config window (vd: Mon 03:00-04:00 UTC)

---

## 8. Troubleshooting Checklist

| Lỗi | Nguyên nhân | Khắc phục |
|-----|-------------|-----------|
| `ERROR 2003: Can't connect` | SG RDS không cho phép SG EC2 | Check SG RDS inbound: source = SG EC2 |
| `ERROR 1045: Access denied` | Sai user/pass hoặc host `%` | `CREATE USER 'app'@'%'`, check password trong `.env` |
| `SSL connection error` | `DB_SSL=true` nhưng config sai | `ssl: { rejectUnauthorized: false }` |
| Migration fail | User thiếu quyền DDL | Grant `CREATE, ALTER, DROP, INDEX` |
| `health/ready` 503 | App không connect RDS | Check PM2 log, verify `.env` |
| `ER_NOT_SUPPORTED_AUTH_MODE` | MySQL 8 default caching_sha2_password | `CREATE USER ... IDENTIFIED WITH mysql_native_password BY 'pass'` |
| `Too many connections` | Pool size quá lớn / leak | Giảm `DB_POOL_SIZE`, check connection leak |

---

## 9. Cost Awareness

| Component | Free Tier | Production (estimate) |
|-----------|-----------|----------------------|
| RDS db.t4g.micro | 750 hrs/tháng (12 tháng) | ~$15/tháng |
| Storage 20GB GP2 | 20GB | $2.30/tháng |
| Backup storage | = DB size | $0.095/GB-tháng |
| Data transfer (same AZ) | Free | Free |
| Multi-AZ | Không free tier | 2x instance cost |

**Lesson**: *RDS free tier đủ học. Production tốn tiền — hãy tắt khi không dùng.*

---

## 10. Tự Kiểm Tra

1. **Tại sao SG RDS source là SG EC2, không phải IP?**
   - EC2 Auto Scaling/replace → IP thay đổi → SG reference SG vẫn hoạt động.

2. **User `app`@`%` có quyền gì? Tại sao cần `CREATE, ALTER, DROP`?**
   - Migration tự chạy cần tạo/sửa/xoá bảng. `%` = cho phép kết nối từ mọi IP trong VPC.

3. **`DB_SSL=true` bắt buộc trên RDS, local thì `false` — code handle như thế nào?**
   - `ssl: config.get('database.ssl') ? { rejectUnauthorized: false } : false`

4. **`DB_RUN_MIGRATIONS=true` tiện nhưng rủi ro gì?**
   - App crash nếu migration fail; race condition multi-instance; cần user DDL quyền cao.

5. **RDS Multi-AZ vs Single-AZ khác gì? Khi nào cần Multi-AZ?**
   - Multi-AZ: 2 instance (primary + standby), auto failover. Production SLA 99.95%.
   - Single-AZ: 1 instance, dev/test, rẻ.

6. **Backup RDS tự động như thế nào? Point-in-time recovery là gì?**
   - Automated backup daily + transaction logs → restore đến bất kỳ second nào trong retention period.

7. **Sau khi chuyển RDS, có thể xoá MySQL Docker trên EC2 không?**
   - Có. `docker compose down -v` → giải phóng RAM/CPU/disk.

---

## 11. Kiến Thức Tổng Hợp (6 Giai Đoạn)

| Giai đoạn | Kiến thức cốt lõi | Pattern/AWS Service |
|-----------|------------------|---------------------|
| **1** | NestJS architecture, TypeORM, migration, config validation | 12-Factor App, Repository Pattern |
| **2** | S3, IAM User/Policy, Bucket Policy, least privilege | Identity vs Resource policy |
| **3** | EC2, PM2, IAM Role, IMDSv2, swap, deploy script | Instance Profile, STS, Process Manager |
| **4** | Nginx reverse proxy, keepalive, trust proxy, rate limit | Reverse Proxy, Defense in Depth |
| **5** | DNS, Certbot, Let's Encrypt, auto-renew, CORS, HSTS | SSL Termination, Certificate Automation |
| **6** | RDS, SG reference SG, least privilege DB user, SSL, migration | Managed Service, Config-Driven Deployment |

---

## 12. Luận Điểm Xuyên Suốt: **Code Không Đổi, Chỉ Đổi Config**

```
┌─────────────────────────────────────────────────────────────────┐
│                    SAME ARTIFACT (dist/)                        │
├─────────────────────────────────────────────────────────────────┤
│  Local          │  EC2 (Stage 3)  │  EC2 + Nginx  │  Production │
│  ────────────── │  ────────────── │  ──────────── │  ────────── │
│  DB: Docker     │  DB: Docker     │  DB: Docker   │  DB: RDS    │
│  S3: MinIO      │  S3: IAM Role   │  S3: IAM Role │  S3: IAM Role│
│  HTTP:3000      │  HTTP:3000      │  HTTPS:443    │  HTTPS:443  │
│  CORS: *        │  CORS: *        │  CORS: domain │  CORS: domain│
│  SSL: false     │  SSL: false     │  SSL: true    │  SSL: true  │
└─────────────────────────────────────────────────────────────────┘
                    │
                    ▼
            Chỉ thay đổi .env
```

**12-Factor App Factor III — Config**: *Store config in the environment. A litmus test for whether an app has all config correctly factored out of the code is whether the codebase could be made open source at any moment, without compromising any credentials.*

---

## 13. Next Steps (Nếu Muốn Mở Rộng)

| Mở rộng | Kiến thức cần | Skill liên quan |
|---------|--------------|-----------------|
| **Multi-AZ RDS** | HA, failover, connection pooling | `ecc:mysql-patterns`, `ecc:postgres-patterns` |
| **Secrets Manager** | Lưu DB password, auto-rotate, injection | `ecc:deployment-patterns` |
| **ALB thay Nginx** | Managed LB, target groups, health checks | `ecc:deployment-patterns` |
| **CloudWatch + Alarms** | Metrics, logs, alerting, dashboard | `ecc:production-audit` |
| **CI/CD GitHub Actions** | Auto deploy, test, rollback | `ecc:github-ops` |
| **Blue/Green Deploy** | Zero-downtime, canary, traffic shifting | `ecc:deployment-patterns` |
| **Read Replica** | Scale read, reporting DB | `ecc:mysql-patterns` |
| **Parameter Group** | Tune MySQL config (innodb_buffer_pool, etc.) | `ecc:mysql-patterns` |

---

## 14. Checklist Hoàn Thành Toàn Bộ Plan (6 Giai Đoạn)

- [x] **Giai đoạn 1**: NestJS + MySQL Docker local → migration tự chạy
- [x] **Giai đoạn 2**: S3 + IAM User → upload avatar, bucket policy public-read
- [x] **Giai đoạn 3**: EC2 + PM2 + IAM Role → app chạy trên EC2, không access key
- [x] **Giai đoạn 4**: Nginx reverse proxy → :80/443 → :3000, keepalive, trust proxy
- [x] **Giai đoạn 5**: Domain + HTTPS (Certbot) → DNS, SSL auto-renew, CORS chặt
- [x] **Giai đoạn 6**: RDS MySQL → chỉ đổi `.env`, code không đổi

> **Hoàn thành!** Bạn đã deploy full-stack app lên AWS với kiến trúc production-ready. 🎉