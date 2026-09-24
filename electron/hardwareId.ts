import type { IdSpace, ParsedHardwareId } from './types';

/*
 * PARSE HARDWARE ID
 * =================
 * Windows mô tả mỗi thiết bị bằng một danh sách Hardware ID, sắp xếp từ CỤ THỂ
 * nhất đến CHUNG nhất. Ví dụ card mạng Realtek:
 *
 *   PCI\VEN_10EC&DEV_8168&SUBSYS_86771043&REV_15   <- cụ thể nhất
 *   PCI\VEN_10EC&DEV_8168&SUBSYS_86771043
 *   PCI\VEN_10EC&DEV_8168&CC_020000
 *   PCI\VEN_10EC&DEV_8168&CC_0200                  <- chung nhất
 *
 * Cấu trúc:  <ENUMERATOR>\<TOKEN>&<TOKEN>&...
 *   - ENUMERATOR (bus): PCI, USB, HDAUDIO, HID, ACPI, ROOT, SWD, BTHENUM...
 *   - Mỗi TOKEN có dạng KEY_VALUE:
 *       VEN_xxxx  : Vendor ID (PCI, HDAUDIO)       — hãng sản xuất chip
 *       DEV_xxxx  : Device ID (PCI, HDAUDIO)       — mã mẫu chip của hãng
 *       VID_xxxx  : Vendor ID (USB, HID qua USB)   — tương đương VEN_
 *       PID_xxxx  : Product ID (USB)               — tương đương DEV_
 *       SUBSYS_ddddvvvv : 8 hex; 4 ký tự ĐẦU là subsystem DEVICE id, 4 ký tự
 *                   CUỐI là subsystem VENDOR id — tức hãng lắp ráp bo mạch/laptop.
 *                   VD SUBSYS_86771043 -> subdevice 8677, subvendor 1043 (ASUSTeK).
 *       REV_xx    : revision phần cứng
 *       CC_xxxxxx : class code (loại thiết bị) — không cần cho tra tên
 *       MI_xx     : interface của thiết bị USB đa chức năng
 *       FUNC_xx   : function group của HD Audio
 *
 * Mã VEN/DEV của PCI và HDAUDIO dùng chung sổ đăng ký PCI-SIG -> tra pci.ids.
 * Mã VID/PID của USB/HID dùng sổ đăng ký USB-IF -> tra usb.ids.
 * ACPI\VEN_INT&DEV_33A0 dùng mã ACPI 3-4 CHỮ CÁI (INT, SYNA...) không phải hex
 * -> không tra được, bỏ qua.
 */

const HEX4 = /^[0-9A-F]{4}$/i;

/** Bus dùng Vendor ID của PCI-SIG. */
const PCI_BUSES = new Set(['PCI', 'HDAUDIO', 'PCIIDE']);
/** Bus dùng Vendor ID của USB-IF. */
const USB_BUSES = new Set(['USB', 'HID', 'USBSTOR', 'USBPRINT']);

function hex4(value: string | undefined): string | null {
  return value && HEX4.test(value) ? value.toLowerCase() : null;
}

export function parseHardwareId(raw: string): ParsedHardwareId | null {
  if (!raw || typeof raw !== 'string') return null;

  const slash = raw.indexOf('\\');
  if (slash <= 0) return null;

  const bus = raw.slice(0, slash).toUpperCase();
  // Phần sau "\" có thể chứa thêm "\instance-id" (với PNPDeviceID) -> chỉ lấy đoạn đầu.
  const idPart = raw.slice(slash + 1).split('\\')[0];

  // Tách "VEN_8086&DEV_A102&SUBSYS_86941043" thành map { VEN: '8086', DEV: 'A102', ... }.
  const tokens = new Map<string, string>();
  for (const token of idPart.split('&')) {
    const underscore = token.indexOf('_');
    if (underscore <= 0) continue;
    const key = token.slice(0, underscore).toUpperCase();
    // Giữ giá trị xuất hiện đầu tiên (một số ID lặp key, ví dụ HID\VID_..&UP_..).
    if (!tokens.has(key)) tokens.set(key, token.slice(underscore + 1));
  }

  let idSpace: IdSpace | null = null;
  let vendorId: string | null = null;
  let deviceId: string | null = null;

  if (PCI_BUSES.has(bus)) {
    vendorId = hex4(tokens.get('VEN'));
    deviceId = hex4(tokens.get('DEV'));
    if (vendorId) idSpace = 'pci';
  } else if (USB_BUSES.has(bus)) {
    vendorId = hex4(tokens.get('VID'));
    deviceId = hex4(tokens.get('PID'));
    if (vendorId) idSpace = 'usb';
  }

  let subsysVendorId: string | null = null;
  let subsysDeviceId: string | null = null;
  const subsys = tokens.get('SUBSYS');
  if (subsys && /^[0-9A-F]{8}$/i.test(subsys)) {
    subsysDeviceId = subsys.slice(0, 4).toLowerCase(); // 4 ký tự đầu = subdevice
    subsysVendorId = subsys.slice(4).toLowerCase(); //   4 ký tự cuối = subvendor (OEM)
    // 0000 nghĩa là không khai báo subsystem.
    if (subsysVendorId === '0000') subsysVendorId = subsysDeviceId = null;
  }

  return {
    raw,
    bus,
    idSpace,
    vendorId,
    deviceId,
    subsysVendorId,
    subsysDeviceId,
    revision: tokens.get('REV') ?? null,
  };
}

/**
 * Chọn Hardware ID tốt nhất để tra cứu: duyệt theo thứ tự Windows trả về
 * (cụ thể -> chung) và lấy cái đầu tiên có Vendor ID hợp lệ. Nếu không có,
 * trả về kết quả parse đầu tiên (để vẫn hiển thị được bus).
 */
export function pickBestHardwareId(candidates: string[]): ParsedHardwareId | null {
  let fallback: ParsedHardwareId | null = null;
  for (const candidate of candidates) {
    const parsed = parseHardwareId(candidate);
    if (!parsed) continue;
    if (parsed.vendorId) return parsed;
    fallback ??= parsed;
  }
  return fallback;
}

/**
 * Rút gọn Hardware ID về dạng "BUS\VEN_xxxx&DEV_yyyy" để tìm kiếm trên
 * Microsoft Update Catalog (tìm theo ID quá cụ thể thường không ra kết quả).
 */
export function shortHardwareId(parsed: ParsedHardwareId): string {
  if (!parsed.vendorId) return parsed.raw;
  const [venKey, devKey] = parsed.idSpace === 'usb' ? ['VID', 'PID'] : ['VEN', 'DEV'];
  const dev = parsed.deviceId ? `&${devKey}_${parsed.deviceId.toUpperCase()}` : '';
  const core = `${venKey}_${parsed.vendorId.toUpperCase()}${dev}`;
  // HDAUDIO có token FUNC_xx đứng trước VEN_ nên "HDAUDIO\VEN_..." không tồn tại -> bỏ tiền tố bus.
  return parsed.bus === 'HDAUDIO' ? core : `${parsed.bus}\\${core}`;
}
