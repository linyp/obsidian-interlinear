<h1 align="center">Interlinear</h1>

<p align="center">
  Dịch đối chiếu theo từng đoạn trong chế độ đọc của <a href="https://obsidian.md">Obsidian</a>
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <strong>Tiếng Việt</strong>
</p>

<p align="center">
  <img src="images/interlinear-bilingual.png" alt="Interlinear hiển thị bản dịch song ngữ theo từng đoạn trong Obsidian" width="900">
</p>

Plugin **dịch đối chiếu theo từng đoạn** dành cho chế độ đọc của
[Obsidian](https://obsidian.md). Mở một ghi chú bằng ngoại ngữ rồi nhấn nút dịch;
Interlinear sẽ hiển thị bản dịch tiếng Việt hoặc ngôn ngữ đích bất kỳ ngay bên dưới
từng đoạn gốc. Bạn có thể xem song ngữ hoặc chỉ xem bản dịch.

> Giao diện plugin hiện vẫn dùng tiếng Anh. Tên cài đặt và lệnh trong README này được
> giữ giống giao diện tiếng Anh thực tế để bạn dễ tìm.

## Thiết kế ưu tiên an toàn

- **Không bao giờ sửa ghi chú.** Bản dịch chỉ được chèn vào DOM ở lớp hiển thị. Khi
  đóng rồi mở lại ghi chú, tệp Markdown trên đĩa vẫn giữ nguyên từng byte.
- **Không bao giờ tự động dịch.** Việc mở hoặc chuyển ghi chú, cuộn trang, thay đổi bố
  cục hay cài đặt đều không gửi yêu cầu dịch. Bản dịch chỉ bắt đầu khi bạn chủ động dùng
  nút nổi, thanh trạng thái hoặc bảng lệnh.
- **BYOK, không telemetry.** API key và thông tin xác thực ứng dụng chỉ được lưu trong
  tệp cài đặt plugin bên trong Vault và chỉ được gửi đến dịch vụ dịch mà bạn chọn.
- **Chỉ dành cho chế độ đọc.** Chế độ chỉnh sửa và Live Preview không nằm trong phạm vi hỗ trợ.

## Tính năng chính

- **Dịch toàn bộ ghi chú bằng một lần nhấn.** Trên máy tính, dùng thanh trạng thái; trên
  thiết bị di động, dùng nút nổi ở góc dưới bên phải. Tiến độ theo lô (`3/12`, v.v.) được
  hiển thị trong lúc dịch.
- **Hai chế độ hiển thị.** Chuyển ngay giữa chế độ song ngữ (nguyên văn + bản dịch) và
  chế độ chỉ bản dịch mà không cần dịch lại. Ở chế độ chỉ bản dịch, rê chuột hoặc chạm
  vào bản dịch để xem nhanh nguyên văn.
- **Năm kiểu trình bày.** Viền, khối trích dẫn, chữ mờ, gạch chân nét đứt và mặt nạ học
  tập có thể được chuyển đổi tức thì chỉ bằng CSS.
- **Bộ nhớ đệm dịch lâu dài.** Kết quả được đánh khóa bằng hash nội dung và lưu trong
  `cache.json` của thư mục plugin. Điều này giúp tránh trả phí và chờ đợi khi dịch lại;
  nguyên văn của bạn không được lưu trong cache.
- **Tương thích với cơ chế hiển thị ảo của Obsidian.** Các đoạn đang nhìn thấy được dịch
  ngay, phần còn lại được dịch trước vào cache, rồi bản dịch đã lưu được chèn khi bạn cuộn.
- **Bỏ qua nội dung không nên dịch.** Bao gồm mã nguồn, công thức, khối chỉ có hình ảnh,
  URL, khối chỉ có ký hiệu hoặc chữ số, và nội dung có thể xác định an toàn là đã ở ngôn
  ngữ đích. Với các ngôn ngữ dùng chung bảng chữ cái Latin như tiếng Việt, plugin xử lý
  thận trọng và vẫn dịch thay vì đoán sai ngôn ngữ chỉ dựa trên bảng chữ cái.
- **Nhiều backend có thể thay thế.** Hỗ trợ DeepSeek, OpenAI, SiliconFlow, Ollama, endpoint
  tương thích OpenAI tùy chỉnh, Baidu Translate (百度翻译) và Youdao (有道智云). Mọi yêu cầu
  mạng đều dùng `requestUrl` của Obsidian.
- **Preset ngôn ngữ đích.** Có sẵn tiếng Việt (`vi`), tiếng Nhật (`ja`), tiếng Hàn (`ko`),
  tiếng Trung giản thể/phồn thể, tiếng Anh và nhiều ngôn ngữ khác. Bạn cũng có thể nhập mã
  ngôn ngữ tùy chỉnh.

## Mạng, tài khoản và quyền riêng tư

- **Sử dụng dịch vụ từ xa.** Plugin chỉ gửi các đoạn cần dịch đến dịch vụ đang chọn khi
  bạn chủ động dịch hoặc nhấn **Test connection**.
- **Cần có tài khoản.** Bạn tự cung cấp API key hoặc thông tin xác thực ứng dụng của dịch
  vụ đã chọn. Chi phí do nhà cung cấp đó tính, không phải Interlinear.
- **Không telemetry.** Plugin không thu thập thống kê sử dụng và không gửi dữ liệu phân tích.
- Cài đặt được lưu trong `data.json`, bản sao lưu một lần trước khi di chuyển cài đặt có thể
  nằm trong `data.backup.json`, còn cache bản dịch nằm trong `cache.json`. Tất cả đều ở trong
  thư mục plugin.
- Khi đồng bộ Vault, thông tin xác thực cũng được đồng bộ đến các thiết bị khác. Nếu quản lý
  Vault bằng Git, hãy thêm ít nhất `.obsidian/plugins/interlinear/data.json` và
  `.obsidian/plugins/interlinear/data.backup.json` vào `.gitignore`.

## Cài đặt

### Cài từ Obsidian (khuyên dùng)

1. Mở **Settings → Community plugins → Browse**.
2. Tìm **Interlinear**, sau đó chọn **Install** và **Enable**.

Hoặc mở [trang thư mục plugin](https://obsidian.md/plugins?id=interlinear) và nhấn
**Install**.

### Nâng cấp từ v0.2.5 lên v0.3.0

v0.3.0 sử dụng settings schema v2. Cài đặt phẳng của v0.2.5 được di chuyển một lần;
dữ liệu gốc được lưu vào `data.backup.json` trước khi `data.json` được ghi lại.

Nếu bạn đồng bộ cài đặt plugin, hãy cập nhật Interlinear trên **mọi thiết bị được đồng bộ
trước khi thay đổi bất kỳ cài đặt nào**. Không hỗ trợ chạy lẫn nhiều phiên bản plugin hoặc
hạ cấp sau khi di chuyển.

### BRAT / cài đặt thủ công

- Để nhận bản mới trước khi xuất hiện trong thư mục chính thức, cài
  [BRAT](https://github.com/TfTHacker/obsidian42-brat), chạy lệnh
  **BRAT: Add a beta plugin for testing**, rồi nhập `linyp/obsidian-interlinear`.
- Để cài thủ công, tải `main.js`, `manifest.json` và `styles.css` từ
  [bản phát hành mới nhất](https://github.com/linyp/obsidian-interlinear/releases/latest),
  sau đó đặt chúng vào `<your-vault>/.obsidian/plugins/interlinear/`.

## Cấu hình

Mở **Settings → Interlinear**.

| Cài đặt | Mặc định | Ghi chú |
| --- | --- | --- |
| Service | DeepSeek | Chọn LLM hoặc dịch máy truyền thống. Mỗi preset giữ riêng thông tin xác thực và thiết lập nâng cao. |
| API key _(chỉ LLM)_ | _trống_ | API key của dịch vụ LLM đã chọn. |
| App ID + secret _(Baidu / Youdao)_ | _trống_ | Cặp thông tin xác thực từ bảng điều khiển nhà phát triển của dịch vụ. |
| Base URL _(chỉ LLM)_ | `https://api.deepseek.com` | Endpoint tương thích OpenAI. |
| Model _(chỉ LLM)_ | `deepseek-v4-flash` | Tên model được sử dụng. |
| Test connection | — | Gửi một yêu cầu nhỏ để kiểm tra thông tin xác thực và kết nối. |
| Target language | `zh-CN` | Chọn preset như `vi`, `ja`, `ko` hoặc nhập mã ngôn ngữ tùy chỉnh. |
| Default display mode | Bilingual | Cách hiển thị sau lần dịch đầu tiên. |
| Translation style | Border | Kiểu trình bày bản dịch. |
| Floating button | Mobile only | Always / mobile only / never. |
| Concurrency | 10 | Số yêu cầu tối đa đang chạy đồng thời. |
| Min interval (ms) | 0 | Khoảng cách giữa thời điểm bắt đầu các yêu cầu. |
| Max retries | 3 | Số lần thử lại khi gặp lỗi 429 hoặc lỗi tạm thời. |
| Batch char budget | 4000 | Số ký tự tối đa được gom vào một yêu cầu. |
| Max segments per request | 12 | Số khối tối đa được gom vào một yêu cầu. |
| Custom instructions _(chỉ LLM)_ | _trống_ | Thêm thuật ngữ, giọng văn hoặc hướng dẫn theo lĩnh vực vào prompt. Nội dung này cũng thuộc định danh cache. |
| Persistent cache | On | Giữ cache bản dịch sau khi khởi động lại. |

## Cách sử dụng

1. Mở ghi chú và chuyển sang **reading view**.
2. Trên máy tính, nhấn **Translate** ở thanh trạng thái; trên thiết bị di động, nhấn nút
   nổi ở góc dưới bên phải.
3. Nhấn lại để chuyển giữa bản dịch và nguyên văn.
4. Dùng nút chế độ để chuyển giữa **bilingual** và **translation-only**. Thao tác này không
   tạo yêu cầu dịch mới.

Bảng lệnh cung cấp các lệnh sau. Plugin không đặt phím tắt mặc định.

- **Interlinear: Translate / show original**
- **Interlinear: Toggle display mode (bilingual / translation-only)**
- **Interlinear: Clear translations**

## Phát triển

Xem hướng dẫn build, kiểm thử, phát hành và kiến trúc tại
[mục Develop trong README tiếng Anh](README.md#develop).

## Giới hạn

- Chỉ hỗ trợ chế độ đọc; không hỗ trợ chế độ chỉnh sửa hoặc Live Preview.
- Danh sách và bảng được dịch như một khối. Danh sách phẳng được dựng lại dưới dạng danh sách,
  nhưng cấu trúc lồng nhau không được khôi phục đầy đủ.

## Giấy phép

MIT
