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
