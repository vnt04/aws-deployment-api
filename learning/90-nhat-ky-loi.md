# Nhật ký lỗi đã gặp

Ghi lại lỗi **thật đã gặp trong quá trình làm**, kèm cách suy luận ra nguyên nhân.
Bảng tra cứu lỗi đầy đủ theo giai đoạn nằm ở
[`docs/deployment.md` — Xử lý sự cố](../docs/deployment.md#xử-lý-sự-cố).

---

## Kỹ năng nền: lỗi này của ai?

Trước khi tra bất kỳ thông báo lỗi nào, hãy trả lời câu hỏi này trước — nó cắt bỏ 90% hướng
tìm kiếm sai:

```
Lỗi phát sinh Ở ĐÂU trong chuỗi này?

   curl          →    mạng     →   Nginx    →   Node/Nest   →   MySQL / S3
     │                  │            │             │                 │
 exit code        không kết       502/413      HTTP 4xx/5xx     lỗi driver /
 (curl: (N))      nối được                     có JSON body      AWS SDK
```

Dấu hiệu phân biệt nhanh:

| Bạn nhìn thấy | Lỗi thuộc về | Ý nghĩa |
|---------------|--------------|---------|
| `curl: (N) ...` | **client** | request **chưa** rời khỏi máy bạn |
| Không có phản hồi, treo | mạng / firewall | Security Group, port chưa mở |
| HTML lỗi của Nginx | Nginx | Node chưa chạy hoặc bị chặn ở proxy |
| JSON `{"success":false,...}` | **app của bạn** | request đã tới Nest, đã chạy qua exception filter |
| 500 + log có `AccessDenied` | AWS | IAM policy thiếu quyền |

Điểm mấu chốt: **`curl: (N)` và `HTTP 4xx/5xx` là hai thế giới khác nhau.** Cái đầu là curl
tự báo lỗi trước khi gửi; cái sau là server đã trả lời.

---

## Lỗi 1 — `curl: (26) Failed to open/read local data from file/application`

### Bối cảnh

Chạy lệnh kiểm tra của giai đoạn 2:

```bash
curl -X POST http://localhost:3000/users/1/avatar -F 'avatar=@./avatar.jpg'
curl: (26) Failed to open/read local data from file/application
```

### Chẩn đoán

Thông báo bắt đầu bằng `curl: (26)` → **exit code của curl**, không phải HTTP status.
Nghĩa là request chưa hề được gửi đi. API, S3, IAM đều không liên quan.

Cụm `local data from file` chỉ đúng một thứ: đối số `-F` có `@` — tức là đọc file từ đĩa.
Curl không mở được `./avatar.jpg`.

Kiểm chứng:

```bash
$ ls -la avatar.jpg
ls: cannot access 'avatar.jpg': No such file or directory
```

### Nguyên nhân

File không tồn tại. `./avatar.jpg` là đường dẫn **tương đối tính từ thư mục đang đứng khi
chạy lệnh**, không phải từ thư mục project.

Một nguyên nhân thứ hai cũng cho đúng lỗi này, dễ gặp trên Windows: **shell không hiểu nháy đơn.**
CMD và PowerShell không bóc `'...'` như bash, nên curl nhận nguyên chuỗi kèm dấu nháy và đi
tìm file tên `./avatar.jpg'` (có nháy ở cuối).

### Cách xử lý

```bash
# Bash / WSL / Git Bash — cd vào đúng chỗ, hoặc dùng đường dẫn tuyệt đối
cd ~/workspace/2026_projects/aws-deployment-api
curl -X POST http://localhost:3000/users/1/avatar -F "avatar=@./avatar.jpg"
```

```powershell
# PowerShell — dùng curl.exe (tránh alias Invoke-WebRequest) và nháy KÉP
curl.exe -X POST http://localhost:3000/users/1/avatar -F "avatar=@C:\path\to\avatar.jpg"
```

Tạo nhanh một ảnh để test:

```bash
python3 -c "
from PIL import Image
Image.new('RGB', (256, 256), (60, 110, 220)).save('avatar.jpg', 'JPEG')
"
```

### Rút ra

**Đọc tiền tố của thông báo lỗi trước khi đọc nội dung.** `curl: (26)` đã nói rõ chủ thể
báo lỗi là curl. Bỏ qua chi tiết đó rất dễ dẫn tới nửa tiếng đọc log NestJS, kiểm tra IAM
policy, thử lại bucket policy — trong khi vấn đề chỉ là thiếu một file trên máy.

Một số exit code curl hay gặp khác:

| Code | Nghĩa | Thường do |
|------|-------|-----------|
| 6 | Couldn't resolve host | sai tên miền, DNS chưa propagate (giai đoạn 5) |
| 7 | Failed to connect | server chưa chạy, sai port, Security Group chặn (giai đoạn 3) |
| 26 | Failed to open local file | file không tồn tại / sai đường dẫn / lỗi nháy trên Windows |
| 60 | SSL certificate problem | cert chưa hợp lệ (giai đoạn 5) |

---

## Lỗi 2 — Upload OK nhưng mở URL ảnh trả 403

### Bối cảnh

Đây là lỗi **được `docs/deployment.md` dự đoán trước**, nên nếu gặp thì không phải hoảng:

> Nếu (1) đúng mà (2) trả 403 → upload đã chạy được, chỉ thiếu bucket policy ở bước 2.2.

### Chẩn đoán

Hai sự kiện tưởng mâu thuẫn nhưng thực ra nhất quán:

```
App upload được   → IAM policy ĐÚNG   (identity-based, có PutObject)
Trình duyệt 403   → bucket policy THIẾU (resource-based, cần cho khách ẩn danh)
```

App đi bằng credential của IAM User. Trình duyệt ở chế độ ẩn danh **không có credential nào**
— với S3 nó là `Principal: *`, và chỉ bucket policy mới cấp quyền cho principal đó.

Giải thích đầy đủ ở [02-s3-va-iam.md § Quy tắc đánh giá](02-s3-va-iam.md#2-quy-tắc-đánh-giá--khi-nào-cần-cái-nào).

### Thứ tự kiểm tra

```
1. Block Public Access còn chặn "public bucket policies" không?  ← lớp ngoài cùng, thắng mọi policy
2. Bucket policy đã dán và Save chưa? Đã thay REPLACE_WITH_YOUR_BUCKET chưa?
3. Object có thật sự nằm dưới prefix users/ không? (policy chỉ mở users/*)
```

### Rút ra

Dùng **cửa sổ ẩn danh** để kiểm tra, không dùng tab thường. Tab thường có thể đang đăng nhập
AWS Console và truy cập được nhờ session đó — cho kết quả dương tính giả, tưởng đã public
mà thật ra chưa.

---

## Lỗi 3 — App không khởi động, báo `Cấu hình môi trường không hợp lệ`

### Bối cảnh

Sau khi điền `.env` cho giai đoạn 2:

```
Error: Cấu hình môi trường không hợp lệ:
  - S3_BUCKET: should not be empty
```

### Chẩn đoán

Đây **không phải lỗi** — đây là thiết kế đang làm đúng việc của nó. Xem
[`env.validation.ts:133`](../src/config/env.validation.ts): app kiểm tra toàn bộ biến môi
trường lúc boot và từ chối chạy nếu thiếu.

Thông báo đã chỉ đích danh biến nào thiếu. Việc cần làm là mở `.env` và điền.

### Rút ra

App chết lúc khởi động **tốt hơn nhiều** so với app chạy được rồi đổ 500 ở request đầu tiên
của người dùng thật. Khi thấy loại lỗi này, phản xạ đúng là đọc tên biến trong thông báo,
không phải đi tìm bug trong code.

Đối chiếu `.env` của bạn với [`.env.example`](../.env.example) là cách nhanh nhất để biết
còn thiếu gì.

---

## Lỗi 4 — Lệnh kiểm tra IMDS chạy lần đầu ra kết quả, chạy lần hai không in gì

### Bối cảnh

Kiểm tra IAM Role trên EC2 ở giai đoạn 3:

```
$ TOKEN=$(curl -sX PUT http://169.254.169.254/latest/api/token \
    -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')
$ curl -s -H "X-aws-ec2-metadata-token: $TOKEN" \
    http://169.254.169.254/latest/meta-data/iam/security-credentials/
aws-deployment-api-ec2ubuntu@ip-172-31-8-49:~$        ← lần 1

$ curl -s -H "X-aws-ec2-metadata-token: $TOKEN" ...
ubuntu@ip-172-31-8-49:~$                              ← lần 2, rỗng
```

### Chẩn đoán

Hai hiểu nhầm chồng lên nhau, và cả hai đều do **`curl -s` giấu thông tin**.

**Hiểu nhầm 1 — tưởng lần 1 cũng không in gì.** IMDS trả về chuỗi **không có ký tự xuống
dòng ở cuối**, nên kết quả dính liền vào prompt:

```
aws-deployment-api-ec2ubuntu@ip-172-31-8-49:~$
└────────┬───────────┘└──────────┬──────────┘
     kết quả                  prompt
```

Lần 1 đã thành công. Role đã gắn đúng.

**Hiểu nhầm 2 — tưởng lần 2 lỗi mạng.** Token xin với `ttl-seconds: 60`, tức sống 60 giây.
Gõ lệnh thứ hai sau đó là token đã hết hạn, IMDS trả `401 Unauthorized` với body rỗng.
`curl -s` không hiện status code, nên nhìn y hệt như không có phản hồi.

Kiểm chứng:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/iam/security-credentials/
# 401 → token hết hạn   |   200 → còn dùng được
```

### Nguyên nhân

TTL 60 giây quá ngắn cho thao tác gõ tay. Không phải lỗi cấu hình Role, không phải lỗi mạng.

### Cách xử lý

Xin token với TTL dài (tối đa 21600 giây = 6 giờ), và lấy luôn credential trong cùng một lần:

```bash
TOKEN=$(curl -sX PUT http://169.254.169.254/latest/api/token \
  -H 'X-aws-ec2-metadata-token-ttl-seconds: 21600')

ROLE=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/iam/security-credentials/)
echo "Role: $ROLE"

curl -s -H "X-aws-ec2-metadata-token: $TOKEN" \
  "http://169.254.169.254/latest/meta-data/iam/security-credentials/$ROLE" | python3 -m json.tool
```

### Rút ra

**`curl -s` là con dao hai lưỡi.** Nó tắt thanh tiến trình, nhưng cũng làm mọi lỗi HTTP trông
giống hệt "không có phản hồi". Khi kết quả bất ngờ, phản xạ đầu tiên nên là bỏ `-s` hoặc thêm
`-w '%{http_code}\n'` — biết được server trả 401 hay không trả gì là hai hướng điều tra khác hẳn nhau.

Kèm theo: **output không có newline là chuyện bình thường** với API kiểu này. Thấy chữ dính
vào prompt thì đó là dữ liệu, không phải rác. Thêm `; echo` vào cuối lệnh cho dễ đọc.

Giải thích vì sao IMDSv2 phải phiền phức như vậy: [03-ec2-va-iam-role.md § IMDS](03-ec2-va-iam-role.md#imds).

---

## Mẫu ghi lỗi mới

Copy khối này khi gặp lỗi ở các giai đoạn sau:

```markdown
## Lỗi N — <thông báo lỗi nguyên văn>

### Bối cảnh
Đang làm gì thì gặp. Lệnh chạy chính xác.

### Chẩn đoán
Lỗi thuộc tầng nào (client / mạng / Nginx / app / AWS)?
Bằng chứng nào chỉ ra điều đó?

### Nguyên nhân
Nguyên nhân thật, sau khi đã kiểm chứng — không phải phỏng đoán.

### Cách xử lý
Lệnh hoặc thao tác đã sửa được.

### Rút ra
Lần sau gặp triệu chứng tương tự thì nhìn vào đâu trước.
```
