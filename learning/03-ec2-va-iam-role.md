# Giai đoạn 3 — EC2, IAM Role và vận hành server

> Mục tiêu giai đoạn: app chạy trên EC2 và upload được lên S3 **mà không có access key nào trên đĩa**.
> Giai đoạn 2 học về *quyền*. Giai đoạn này học về *danh tính* — và về những ràng buộc vật lý
> của một máy chủ thật.

```
Internet ──▶ EC2 (Elastic IP)
              ├── Nginx :80/:443   ← Giai đoạn 4
              │       │
              │       ▼
              │   NestJS :3000  (PM2)
              └── MySQL  :3306  (Docker, loopback)
                      │
                      └── IAM Role ──▶ S3
```

Điểm khác biệt lớn nhất so với giai đoạn 2 nằm ở mũi tên cuối: không còn access key nào
tham gia vào đó nữa, nhưng nó vẫn chạy.

---

## Phần I — Danh tính không cần mật khẩu

### 1. Loại policy thứ ba: trust policy {#trust-policy}

Giai đoạn 2 có hai loại policy. Giai đoạn 3 thêm loại thứ ba, và bộ ba này là **đủ** để
hiểu gần như mọi tình huống phân quyền trên AWS:

| Loại | Gắn vào | Trả lời câu hỏi | File trong repo |
|---|---|---|---|
| Identity-based | user / role | "*Tôi* được làm gì?" | `s3-iam-policy.json` |
| Resource-based | bucket, queue, topic… | "Ai được vào *tôi*?" | `s3-bucket-policy-public-read.json` |
| **Trust policy** | **chính Role đó** | **"Ai được *mượn danh* tôi?"** | `ec2-trust-policy.json` |

```json
"Principal": { "Service": "ec2.amazonaws.com" },
"Action": "sts:AssumeRole"
```

Chú ý `Principal` ở đây **không phải người, không phải `*`, mà là một service của AWS**.
Câu này đọc là: "dịch vụ EC2 được phép mượn danh tính của Role này."

Trust policy là thứ Console âm thầm tạo giúp khi bạn chọn "Trusted entity: EC2" — nên rất
nhiều người dùng AWS vài năm mà chưa từng nhìn thấy nó. Làm bằng CLI thì phải viết tay, và
đó là lúc mới thấy nó tồn tại.

**Hai policy, hai câu hỏi độc lập:**

```
Trust policy       → EC2 có được mượn Role này không?     (thiếu → không mượn được)
Permission policy  → Mượn rồi thì làm được gì trên S3?    (thiếu → mượn được nhưng AccessDenied)
```

Đủ trust mà thiếu permission → app chạy, upload báo `AccessDenied`.
Đủ permission mà thiếu trust → Role tồn tại nhưng EC2 không lấy được credential, app báo
`CredentialsProviderError`. **Hai triệu chứng khác nhau, hai chỗ sửa khác nhau** — giống hệt
cách phân biệt IAM policy và bucket policy ở giai đoạn 2.

### 2. Role không chứa credential — nó là một vai diễn

Đây là điểm dễ hiểu sai nhất. IAM User **có** access key; IAM Role **không có gì cả**.

Role chỉ là một tập quyền kèm điều kiện ai được mượn. Cơ chế thật diễn ra thế này:

```
1. EC2 service thấy instance có gắn Role
2. EC2 gọi sts:AssumeRole  ──▶  STS (Security Token Service)
3. STS trả về credential TẠM THỜI (AccessKeyId + SecretAccessKey + SessionToken + Expiration)
4. EC2 đặt bộ credential đó vào instance metadata của máy
5. AWS SDK trong app đọc từ metadata
6. Sắp hết hạn → EC2 tự làm lại bước 2, app không biết gì
```

Ẩn dụ dễ nhớ: **Role là bộ đồng phục treo trong tủ, không phải người.** Ai được phép (trust
policy quy định) thì mặc vào và có quyền của bộ đồng phục đó, trong một khoảng thời gian.

Hệ quả thực tế: **không thể "lấy trộm Role"**. Không có gì để trộm. Cái trộm được là
credential tạm thời — mà nó hết hạn sau vài giờ.

### 3. Instance profile — cái hộp mà Console giấu đi

Bạn tạo *Role* rồi gắn vào EC2. Nhưng EC2 thật ra không gắn được Role trực tiếp — nó gắn
**instance profile**, một cái hộp chứa đúng **một** Role.

Console tự tạo instance profile trùng tên với Role nên bạn không thấy. CLI thì phải làm tay:

```bash
aws iam create-role --role-name aws-deployment-api-ec2 \
  --assume-role-policy-document file://deploy/aws/ec2-trust-policy.json
aws iam attach-role-policy --role-name aws-deployment-api-ec2 \
  --policy-arn arn:aws:iam::<ACCOUNT>:policy/aws-deployment-api-s3-avatars

aws iam create-instance-profile --instance-profile-name aws-deployment-api-ec2   # ← bước Console giấu
aws iam add-role-to-instance-profile \
  --instance-profile-name aws-deployment-api-ec2 --role-name aws-deployment-api-ec2
```

Biết chuyện này để không hoang mang khi lỗi hiện chữ `instance profile` trong khi bạn đang
tìm chữ `role`. Chúng là hai object khác nhau trong IAM, chỉ trùng tên.

### 4. IMDS — nơi credential thật sự đến {#imds}

```
http://169.254.169.254/latest/meta-data/...
```

**Vì sao lại là địa chỉ IP kỳ lạ này?** `169.254.0.0/16` là dải **link-local** (RFC 3927) —
theo chuẩn, gói tin tới dải này **không bao giờ được router chuyển tiếp**. Nó chỉ sống trong
phạm vi một link. Nghĩa là:

- Không cần Security Group nào để gọi được
- Không thể gọi từ máy khác vào — kể cả máy trong cùng VPC
- Không đi ra Internet, không tốn phí data transfer

Mỗi instance gọi địa chỉ này đều nhận về metadata **của chính nó**. Đây là quy ước chung của
ngành, không riêng AWS — GCP và Azure cũng dùng đúng địa chỉ này.

**IMDSv1 và bài học từ một vụ rò rỉ thật.** Bản đầu tiên chỉ cần một GET đơn giản:

```bash
curl http://169.254.169.254/latest/meta-data/iam/security-credentials/my-role
```

Vấn đề: nếu app có lỗ hổng **SSRF** (Server-Side Request Forgery — dụ server tự gọi một URL
do kẻ tấn công chọn), kẻ tấn công chỉ cần đưa vào URL trên là app tự đi lấy credential rồi
trả về cho hắn. Đây chính là con đường trong vụ Capital One 2019 — dữ liệu của hơn 100 triệu
người bị lấy đi qua đúng chuỗi này: SSRF → IMDS → credential của Role → S3.

**IMDSv2** sửa bằng ba rào cản, mỗi cái nhắm đúng một hạn chế của SSRF:

| Rào cản | Chặn được gì |
|---|---|
| Phải `PUT` để xin token trước | hầu hết lỗ hổng SSRF chỉ làm được `GET` |
| Phải gửi header `X-aws-ec2-metadata-token` | SSRF đơn giản không đặt được header tuỳ ý |
| Response của token có **hop limit = 1** | gói tin không sống nổi qua một chặng mạng nữa — chặn proxy và container bridge |

Vì thế lệnh kiểm tra phải đi hai bước:

```bash
TOKEN=$(curl -sX PUT http://169.254.169.254/latest/api/token \
  -H 'X-aws-ec2-metadata-token-ttl-seconds: 21600')      # tối đa 21600 = 6 giờ

curl -s -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/iam/security-credentials/
```

> Hop limit mặc định là 1. Chạy app trong **container** trên EC2 thì gói tin phải qua thêm
> một chặng bridge network và sẽ bị rơi — phải nâng lên 2. Đây là lý do project chạy Node
> bằng PM2 trên host chứ không trong container: một biến số ít đi.

### 5. Bằng chứng nhìn bằng mắt: `ASIA` và `AKIA`

```json
{
    "Code": "Success",
    "AccessKeyId": "ASIA...",     ← tiền tố khác hẳn AKIA
    "SecretAccessKey": "...",
    "Token": "...",               ← IAM User KHÔNG có trường này
    "Expiration": "2026-07-28T..." ← cũng không có
}
```

| Tiền tố | Loại | Thời hạn |
|---|---|---|
| `AKIA` | access key của IAM User | vĩnh viễn tới khi bạn xoá |
| `ASIA` | credential tạm thời từ STS | vài giờ |

Nhìn tiền tố là biết ngay loại nào — kỹ năng hữu ích khi soi log hoặc điều tra sự cố. Thấy
`AKIA` trong log CI, trong Slack, trong screenshot là **báo động**; `ASIA` thì rủi ro thấp
hơn nhiều vì nó tự chết.

`SessionToken` là thứ bắt buộc phải gửi kèm với credential tạm thời. Đây là lý do bạn không
thể chỉ copy `AccessKeyId` + `SecretAccessKey` từ IMDS ra máy khác mà dùng — thiếu token là
mọi request đều bị từ chối.

### 6. Vì sao đây là bước tiến bảo mật thật, không phải hình thức

So sánh hậu quả khi máy bị chiếm quyền:

| | Giai đoạn 2 (access key trong `.env`) | Giai đoạn 3 (IAM Role) |
|---|---|---|
| Kẻ tấn công lấy được gì | key vĩnh viễn, copy đi dùng ở đâu cũng được | credential hết hạn sau vài giờ |
| Dùng được bao lâu | tới khi bạn phát hiện và xoá | hết hạn kể cả bạn không làm gì |
| Bạn có biết không | không, trừ khi soi CloudTrail | không, nhưng thiệt hại tự giới hạn |
| Xoay vòng key | bạn phải nhớ mà làm | AWS tự làm, liên tục |

Điểm cốt lõi: **secret không xoay vòng là secret sẽ rò rỉ** — chỉ là vấn đề thời gian. Nó
nằm trong `.env`, trong backup, trong log, trong ảnh chụp màn hình. Cách chống bền vững
không phải là giữ kín hơn, mà là **rút ngắn thời gian sống của nó**.

Nguyên tắc mang đi mọi nơi: **có cơ chế danh tính do nền tảng cấp thì đừng dùng secret tĩnh.**
GitHub Actions có OIDC, Kubernetes có ServiceAccount, GCP có Workload Identity — cùng một ý tưởng.

---

## Phần II — Máy 1GB RAM và những ràng buộc vật lý

Giai đoạn 2 chạy trên laptop nên không ai nghĩ tới RAM. Trên t3.micro thì RAM là ràng buộc
quyết định nhiều lựa chọn thiết kế.

### 7. Swap và OOM killer

Linux **overcommit** — nó hứa nhiều RAM hơn thực có, đánh cược rằng không phải ai cũng dùng
hết phần mình xin. Khi cược sai và RAM thật cạn, kernel gọi **OOM killer** chọn một tiến
trình để giết, ưu tiên tiến trình đang ăn nhiều bộ nhớ nhất.

Điều làm nó khó chẩn đoán: **tiến trình bị giết không kịp ghi log gì cả.** Nó biến mất. Log
của MySQL im lặng, log của Node im lặng, PM2 chỉ ghi "process exited". Bằng chứng nằm ở chỗ khác:

```bash
dmesg | grep -i 'killed process'
# Out of memory: Killed process 1234 (mysqld) total-vm:..., anon-rss:...
```

Bài toán RAM của giai đoạn 3:

| Thành phần | RAM xấp xỉ |
|---|---|
| Ubuntu base | ~150MB |
| MySQL 8 (buffer pool mặc định 128MB) | ~400MB |
| Node (1 worker) | ~120MB |
| `npm run build` (tsc) — **đỉnh ngắn** | ~400MB |
| **Tổng lúc build** | **~1070MB / 1024MB** ✗ |

Đúng chỗ tràn là bước build, và nó chỉ tràn trong vài giây. Swap giải quyết chính xác loại
vấn đề này: **swap không làm máy nhanh hơn, nó mua cho bạn biên độ để vượt qua đỉnh ngắn.**

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile          # chỉ root đọc được — swap chứa dữ liệu của mọi tiến trình
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab   # sống sót qua reboot
```

`chmod 600` không phải hình thức: file swap chứa nội dung bộ nhớ của mọi tiến trình trên máy,
kể cả mật khẩu DB đang nằm trong RAM.

Tinh chỉnh đáng làm:

```bash
sudo sysctl vm.swappiness=10      # mặc định 60
```

`swappiness` là mức độ sốt sắng của kernel khi đẩy dữ liệu ra swap. Để 60 nghĩa là nó đẩy cả
khi RAM còn thoải mái — mà swap nằm trên đĩa EBS, chậm hơn RAM hàng nghìn lần. Để 10 nghĩa
là "chỉ dùng swap khi thật sự bí" — đúng với mục đích ở đây là lưới an toàn, không phải bộ nhớ thường trực.

### 8. PM2 cluster mode và vì sao `instances: 1` {#pm2-instances}

Node chạy JavaScript trên **một luồng duy nhất**. Muốn tận dụng nhiều CPU thì phải chạy
nhiều tiến trình. PM2 cluster mode làm việc đó: fork N tiến trình cùng lắng nghe một port,
kernel chia đều kết nối.

`instances: 'max'` = số vCPU. t3.micro có 2 vCPU → 2 worker. Nghe hợp lý, nhưng:

| | CPU-bound | I/O-bound |
|---|---|---|
| Ví dụ | resize ảnh, mã hoá, tính toán | **app này**: đợi MySQL, đợi S3 |
| Thêm worker giúp gì | chia được việc, nhanh gấp đôi | gần như không — luồng chính vốn đang rảnh |
| Chi phí | +1 V8 heap (~120MB) | +1 V8 heap (~120MB) |

App này chờ I/O gần như toàn thời gian: query MySQL, gọi S3. Event loop của Node xử lý hàng
nghìn kết nối đồng thời trong một luồng mà vẫn rảnh. Worker thứ hai **tốn 120MB để không giải
quyết vấn đề gì** — trên máy 1GB thì đó là đánh đổi tệ.

Nên `ecosystem.config.js:9` để `instances: 1`. Nhưng **vẫn giữ `exec_mode: 'cluster'`**, và
chỗ này quan trọng:

| | `pm2 reload` ở fork mode | `pm2 reload` ở cluster mode |
|---|---|---|
| Cách làm | giết tiến trình cũ rồi bật cái mới | bật cái mới, **chờ nó sẵn sàng**, rồi mới giết cái cũ |
| Downtime | có, vài giây | không |

`deploy/deploy.sh:26` dùng `pm2 reload`. Đổi sang fork mode là mỗi lần deploy có vài giây
502 — mà cluster mode với 1 instance vẫn reload không downtime bình thường. **Cluster mode
không phải chỉ để chạy nhiều tiến trình; nó còn là điều kiện để deploy không rớt request.**

### 9. `pm2 save` và `pm2 startup` — hai việc khác nhau, cần cả hai

Rất hay bị nhầm là một.

```
pm2 save     → ghi danh sách tiến trình đang chạy ra ~/.pm2/dump.pm2
pm2 startup  → sinh + cài một systemd unit, unit đó chạy `pm2 resurrect` lúc boot
```

```
Chỉ save    → có danh sách, nhưng không ai bật PM2 sau reboot  →  app chết
Chỉ startup → PM2 bật lên nhưng danh sách rỗng                 →  app chết
Cả hai      → boot → systemd bật PM2 → PM2 đọc dump → app sống
```

`pm2 startup` chỉ **in ra** một lệnh `sudo env PATH=... pm2 startup systemd -u ubuntu ...`,
nó không tự chạy. Không chạy tiếp lệnh đó thì coi như chưa làm gì.

Và mỗi lần đổi danh sách tiến trình phải `pm2 save` lại — nếu không, reboot sẽ khôi phục về
trạng thái của lần save cũ. Đây là lý do `deploy.sh:30` gọi `pm2 save` sau mỗi lần deploy.

Kiểm chứng thật (làm một lần cho yên tâm):

```bash
sudo reboot
# đợi ~40s rồi ssh lại
pm2 status && curl http://127.0.0.1:3000/health
```

---

## Phần III — Mạng và ranh giới

### 10. Security Group là firewall **stateful**

```
Inbound: 22 (IP của bạn), 80, 443
Outbound: mặc định allow all
```

Câu hỏi tự nhiên: mở inbound 443 thì response đi ra có cần rule outbound không? **Không** —
Security Group là **stateful**: nó nhớ kết nối nào đã được cho vào và tự động cho phép chiều
ngược lại.

Đối chiếu với **Network ACL**, lớp ở tầng subnet, vốn **stateless** — phải khai báo cả hai chiều:

| | Security Group | Network ACL |
|---|---|---|
| Phạm vi | từng ENI (từng máy) | cả subnet |
| Trạng thái | **stateful** | stateless |
| Luật | chỉ có allow | có cả allow và deny |
| Mặc định | inbound chặn hết, outbound mở hết | mở hết cả hai chiều |

Outbound mở hết là lý do EC2 gọi được `apt`, `github.com`, và S3 mà bạn không phải khai gì.

**Vì sao không mở port 3000?** Node vẫn nghe ở 3000 nhưng chỉ Nginx (cùng máy, qua loopback)
gọi tới. Mở 3000 ra Internet nghĩa là có **hai đường vào**: một qua Nginx có rate limit, có
giới hạn body size, có log, có TLS ở giai đoạn 5 — và một đường trần trụi. Mọi biện pháp đặt
ở Nginx trở nên vô nghĩa vì đi vòng được.

Nguyên tắc: **một dịch vụ nên có đúng một đường vào.** Mỗi đường phụ là một chỗ để quên siết.

### 11. Docker publish port: `0.0.0.0` và cái bẫy UFW

`docker-compose.yml` ban đầu:

```yaml
ports:
  - '${DB_PORT:-3306}:3306'        # ← bind vào 0.0.0.0, tức MỌI interface
```

Trên laptop thì vô hại. Trên EC2 thì MySQL đang lắng nghe trên cả IP public. Đã sửa thành:

```yaml
- '127.0.0.1:${DB_PORT:-3306}:3306'
```

Nhưng Security Group đâu có mở 3306 — vậy có thừa không? **Không**, vì hai lý do, và lý do
thứ hai mới là điều đáng học:

**Thứ nhất**, Security Group là do người sửa. Một hôm nào đó debug và mở tạm 3306 "một lát
thôi" là MySQL phơi ra Internet ngay lập tức. Bind loopback khiến sai lầm đó không đủ để gây hậu quả.

**Thứ hai — Docker đi vòng qua firewall của Linux.** Đây là bẫy kinh điển:

```
Gói tin vào  →  iptables nat/PREROUTING  →  Docker DNAT tới container
                                              │
                    UFW đặt luật ở filter/INPUT ──── KHÔNG nằm trên đường này
```

Docker chèn luật DNAT ở bảng `nat`, chuyển hướng gói tin đi qua chain `FORWARD` chứ không
phải `INPUT` — mà UFW lại đặt luật ở `INPUT`. Kết quả: **`ufw deny 3306` không chặn được
container đã publish port 3306.** Rất nhiều người tưởng đã đóng mà thực ra vẫn mở.

May là Security Group của AWS thì **không** bị đi vòng — nó được thực thi ở tầng ENI, ngoài
kernel của máy, gói tin bị chặn trước khi tới iptables. Nhưng bài học vẫn còn nguyên giá trị:
**đừng tin một lớp phòng thủ duy nhất, và phải biết chính xác lớp đó nằm ở đâu.**

### 12. Elastic IP

Public IPv4 mà EC2 cấp mặc định **đổi mỗi lần stop/start**. Ở giai đoạn 5 sẽ trỏ bản ghi DNS
vào IP này — IP đổi là domain trỏ vào hư không.

Elastic IP là địa chỉ được cấp riêng cho tài khoản và giữ nguyên cho tới khi bạn trả lại.

Lưu ý chi phí, dễ bị bỏ qua: từ tháng 2/2024 AWS **tính phí mọi địa chỉ IPv4 public**
(~0,005 USD/giờ, khoảng 3,6 USD/tháng), kể cả EIP đang gắn vào máy. Free tier 12 tháng đầu
có 750 giờ/tháng miễn phí. Và **EIP không gắn vào đâu vẫn bị tính tiền** — nên nhớ release
khi xoá instance, đây là khoản lãng phí phổ biến nhất với người mới học.

---

## Phần IV — Vận hành

### 13. Deploy key — quyền hẹp lại một lần nữa

Ba cách để EC2 lấy code từ GitHub:

| Cách | Phạm vi | Rủi ro khi EC2 bị chiếm |
|---|---|---|
| SSH key cá nhân | **mọi repo** bạn có quyền | mất toàn bộ code của bạn |
| Personal access token | theo scope, thường rộng | tuỳ scope, thường vẫn rộng |
| **Deploy key (read-only)** | **đúng một repo, chỉ đọc** | đọc được một repo, không sửa được gì |

Đây đúng là nguyên tắc least privilege của giai đoạn 2, áp vào GitHub thay vì AWS: **hẹp về
phạm vi (một repo) và hẹp về hành động (chỉ đọc).**

Điểm quan trọng là **không tick "Allow write access"**. Có quyền ghi thì kẻ chiếm được EC2
có thể push code độc vào repo — và code đó sẽ tự động được deploy ở lần chạy `deploy.sh` tiếp
theo, cũng như lan sang mọi môi trường khác dùng chung repo. Từ một máy bị chiếm thành cả hệ
thống bị chiếm.

Key phải sinh **trên EC2** và private key không bao giờ rời khỏi máy đó. Copy private key từ
laptop lên là làm hỏng toàn bộ ý nghĩa — giờ nó tồn tại ở hai nơi.

### 14. `deploy.sh` — đọc từng dòng

```bash
set -euo pipefail
```

| Cờ | Tác dụng |
|---|---|
| `-e` | lỗi ở bất kỳ lệnh nào là dừng ngay |
| `-u` | dùng biến chưa định nghĩa là lỗi (bắt lỗi gõ nhầm tên biến) |
| `-o pipefail` | lệnh chết giữa pipe cũng tính là lỗi |

Không có ba cờ này, script sẽ **chạy tiếp sau khi build lỗi** rồi reload PM2 với `dist/` cũ —
và báo "Deploy thành công". Im lặng sai còn tệ hơn dừng lại.

```bash
git fetch --prune origin
git reset --hard "origin/$BRANCH"
```

Vì sao không `git pull`? `pull` = `fetch` + `merge`, mà merge có thể tạo commit lạ hoặc dừng
vì xung đột với thay đổi lỡ tay trên server. `reset --hard` khẳng định dứt khoát: **server
phải giống hệt origin, không có ngoại lệ.** Server không phải chỗ để sửa code.

An toàn vì `.env`, `logs/`, `dist/` đều nằm trong `.gitignore` — `reset --hard` không đụng
tới file bị ignore.

```bash
npm ci
```

`ci` khác `install`: nó xoá sạch `node_modules`, cài **đúng** theo `package-lock.json`, và
báo lỗi nếu lock file lệch với `package.json`. `install` thì có thể tự nâng version theo dải
`^` và sửa lock file. Trên server, "chạy được trên máy tôi" phải là "chạy được y hệt trên
server" — nên luôn là `ci`.

```bash
npm run migration:run       # trước
pm2 reload                  # sau
```

Thứ tự bắt buộc: schema phải sẵn sàng **trước** khi code mới nhận traffic. Đảo lại thì có một
khoảng thời gian code mới chạy trên schema cũ và đổ lỗi cột không tồn tại.

```bash
for _ in $(seq 1 10); do
  if curl -fsS http://127.0.0.1:3000/health > /dev/null; then ... fi
  sleep 2
done
exit 1
```

20 giây để app khởi động, không được thì `exit 1`. Đây là phần khiến script **trung thực**:
không có health check thì script luôn kết thúc thành công kể cả khi app chết ngay sau reload,
và bạn chỉ biết khi người dùng báo.

`-f` làm curl trả exit code khác 0 với HTTP 4xx/5xx (mặc định curl coi 500 là "thành công"
vì nó *có* nhận được phản hồi). Thiếu `-f` là health check luôn pass.

### 15. Cái bẫy `NODE_ENV=production`

Trực giác nói: server production thì `export NODE_ENV=production`. Đừng làm.

npm có config `omit`, và **mặc định của nó là `dev` khi `NODE_ENV=production`**. Nghĩa là
`npm ci` sẽ bỏ qua toàn bộ `devDependencies`, trong đó có `ts-node` và `typescript`. Mà
`package.json:22`:

```json
"typeorm": "typeorm-ts-node-commonjs -d src/database/data-source.ts"
```

`migration:run` cần `ts-node` để đọc file `.ts`. Thiếu → `deploy.sh:22` chết → deploy hỏng,
với thông báo lỗi chẳng liên quan gì tới NODE_ENV.

App vẫn nhận đúng `NODE_ENV=production` từ hai nguồn, không cần export:

- `.env` — dotenv nạp lúc app khởi động
- `ecosystem.config.js:11` — PM2 truyền vào tiến trình con

**Bài học rộng hơn:** biến môi trường của **shell** và biến môi trường của **ứng dụng** là
hai thứ khác nhau. Cùng một tên có thể mang ý nghĩa khác nhau với công cụ khác nhau, và
`NODE_ENV` là ví dụ điển hình — Node không quan tâm, nhưng npm thì có.

### 16. Checklist bảo mật của giai đoạn 3

- [x] IAM Role gắn qua instance profile, không có access key trên đĩa
- [x] Permission policy dùng lại nguyên xi từ giai đoạn 2 — không nới thêm quyền nào
- [x] Trust policy chỉ cho `ec2.amazonaws.com` assume
- [x] Security Group chỉ mở 22 (IP của bạn) / 80 / 443 — không mở 3000, không mở 3306
- [x] MySQL bind `127.0.0.1`, không phơi ra interface public
- [x] Deploy key **read-only**, phạm vi một repo, private key sinh trên EC2
- [x] Swap bật kèm `chmod 600`
- [x] `pm2 save` + `pm2 startup` đã kiểm chứng bằng một lần reboot thật
- [ ] Đã xoá access key của IAM User `aws-deployment-api-local` — **quay lại tick sau khi xác nhận**

Ô cuối cùng là ô còn nợ từ [giai đoạn 2](02-s3-va-iam.md#15-checklist-bảo-mật-của-giai-đoạn-2).
Xoá xong thì máy local không upload lên S3 thật được nữa — muốn dev tiếp thì chạy MinIO và
set `S3_ENDPOINT=http://127.0.0.1:9000`. Nhánh `forcePathStyle` ở
[`storage.module.ts:32`](../src/storage/storage.module.ts) tồn tại chính vì tình huống này.

---

## Điều quan trọng nhất của giai đoạn này

Nhìn lại `storage.module.ts:20-33`, đoạn code **không đổi một ký tự** giữa giai đoạn 2 và 3:

```ts
new S3Client({
  region: config.region,
  ...(config.accessKeyId && config.secretAccessKey
    ? { credentials: { ... } }
    : {}),
})
```

Giai đoạn 2 đi nhánh `true`. Giai đoạn 3 đi nhánh `false` và rơi xuống IMDS. Cùng một file
`dist/main.js`, cùng một commit, chạy ở hai nơi với hai cơ chế danh tính hoàn toàn khác nhau
— chỉ vì hai dòng trong `.env` để trống.

Đó là luận điểm của cả lộ trình, và giai đoạn 3 là chỗ nó được chứng minh rõ nhất.

---

## Tự kiểm tra

1. Trust policy và permission policy khác nhau thế nào? Thiếu mỗi cái cho ra **triệu chứng**
   gì khác nhau khi upload?
2. Vì sao nói "không thể lấy trộm một IAM Role"? Cái thật sự có thể bị lấy là gì, và vì sao
   nó ít nguy hiểm hơn `AKIA...`?
3. IMDSv2 bắt phải `PUT` xin token trước rồi mới `GET`. Ba rào cản của nó chặn được kiểu tấn
   công nào, và vì sao `GET` một bước lại nguy hiểm?
4. `169.254.169.254` có tính chất gì khiến không cần mở Security Group mà máy khác cũng không
   gọi vào được?
5. App này I/O-bound. Vì sao `instances: 'max'` lại là lựa chọn tệ, trong khi vẫn phải giữ
   `exec_mode: 'cluster'`?
6. `pm2 save` và `pm2 startup` — làm thiếu một trong hai thì reboot xong chuyện gì xảy ra?
7. `ufw deny 3306` **không** chặn được container Docker đã publish port 3306. Vì sao? Security
   Group của AWS có bị đi vòng như vậy không?
8. `deploy.sh` dùng `git reset --hard` thay cho `git pull`. Được gì, và vì sao `.env` trên
   server không bị xoá?
9. `export NODE_ENV=production` trên EC2 làm hỏng bước nào trong `deploy.sh`, và vì sao?
10. Tiến trình biến mất không để lại log nào trong log của chính nó. Nghi ngờ đầu tiên là gì,
    và tìm bằng chứng ở đâu?
