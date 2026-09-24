# CLAUDE.md

Hướng dẫn cho Claude Code (và người đóng góp) khi làm việc trong repo này.

## Dự án là gì

**SearchDriverPC** — ứng dụng desktop Windows quét phần cứng, tìm thiết bị thiếu/lỗi driver, tra
tên hãng/chip offline, dẫn tới trang driver chính chủ, tìm + tải gói driver đã ký từ Microsoft Update
Catalog, và sao lưu (export) driver đang cài. **App không bao giờ tự cài driver hay chạy file tải về.**

## Yêu cầu tính năng (đã chốt)

1. **Quét phần cứng** qua WMI `Win32_PnPEntity` (PowerShell `Get-CimInstance`): tên, Hardware ID,
   `ConfigManagerErrorCode` → trạng thái `ok` / `missing` / `error` / `disabled`. Bỏ qua thiết bị không
   kết nối (`Present=false`, Code 45). Kèm hãng máy/bo mạch (`Win32_ComputerSystem`, `Win32_BaseBoard`).
2. **Tra cứu VEN/DEV offline** bằng `resources/pci.ids` + `resources/usb.ids` → tên hãng chip, tên chip,
   hãng OEM theo `SUBSYS`.
3. **Bảng thiết bị**: Tên – Trạng thái – Hãng – Loại – nút "Mở trang tải driver" (trang chính chủ của
   hãng chip / OEM / Microsoft Update Catalog). Lọc theo trạng thái, tìm theo tên/hãng/Hardware ID,
   dark/light mode, mở rộng dòng xem chi tiết.
4. **Kiểm tra qua Windows Update**: COM `Microsoft.Update.Session` tìm driver optional
   (`IsInstalled=0 and Type='Driver'`) — chỉ tìm, không tải/cài; nút mở Settings › Optional updates.
5. **Xuất danh sách** thiết bị có vấn đề ra `.csv` (UTF-8 BOM) / `.txt`.
6. **Tìm & tải driver (không cài)** từ Microsoft Update Catalog: theo từng gói, theo thiết bị
   ("Tìm & tải"), hoặc hàng loạt. **Mỗi lần tải đều hỏi thư mục lưu** (mặc định: lần trước).
   Mỗi gói phải qua: host Microsoft + `.cab` → SHA-256 khớp catalog → chữ ký Authenticode `Valid` do
   Microsoft ký → giải nén bằng `expand.exe` → `.inf` chứa Hardware ID thiết bị. Chế độ tự động thử
   tối đa 3 gói, xóa gói không khớp.
7. **Export driver đang cài** (sao lưu) bằng `pnputil /export-driver`: từng thiết bị hoặc
   **Export all** (`*`, driver bên thứ ba) ra thư mục người dùng chọn; có tiến trình, hủy, kèm
   `DANH-SACH-DRIVER.csv` + hướng dẫn khôi phục.

## Ràng buộc bắt buộc (không được phá)

- KHÔNG tự cài driver, KHÔNG chạy bất kỳ file `.exe/.msi/.sys` nào tải về. Không gọi `pnputil /add-driver`,
  DIFxAPI, `UpdateDriverForPlugAndPlayDevices`. Chỉ ghi hướng dẫn để người dùng tự cài.
- Chỉ tải từ Microsoft Update Catalog; không scrape/host driver từ nguồn khác.
- Mọi hành động tải từ trang hãng đều mở **trình duyệt** tới trang chính chủ (allowlist domain).
- Chạy với **quyền user thường** (`requestedExecutionLevel: asInvoker`). Mọi tính năng hiện có đều
  không cần admin.
- Renderer: `sandbox`, `contextIsolation`, không `nodeIntegration`; chỉ gọi API khai báo trong preload.
- Script PowerShell viết cứng trong code; tham số (đường dẫn, device id) truyền qua **biến môi trường**,
  không ghép chuỗi. Gọi exe hệ thống bằng đường dẫn tuyệt đối trong `%SystemRoot%\System32`.
- Renderer chỉ gửi ID (deviceId, updateId GUID); main tự tra dữ liệu, tự lấy URL tải, tự mở hộp chọn
  thư mục. Không nhận URL/đường dẫn tùy ý từ renderer (trừ `open-external` qua allowlist và
  `open-download-folder` chỉ trong thư mục người dùng đã chọn).

## Công nghệ

| Lớp | Công nghệ |
| --- | --- |
| Desktop shell | Electron 44 (main process TypeScript → CommonJS, `tsc`) |
| UI | React 19 + TypeScript, Vite 8, CSS thuần với CSS variables (dark/light) |
| Truy cập hệ thống | PowerShell 5.1 (`Get-CimInstance`, `Get-PnpDeviceProperty`, `Get-AuthenticodeSignature`, COM Windows Update), `pnputil.exe`, `expand.exe` |
| Mạng | `fetch` của Node (chỉ tới Microsoft Update Catalog) |
| Dữ liệu offline | `pci.ids`, `usb.ids` |
| Test | `node:test` (build bằng `tsc` rồi chạy trong `dist-electron/tests`) |
| Đóng gói | electron-builder (NSIS) |

Chọn Electron thay Tauri vì máy phát triển ban đầu không có Rust toolchain; logic ở `electron/*.ts`
là TypeScript thuần, có thể port sang Rust nếu cần.

## Cấu trúc

```
electron/            main process + preload (Node)
  main.ts            cửa sổ, IPC, chính sách bảo mật, chọn thư mục
  preload.ts         window.driverApi (contextBridge)
  types.ts           kiểu dùng chung main <-> renderer (renderer chỉ import type)
  hardwareScan.ts    quét WMI
  hardwareId.ts      parse Hardware ID (VEN/DEV/VID/PID/SUBSYS/REV)
  deviceStatus.ts    ConfigManagerErrorCode -> trạng thái + mô tả tiếng Việt
  pciLookup.ts       parse pci.ids / usb.ids
  vendorLinks.ts     link trang chính chủ + allowlist URL
  windowsUpdate.ts   tìm driver optional qua Windows Update
  catalog.ts         tìm + parse Microsoft Update Catalog, xếp hạng gói
  driverDownload.ts  tải, xác minh, giải nén, đối chiếu .inf
  driverFinder.ts    điều phối tìm kiếm, chế độ tự động
  driverExport.ts    export driver đang cài (pnputil)
  exporter.ts        xuất danh sách .csv/.txt
  settings.ts        nhớ thư mục tải/export gần nhất
  powershell.ts      chạy script PowerShell, parse JSON
  tests/             unit test (node:test)
src/                 renderer React
  App.tsx, components/, hooks/
resources/           pci.ids, usb.ids (đóng gói vào app)
```

## Lệnh

```powershell
npm install
npm start          # build + chạy
npm run dev        # Vite dev server + Electron
npm run typecheck  # tsc cả renderer và main
npm test           # build main + chạy unit test
npm run dist       # installer NSIS vào release/
```

## Quy ước & lưu ý

- Comment và chuỗi UI bằng **tiếng Việt**; tên biến/hàm tiếng Anh. Comment giải thích *vì sao* và định
  dạng dữ liệu ngoài (Hardware ID, pci.ids, HTML catalog), không lặp lại code.
- Thêm IPC mới: khai báo kiểu trong `DriverApi` (`types.ts`) → `preload.ts` → `ipcMain.handle` trong
  `main.ts`. Validate mọi tham số ở main.
- Không parse output chữ của `pnputil`/`expand` (bị dịch theo ngôn ngữ Windows); dùng exit code và hệ
  thống file.
- Catalog tìm kiếm rất "lỏng" — kết quả chỉ là ứng viên; bước đối chiếu `.inf` mới là xác nhận.
- Nếu môi trường có `ELECTRON_RUN_AS_NODE=1` (vd chạy từ extension host của VS Code), Electron chạy như
  Node và `require('electron')` trả `undefined` — bỏ biến này khi chạy app.
- Trước khi kết thúc thay đổi: `npm run typecheck` và `npm test` phải sạch.
