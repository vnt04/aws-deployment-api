# Giai đoạn 2 — S3 và IAM

> Mục tiêu giai đoạn: máy local upload được file lên S3 thật.
> Đây là lần đầu chạm vào AWS, và phần lớn kiến thức thu được là về **quyền** chứ không phải về lưu trữ.

```
Laptop (NestJS)  ──PutObject──▶  S3 bucket
                                     │
Trình duyệt      ──GetObject───▶ ────┘  (ẩn danh, không có credential)
```

Hai mũi tên trên trông giống nhau nhưng đi qua **hai cơ chế cấp quyền hoàn toàn khác nhau**.
Hiểu được chỗ này là hiểu được 80% của giai đoạn 2.

---

## Phần I — Mô hình quyền của AWS

### 1. Hai loại policy: gắn vào *ai* và gắn vào *cái gì*

So sánh hai file trong [`deploy/aws/`](../deploy/aws/) — khác nhau đúng **một dòng**, và
dòng đó đổi hoàn toàn ý nghĩa:

```jsonc
// s3-iam-policy.json — IDENTITY-BASED, gắn vào IAM User/Role
{
  "Effect": "Allow",
  "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
  "Resource": "arn:aws:s3:::BUCKET/users/*"
  //  ← không có "Principal"
}

// s3-bucket-policy-public-read.json — RESOURCE-BASED, gắn vào bucket
{
  "Effect": "Allow",
  "Principal": "*",              // ← chính là dòng này
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::BUCKET/users/*"
}
```

**Vì sao IAM policy không cần `Principal`?** Vì nó được *gắn vào* một identity rồi —
principal chính là cái user đang mang policy đó. Còn bucket policy nằm trên resource, nên
bắt buộc phải nói rõ ai được vào. `"Principal": "*"` = bất kỳ ai, kể cả người không có
tài khoản AWS.

Ghi nhớ nhanh:

| | Gắn vào | Trả lời câu hỏi | Có `Principal`? |
|---|---|---|:---:|
| IAM policy | user / role / group | "*Tôi* được làm gì?" | không |
| Bucket policy | bucket | "Ai được vào *tôi*?" | có |

### 2. Quy tắc đánh giá — khi nào cần cái nào

Đây là chỗ dễ hiểu sai nhất:

| Tình huống | Cần gì để được phép |
|-----------|---------------------|
| IAM User **cùng account** với bucket | Allow ở **identity policy HOẶC** bucket policy — một cái là đủ |
| Truy cập **ẩn danh** (không có credential) | **Chỉ** bucket policy — không có identity nào để gắn IAM policy |
| **Cross-account** (account khác) | Cần **cả hai** cùng Allow |
| Bất kỳ tình huống nào | Một `Deny` tường minh ở bất kỳ đâu → **chặn**, thắng mọi Allow |

Áp vào project:

```
App upload  → IAM User của mình, cùng account với bucket
            → IAM policy cho PutObject là đủ. Bucket policy không liên quan.

Xem ảnh     → trình duyệt ẩn danh, không có credential nào
            → chỉ bucket policy mới cứu được. IAM policy vô nghĩa ở đây.
```

Điều này giải thích chính xác dòng ghi trong `docs/deployment.md`:

> Nếu (1) đúng mà (2) trả 403 → upload đã chạy được, chỉ thiếu bucket policy ở bước 2.2.

Upload thành công chứng minh IAM policy đúng. Ảnh 403 chứng minh bucket policy thiếu.
**Hai lỗi độc lập, hai chỗ sửa khác nhau** — và biết được điều đó chỉ bằng cách đọc triệu chứng.

### 3. Đọc ARN

```
arn:aws:s3:::my-bucket/users/*
│   │   │  │ │ │
│   │   │  │ │ └── path bên trong bucket, có wildcard
│   │   │  │ └──── tên bucket
│   │   │  └────── account id — S3 để TRỐNG
│   │   └───────── region — S3 để TRỐNG
│   └───────────── partition (aws / aws-cn / aws-us-gov)
└───────────────── luôn là "arn"
```

**Vì sao S3 bỏ trống region và account?** Vì tên bucket là **duy nhất trên toàn cầu** —
biết tên là định danh được, không cần thêm gì. Đây cũng là lý do bạn phải nghĩ ra tên
kiểu `aws-deployment-api-<tên>-01`: bạn đang tranh giành namespace với toàn thế giới.

Hầu hết service khác thì ngược lại, ví dụ RDS ở giai đoạn 6:
`arn:aws:rds:ap-southeast-1:123456789012:db:mydb` — có đủ region và account.

Bẫy hay gặp: **`bucket` và `bucket/*` là hai resource khác nhau.**

```
arn:aws:s3:::my-bucket        → chính cái bucket (cho ListBucket, GetBucketLocation)
arn:aws:s3:::my-bucket/*      → các object bên trong (cho GetObject, PutObject)
```

Viết `Resource: "arn:aws:s3:::my-bucket"` rồi cấp `s3:PutObject` sẽ **không chạy** — sai
cấp độ resource. Đây là nguyên nhân kinh điển của AccessDenied lúc mới học.

### 4. IAM User vs IAM Role {#iam-user-vs-iam-role}

Giai đoạn 2 dùng **IAM User + access key**. Giai đoạn 3 sẽ **xoá hẳn** và thay bằng **IAM Role**.
Không phải làm lại cho vui — hai thứ giải quyết hai hoàn cảnh khác nhau:

| | IAM User + access key | IAM Role |
|---|---|---|
| Dùng khi | code chạy **ngoài** AWS | code chạy **trên** AWS |
| Credential | cố định, sống mãi đến khi bạn xoá | tạm thời, AWS tự xoay vòng |
| Nằm ở đâu | file `.env` trên đĩa | trong bộ nhớ, lấy từ instance metadata |
| Lộ ra ngoài thì | kẻ khác dùng được vô thời hạn | hết hạn sau vài giờ |
| Xoay vòng | bạn phải tự làm | tự động |

Laptop của bạn không phải là tài nguyên AWS nên **không thể** gắn Role — không có chỗ nào
để AWS nhận diện "máy này là của tôi". Đó là lý do bắt buộc phải dùng access key ở giai đoạn 2.
Nhưng EC2 thì có: nó *là* tài nguyên AWS, có instance metadata, nên gắn Role được.

**Quy tắc chung: có Role thì không bao giờ dùng access key.** Access key rò rỉ là nguyên nhân
số một của các sự cố bảo mật AWS — chúng nằm trong `.env`, trong git history, trong ảnh
chụp màn hình, trong log CI. Bot quét GitHub tìm chuỗi `AKIA...` liên tục, và tiền hoá đơn
đào coin sẽ về tài khoản bạn.

### 5. Credential chain — vì sao "để trống" lại đúng

Đoạn code làm cho cả hai giai đoạn dùng chung một codebase, ở
[`src/storage/storage.module.ts:22-30`](../src/storage/storage.module.ts):

```ts
new S3Client({
  region: config.region,
  // Không set credentials -> SDK tự lấy từ IAM Role của EC2 (instance metadata).
  ...(config.accessKeyId && config.secretAccessKey
    ? { credentials: { accessKeyId: ..., secretAccessKey: ... } }
    : {}),
})
```

Khi **không** truyền `credentials`, AWS SDK đi tìm theo thứ tự (rút gọn):

```
1. Tham số truyền thẳng vào client        ← giai đoạn 2 dừng ở đây
2. Biến môi trường AWS_ACCESS_KEY_ID/...
3. File ~/.aws/credentials
4. Instance metadata (IMDS) của EC2       ← giai đoạn 3 dừng ở đây
```

Nên trên EC2, để trống access key không phải là "thiếu cấu hình" — nó là cách **nói với SDK
rằng hãy đi xuống bước 4**. Credential lấy từ IMDS là token tạm thời, tự hết hạn và tự làm mới.

Đây chính là "code không đổi, chỉ đổi cấu hình" thể hiện bằng một biểu thức ternary.

Nhớ lại `isBlank()` ở [giai đoạn 1](01-nestjs-va-nen-mong.md#2-cấu-hình-validate-lúc-khởi-động-không-phải-lúc-dùng):
nó biến `AWS_ACCESS_KEY_ID=` (chuỗi rỗng) thành `undefined`. Không có nó, biểu thức trên
sẽ thấy chuỗi rỗng là falsy — may là vẫn đúng — nhưng `@IsString()` phía validate sẽ
lấn cấn. Hai mảnh này khớp với nhau có chủ đích.

### 6. Least privilege trong thực tế

IAM policy của project cố tình **hẹp** ở cả ba chiều:

```jsonc
"Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],   // ← đúng 3 việc
"Resource": "arn:aws:s3:::BUCKET/users/*"                        // ← đúng 1 prefix
```

| Chiều | Có | Không có | Hệ quả nếu key bị lộ |
|-------|-----|----------|----------------------|
| Action | 3 action object | `s3:*`, `s3:ListBucket` | không xoá được bucket, không đổi được policy |
| Resource | `BUCKET/users/*` | bucket khác, prefix khác | không chạm được dữ liệu ngoài avatar |
| Liệt kê | — | `s3:ListBucket` | **không biết trong bucket có gì** |

Chi tiết `s3:ListBucket` đáng nói riêng. Thiếu nó nghĩa là kẻ cầm key chỉ lấy được file
nếu **đoán đúng key chính xác**. Không liệt kê được thì không dò được. Đây là lý do
`aws s3 ls s3://bucket` sẽ báo AccessDenied — **đúng như thiết kế**, không phải cấu hình sai.

Nguyên tắc để mang sang các giai đoạn sau: **bắt đầu từ không có quyền gì, thêm từng quyền
khi thực sự bị chặn.** Ngược lại với thói quen cấp `s3:*` cho chạy được rồi tính sau — vì
"tính sau" gần như không bao giờ xảy ra.

### 7. Block Public Access — bốn công tắc, hai con đường

Đây là chỗ `docs/deployment.md` gọi là "dễ sai nhất". Cấu hình của project:

| Công tắc | Trạng thái | Nghĩa là |
|----------|-----------|----------|
| Block ... through **new ACLs** | ✅ giữ | không ai đặt ACL public mới được |
| Block ... through **any ACLs** | ✅ giữ | ACL public có sẵn cũng bị bỏ qua |
| Block ... through **new public bucket policies** | ⬜ bỏ | cho phép tạo bucket policy public |
| Block ... through **any public bucket policies** | ⬜ bỏ | cho phép policy public hoạt động |

Bốn công tắc chia làm hai cặp vì S3 có **hai cơ chế phân quyền song song**:

```
ACL           — cũ, phân quyền theo TỪNG FILE, rời rạc, khó kiểm toán
Bucket policy — mới, phân quyền TẬP TRUNG bằng JSON, review được trong git
```

Cấu hình trên = **chặn đường ACL, mở đường policy**. Kết quả: muốn biết file nào đang public,
chỉ cần đọc một file JSON. Không thể có chuyện ai đó lỡ tay set ACL public cho một object
lẻ và không ai phát hiện.

AWS khuyến nghị tắt hẳn ACL (Object Ownership = "ACLs disabled") — project đã theo mặc định này.

**Block Public Access đứng *trên* mọi policy.** Bật nó lên thì bucket policy public sẽ bị
vô hiệu dù viết đúng. Thứ tự kiểm tra khi ảnh trả 403:

```
1. Block Public Access có đang chặn policy không?   ← lớp ngoài cùng
2. Bucket policy đã apply chưa, tên bucket đúng chưa?
3. Object có thật sự nằm trong prefix users/ không?
```

---

## Phần II — Luồng upload trong code

### 8. Database lưu URL, không lưu binary

```
Client ──▶ NestJS ──▶ S3 PutObject ──▶ URL ──▶ MySQL (cột avatar_url)
```

Cột `avatar_url` là `varchar(512)`
([`user.entity.ts:22`](../src/users/entities/user.entity.ts)) — chỉ một chuỗi text.

**Vì sao không nhét ảnh vào MySQL dạng BLOB?**

| | File trên S3 | BLOB trong MySQL |
|---|---|---|
| Chi phí lưu trữ | rẻ | đắt (dung lượng RDS) |
| Backup | không ảnh hưởng | mỗi snapshot phình theo ảnh |
| Đọc | client tải thẳng, không qua app | phải đi qua app, chiếm connection |
| Scale | S3 lo | tự lo |
| CDN | đặt trước S3 là xong | phải tự cache |

Điểm nặng nhất là hàng "Đọc". Ảnh nằm trong DB thì mỗi lần hiển thị avatar là một truy vấn
chiếm một connection trong pool (project để `connectionLimit: 10`). Một trang có 50 avatar
sẽ ăn sạch pool. Với S3, request ảnh **không chạm vào app một lần nào**.

Nguyên tắc chung: **database giữ metadata, object storage giữ bytes.**

### 9. Key có cấu trúc quyết định được cả policy lẫn nghiệp vụ

```ts
const key = `users/${id}/avatar.${imageType.extension}`;
// → users/1/avatar.jpg
```

Một dòng nhưng gánh nhiều việc:

- **Prefix `users/`** khớp đúng với `Resource` trong cả hai policy. Cấu trúc key
  *là* biên giới bảo mật — đổi key thành `avatars/1.jpg` là policy hết tác dụng ngay.
- **Có `id`** nên không bao giờ đụng nhau giữa các user.
- **Tất định** (deterministic) — cùng user + cùng định dạng luôn ra cùng key, nên upload lại
  là ghi đè. Không tích tụ rác.

**Cái giá của tính tất định**, và code xử lý nó ở
[`users.service.ts:113-115`](../src/users/users.service.ts):

```ts
if (user.avatarUrl && user.avatarUrl !== avatarUrl) {
  await this.removeStoredAvatar(user.avatarUrl);
}
```

Upload JPEG rồi upload PNG → key đổi từ `avatar.jpg` sang `avatar.png` → file `.jpg` cũ
**không bị ghi đè**, nó nằm lại đó vĩnh viễn nếu không dọn. Điều kiện `!==` chính là để bắt
đúng trường hợp đổi định dạng: cùng định dạng thì URL giống nhau, không cần xoá (mà xoá là
sai — vừa ghi đè xong lại tự xoá file mới).

### 10. Thao tác dọn dẹp không được làm hỏng nghiệp vụ chính

[`storage.service.ts:42-51`](../src/storage/storage.service.ts):

```ts
/** Xoá file cũ là thao tác dọn dẹp — lỗi ở đây không được làm hỏng request chính. */
async deleteObjectQuietly(key: string): Promise<void> {
  try {
    await this.s3Client.send(new DeleteObjectCommand({ ... }));
  } catch (error) {
    this.logger.warn(`Xoá object S3 thất bại: ${key}`, ...);
  }
}
```

So sánh với `putObject()` ngay bên trên — cũng `try/catch`, nhưng **ném lỗi ra**
(`InternalServerErrorException`).

Hai cách xử lý khác nhau vì hai loại lỗi khác nhau về hậu quả:

| Thao tác | Hỏng thì sao | Xử lý |
|----------|-------------|-------|
| `putObject` | user **không có** avatar mới → nghiệp vụ thất bại | ném lỗi, trả 500 |
| `deleteObject` | còn một file thừa trên S3 → tốn vài KB | ghi log, đi tiếp |

Nếu để `deleteObjectQuietly` ném lỗi, kết quả sẽ rất tệ: ảnh **đã** upload thành công, DB
**đã** cập nhật, nhưng user nhận về 500 và tưởng thất bại. Họ upload lại — và lại 500. Một
thao tác dọn rác không thành công đã phá hỏng một nghiệp vụ đã hoàn tất.

Đây là dạng lỗi hay gặp trong code thật, thường được gọi là **để lỗi phụ giết chết luồng chính**.
Câu hỏi cần đặt cho mỗi `catch`: *"lỗi này có làm mục tiêu của request thất bại không?"*
Không → log rồi đi tiếp. Có → ném ra.

Lưu ý cách đặt tên: hậu tố `Quietly` báo cho người gọi biết hàm này **nuốt lỗi** — đó là
hợp đồng của nó, không phải sơ suất.

### 11. Magic bytes: không tin gì client nói

[`src/storage/image-type.ts`](../src/storage/image-type.ts) đọc vài byte đầu của file
thay vì tin `Content-Type`:

```ts
const JPEG = [0xff, 0xd8, 0xff] as const;
const PNG  = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const RIFF = [0x52, 0x49, 0x46, 0x46] as const;   // "RIFF"
const WEBP = [0x57, 0x45, 0x42, 0x50] as const;   // "WEBP" ở offset 8
```

**Vì sao không dùng `file.mimetype` của multer?** Vì giá trị đó do **client tự khai**, nằm
trong phần header của multipart request. Sửa nó dễ hơn sửa tên file:

```bash
# File PHP, nhưng khai là ảnh JPEG — multer sẽ tin
curl -F 'avatar=@shell.php;type=image/jpeg' http://localhost:3000/users/1/avatar
```

Đuôi file cũng vậy, đổi tên là xong. Chỉ có **nội dung** file là không nói dối được: file
JPEG thật *phải* bắt đầu bằng `FF D8 FF`.

Chuỗi hệ quả nếu bỏ qua bước này:

```
File .php khai là image/jpeg
  → lưu lên S3 với key users/1/avatar.jpg và Content-Type: image/jpeg
  → nếu sau này có nơi nào phục vụ file này như code → thực thi mã của kẻ tấn công
  → nếu là SVG chứa <script> và trả về text/html → XSS trên chính domain của bạn
```

Chú ý `detectImageType()` trả về **cả** `mimeType` và `extension`, và cả hai đều lấy từ
kết quả nhận diện, không lấy từ input:

```ts
const key = `users/${id}/avatar.${imageType.extension}`;   // đuôi do server quyết định
await this.storageService.putObject({
  contentType: imageType.mimeType,                          // header do server quyết định
  ...
});
```

Nghĩa là **tên file client gửi lên không hề được dùng**. Đây cũng là cách chặn luôn
path traversal — client đặt tên `../../etc/passwd` cũng vô nghĩa vì tên đó bị vứt bỏ.

WEBP cần kiểm tra hai đoạn (`RIFF` ở offset 0 và `WEBP` ở offset 8) vì RIFF là container
dùng chung cho nhiều định dạng — WAV cũng bắt đầu bằng `RIFF`.

### 12. Nhiều lớp giới hạn, mỗi lớp ở đúng chỗ

| Lớp | Ở đâu | Chặn gì |
|-----|-------|---------|
| `limits.fileSize` | [`users.controller.ts:60`](../src/users/users.controller.ts) | file > 5MB |
| `limits.files: 1` | cùng chỗ | gửi nhiều file một lúc |
| `detectImageType` | [`users.service.ts:92`](../src/users/users.service.ts) | định dạng không phải ảnh |
| `!file?.buffer?.length` | [`users.service.ts:88`](../src/users/users.service.ts) | không gửi file, hoặc file rỗng |

Thứ tự có chủ đích: giới hạn **rẻ nhất chặn trước**. Multer từ chối file 100MB ngay ở tầng
network, trước khi đọc hết vào RAM. Kiểm tra magic bytes chỉ chạy trên file đã qua cửa kích thước.

`MAX_AVATAR_BYTES = 5 * 1024 * 1024` đặt ở
[`storage.constants.ts:4`](../src/storage/storage.constants.ts) — một hằng số có tên, không
phải số ma rải rác. **Ghi nhớ cho giai đoạn 4:** Nginx có `client_max_body_size` riêng và
mặc định chỉ **1MB**. Không sửa cho khớp thì file 3MB bị Nginx chặn bằng `413` trước khi
tới Node — và log của Node sẽ hoàn toàn trống, rất khó đoán.

### 13. Một trade-off cần biết: cache dài + key cố định

[`storage.service.ts:30`](../src/storage/storage.service.ts):

```ts
CacheControl: 'public, max-age=31536000, immutable',   // 1 năm
```

Header này rất tốt cho hiệu năng — trình duyệt và CDN không hỏi lại trong một năm. Nhưng
đặt cạnh key tất định (`users/1/avatar.jpg` không đổi khi upload lại ảnh cùng định dạng)
thì sinh ra hệ quả:

```
User upload ảnh A  → users/1/avatar.jpg, trình duyệt cache 1 năm
User upload ảnh B  → S3 đã có ảnh B, nhưng URL y hệt
                   → trình duyệt vẫn hiện ảnh A
```

Đây là trade-off có thật của thiết kế hiện tại, không phải bug — ở phạm vi học tập thì chấp
nhận được (xoá cache trình duyệt là thấy ảnh mới). Nếu sau này cần sửa, ba hướng thông dụng:

1. Thêm version vào key: `users/1/avatar-<timestamp>.jpg` — URL đổi nên cache tự hết hiệu lực
2. Thêm query string vào URL lưu trong DB: `...avatar.jpg?v=1706...`
3. Giảm `max-age` và bỏ `immutable`

Hướng 1 sạch nhất nhưng phải chắc chắn dọn file cũ, nếu không S3 sẽ tích rác theo mỗi lần upload.

---

## Phần III — Vệ sinh bảo mật

### 14. Secret không bao giờ vào git

Đã kiểm chứng ở repo này:

```bash
$ git check-ignore -v .env
.gitignore:6:.env    .env      # ✅ đang bị ignore
```

`.gitignore` còn chặn sẵn `*.pem` (key SSH của giai đoạn 3) và `.aws/`.

Điều quan trọng cần hiểu: **git ghi nhớ vĩnh viễn.** Lỡ commit access key rồi xoá ở commit
sau thì key vẫn nằm trong history, và ai clone repo cũng lấy được. Xoá thật đòi hỏi viết
lại history (`git filter-repo`) và force-push — phá vỡ mọi bản clone khác.

Nên khi lỡ commit secret, thứ tự đúng là:

```
1. Vô hiệu hoá key ngay trên AWS Console   ← làm TRƯỚC, quan trọng nhất
2. Tạo key mới, cập nhật .env
3. Rồi mới tính chuyện dọn git history
```

Bước 1 làm cho key bị lộ trở thành vô giá trị, nên nó khẩn cấp hơn bước 3 nhiều.

`.env.example` tồn tại để giải quyết mâu thuẫn: cần chia sẻ **danh sách biến** nhưng không
chia sẻ **giá trị**. File này vào git, chỉ chứa tên biến và giá trị mẫu.

### 15. Checklist bảo mật của giai đoạn 2

- [x] IAM User không có quyền đăng nhập Console (chỉ dùng cho code)
- [x] IAM policy chỉ 3 action, giới hạn trong `users/*`, không có `ListBucket`
- [x] Bucket policy chỉ mở `s3:GetObject`, không mở quyền ghi
- [x] Block Public Access: chặn ACL, chỉ mở đường policy
- [x] `.env` đã bị `.gitignore` (đã verify bằng `git check-ignore`)
- [x] Định dạng file xác thực bằng magic bytes, không tin `Content-Type`
- [x] Tên file client gửi lên bị bỏ hoàn toàn, key do server sinh
- [ ] Xoá access key này sau khi xong giai đoạn 3 — **nhớ quay lại tick ô này**

---

## Tự kiểm tra

1. Upload trả về `avatarUrl` bình thường, nhưng mở URL đó bằng cửa sổ ẩn danh thì 403.
   Sai ở đâu, và **vì sao** upload lại không bị ảnh hưởng?
2. `s3:ListBucket` bị cố tình bỏ ra khỏi policy. Kẻ lấy được access key sẽ **không** làm được gì?
3. Trên EC2 (giai đoạn 3), để trống `AWS_ACCESS_KEY_ID` thì SDK lấy credential ở đâu và
   theo thứ tự nào?
4. Vì sao `deleteObjectQuietly` nuốt lỗi còn `putObject` ném lỗi? Đảo ngược lại thì user gặp gì?
5. `Resource` viết `arn:aws:s3:::my-bucket` thay vì `arn:aws:s3:::my-bucket/*` thì hỏng chuyện gì?
6. User upload ảnh JPEG mới đè lên ảnh JPEG cũ. Vì sao có thể vẫn thấy ảnh cũ trên trình duyệt?
