// Kiểu dữ liệu dùng chung giữa main process (electron/) và renderer (src/).
// Renderer chỉ `import type` từ file này nên không kéo code Node vào bundle.

/** Trạng thái driver đã được "dịch" từ ConfigManagerErrorCode. */
export type DriverStatus = 'ok' | 'error' | 'missing' | 'disabled';

/** Không gian ID dùng để tra cứu: PCI (pci.ids) hay USB (usb.ids). */
export type IdSpace = 'pci' | 'usb';

/** Kết quả tách một chuỗi Hardware ID thành các thành phần. */
export interface ParsedHardwareId {
  /** Chuỗi gốc, ví dụ "PCI\\VEN_8086&DEV_A102&SUBSYS_86941043&REV_31". */
  raw: string;
  /** Enumerator/bus đứng trước dấu "\\": PCI, USB, HDAUDIO, HID, ACPI... */
  bus: string;
  /** Database dùng để tra tên; null nếu bus không dùng mã PCI/USB (ACPI, ROOT, SWD...). */
  idSpace: IdSpace | null;
  vendorId: string | null; // 4 ký tự hex, chữ thường (khớp định dạng pci.ids)
  deviceId: string | null;
  subsysVendorId: string | null;
  subsysDeviceId: string | null;
  revision: string | null;
}

export interface DriverLink {
  label: string;
  url: string;
  kind: 'chip' | 'oem' | 'catalog';
}

export interface DeviceInfo {
  /** PNPDeviceID - duy nhất cho mỗi thiết bị, dùng làm key. */
  id: string;
  /** Tên Windows hiển thị (với thiết bị thiếu driver thường là "Unknown device"/"PCI Device"). */
  name: string;
  pnpClass: string | null;
  /** Manufacturer theo Windows (lấy từ file .inf của driver đang dùng). */
  manufacturer: string | null;
  hardwareIds: string[];
  errorCode: number;
  status: DriverStatus;
  /** Mô tả mã lỗi bằng tiếng Việt. */
  statusText: string;
  /** Gợi ý khắc phục ngắn. */
  statusHint: string | null;
  parsedId: ParsedHardwareId | null;
  /** Tên hãng chip theo pci.ids/usb.ids. */
  vendorName: string | null;
  /** Tên thiết bị theo pci.ids/usb.ids. */
  deviceName: string | null;
  /** Tên hãng lắp ráp (OEM) theo SUBSYS, ví dụ ASUSTeK, Dell. */
  subsysVendorName: string | null;
  /** Tên model bo mạch/laptop theo SUBSYS (nếu pci.ids có). */
  subsystemName: string | null;
  links: DriverLink[];
}

export interface SystemInfo {
  manufacturer: string | null;
  model: string | null;
  boardManufacturer: string | null;
  boardProduct: string | null;
  oemLink: DriverLink | null;
}

export interface ScanResult {
  scannedAt: string;
  system: SystemInfo;
  devices: DeviceInfo[];
  /** Số thiết bị "ma" (đã rút ra, Present=false / mã 45) bị bỏ qua. */
  skippedDisconnected: number;
  /** false nếu không đọc được pci.ids/usb.ids (vẫn quét được, chỉ thiếu tên tra cứu). */
  idDatabaseLoaded: boolean;
}

export interface WindowsUpdateDriver {
  title: string;
  manufacturer: string | null;
  model: string | null;
  driverClass: string | null;
  hardwareId: string | null;
  driverDate: string | null;
  sizeMB: number | null;
}

export interface WindowsUpdateResult {
  checkedAt: string;
  updates: WindowsUpdateDriver[];
}

export type ExportFormat = 'csv' | 'txt';

export interface ExportResult {
  saved: boolean;
  filePath?: string;
  count?: number;
}

// ---------- Tìm & tải driver từ Microsoft Update Catalog ----------

/** Một dòng kết quả tìm kiếm trên Microsoft Update Catalog. */
export interface CatalogEntry {
  /** GUID của update trên catalog. */
  updateId: string;
  title: string;
  products: string;
  classification: string;
  /** Ngày cập nhật dạng yyyy-mm-dd. */
  lastUpdated: string | null;
  version: string | null;
  sizeBytes: number | null;
  /** Điểm xếp hạng độ phù hợp (xem catalog.ts). Bị loại nếu null. */
  score: number;
  /** true nếu tìm được bằng Hardware ID có SUBSYS (khớp đúng model máy). */
  matchedSubsys: boolean;
  recommended: boolean;
}

export interface DriverSearchResult {
  deviceId: string;
  queries: string[];
  entries: CatalogEntry[];
}

export type DownloadPhase = 'resolving' | 'downloading' | 'verifying' | 'extracting' | 'checking' | 'done';

export interface DownloadProgress {
  deviceId: string;
  updateId: string;
  phase: DownloadPhase;
  receivedBytes: number;
  totalBytes: number | null;
}

export interface DownloadedDriver {
  deviceId: string;
  updateId: string;
  title: string;
  /** Thư mục chứa gói .cab và thư mục driver đã giải nén. */
  folder: string;
  hashVerified: boolean;
  signer: string;
  /** Có file .inf trong gói liệt kê Hardware ID của thiết bị hay không. */
  infMatched: boolean;
  matchedInfFiles: string[];
  fileCount: number;
}

export interface AutoFindResult {
  deviceId: string;
  outcome: 'downloaded' | 'no-results' | 'no-match' | 'failed';
  driver?: DownloadedDriver;
  message: string;
  /** Số gói đã thử tải. */
  tried: number;
}

// ---------- Export (sao lưu) driver đang cài ----------

export interface InstalledDriverInfo {
  /** Tên file INF trong Driver Store, vd "oem56.inf" (null nếu thiết bị chưa có driver). */
  infName: string | null;
  provider: string | null;
  version: string | null;
  date: string | null;
}

export interface DriverExportResult {
  /** false nếu người dùng bấm Hủy ở hộp chọn thư mục. */
  saved: boolean;
  folder?: string;
  /** Số gói driver đã export. */
  exported?: number;
  total?: number;
  sizeBytes?: number;
}

export interface ExportAllProgress {
  done: number;
  total: number;
}

/** API mà preload.ts phơi ra cho renderer qua window.driverApi. */
export interface DriverApi {
  scanHardware(): Promise<ScanResult>;
  checkWindowsUpdate(): Promise<WindowsUpdateResult>;
  openExternal(url: string): Promise<void>;
  openWindowsUpdateSettings(): Promise<void>;
  exportDevices(format: ExportFormat): Promise<ExportResult>;

  searchDriver(deviceId: string): Promise<DriverSearchResult>;
  downloadDriver(deviceId: string, updateId: string): Promise<DownloadedDriver>;
  /** Tìm + tự tải gói phù hợp nhất (thử tối đa vài gói đến khi INF khớp thiết bị). */
  autoFindDriver(deviceId: string): Promise<AutoFindResult>;
  onDownloadProgress(listener: (p: DownloadProgress) => void): () => void;
  getDownloadDir(): Promise<string>;
  /** Mở hộp chọn thư mục lưu driver; trả null nếu người dùng hủy. */
  chooseDownloadDir(): Promise<string | null>;
  openDownloadFolder(folder: string): Promise<void>;

  getInstalledDriver(deviceId: string): Promise<InstalledDriverInfo>;
  /** Export driver đang cài của một thiết bị; tự hỏi thư mục đích. */
  exportDeviceDriver(deviceId: string): Promise<DriverExportResult>;
  /** Export toàn bộ driver bên thứ ba (oem*.inf) trong Driver Store; tự hỏi thư mục đích. */
  exportAllDrivers(): Promise<DriverExportResult>;
  cancelExportAll(): Promise<void>;
  onExportAllProgress(listener: (p: ExportAllProgress) => void): () => void;
}
