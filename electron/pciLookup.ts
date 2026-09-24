import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IdSpace } from './types';

/*
 * TRA CỨU VENDOR/DEVICE ID OFFLINE
 * ================================
 * Dùng file pci.ids (https://pci-ids.ucw.cz) và usb.ids (http://www.linux-usb.org/usb.ids)
 * đóng gói sẵn trong thư mục resources/ -> không cần mạng, không gửi Hardware ID
 * của máy người dùng ra ngoài.
 *
 * Hai file cùng định dạng văn bản, phân cấp bằng số ký tự TAB đầu dòng:
 *
 *   # dòng comment
 *   8086  Intel Corporation                     <- vendor: 4 hex + 2 space + tên
 *   \ta102  Q170/Q150/B150/... SATA controller  <- device: 1 TAB + 4 hex + tên
 *   \t\t1043 8694  H110M-K motherboard          <- subsystem: 2 TAB + subvendor subdevice + tên
 *
 * Sau danh sách vendor, file còn các section khác (pci.ids: "C xx" class code;
 * usb.ids: "C", "AT", "HID", "R", "L"...). Dòng đầu các section này KHÔNG khớp
 * mẫu "4 hex + khoảng trắng", nên khi gặp ta đặt currentVendor = null để các dòng
 * TAB phía sau không bị gán nhầm vào vendor cuối cùng.
 */

interface DeviceEntry {
  name: string;
  /** key "subvendor subdevice" (hex thường), ví dụ "1043 8694". */
  subsystems: Map<string, string>;
}

interface VendorEntry {
  name: string;
  devices: Map<string, DeviceEntry>;
}

export type IdDatabase = Map<string, VendorEntry>;

const VENDOR_RE = /^([0-9a-f]{4})\s+(.+)$/i;
const DEVICE_RE = /^\t([0-9a-f]{4})\s+(.+)$/i;
const SUBSYS_RE = /^\t\t([0-9a-f]{4}) ([0-9a-f]{4})\s+(.+)$/i;

export function parseIdsFile(content: string): IdDatabase {
  const vendors: IdDatabase = new Map();
  let vendor: VendorEntry | null = null;
  let device: DeviceEntry | null = null;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line === '' || line.startsWith('#')) continue;

    if (!line.startsWith('\t')) {
      // Dòng cấp 0: vendor mới, hoặc bắt đầu một section không phải vendor.
      const m = VENDOR_RE.exec(line);
      device = null;
      if (m) {
        vendor = { name: m[2].trim(), devices: new Map() };
        vendors.set(m[1].toLowerCase(), vendor);
      } else {
        vendor = null;
      }
      continue;
    }

    if (!vendor) continue; // dòng con của section class/HID/... -> bỏ qua

    if (!line.startsWith('\t\t')) {
      const m = DEVICE_RE.exec(line);
      if (m) {
        device = { name: m[2].trim(), subsystems: new Map() };
        vendor.devices.set(m[1].toLowerCase(), device);
      }
      continue;
    }

    const m = SUBSYS_RE.exec(line);
    if (m && device) {
      device.subsystems.set(`${m[1].toLowerCase()} ${m[2].toLowerCase()}`, m[3].trim());
    }
  }
  return vendors;
}

export interface LookupResult {
  vendorName: string | null;
  deviceName: string | null;
  /** Tên model bo mạch/laptop theo subsystem (nếu có trong DB). */
  subsystemName: string | null;
  /** Tên hãng OEM theo subsystem vendor (tra trong danh sách vendor PCI). */
  subsysVendorName: string | null;
}

export class IdLookup {
  private readonly dbs: Partial<Record<IdSpace, IdDatabase>> = {};
  private readonly errors: string[] = [];

  /**
   * @param resourceDir thư mục chứa pci.ids và usb.ids. Nếu thiếu file nào thì
   *                    tra cứu phần đó trả null, app vẫn chạy tiếp.
   */
  constructor(resourceDir: string) {
    for (const space of ['pci', 'usb'] as const) {
      try {
        this.dbs[space] = parseIdsFile(readFileSync(join(resourceDir, `${space}.ids`), 'utf8'));
      } catch (err) {
        this.errors.push(`${space}.ids: ${(err as Error).message}`);
      }
    }
  }

  get loaded(): boolean {
    return this.dbs.pci !== undefined;
  }

  get loadErrors(): readonly string[] {
    return this.errors;
  }

  lookup(
    space: IdSpace,
    vendorId: string,
    deviceId?: string | null,
    subsysVendorId?: string | null,
    subsysDeviceId?: string | null,
  ): LookupResult {
    const db = this.dbs[space];
    const vendor = db?.get(vendorId.toLowerCase());
    const device = deviceId ? vendor?.devices.get(deviceId.toLowerCase()) : undefined;

    let subsystemName: string | null = null;
    let subsysVendorName: string | null = null;
    if (subsysVendorId) {
      // Subsystem vendor luôn là mã PCI-SIG (chỉ có ở bus PCI/HDAUDIO).
      subsysVendorName = this.dbs.pci?.get(subsysVendorId.toLowerCase())?.name ?? null;
      if (device && subsysDeviceId) {
        subsystemName =
          device.subsystems.get(`${subsysVendorId.toLowerCase()} ${subsysDeviceId.toLowerCase()}`) ?? null;
      }
    }

    return {
      vendorName: vendor?.name ?? null,
      deviceName: device?.name ?? null,
      subsystemName,
      subsysVendorName,
    };
  }
}
