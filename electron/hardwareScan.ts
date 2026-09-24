import { CODE_NOT_CONNECTED, resolveStatus } from './deviceStatus';
import { pickBestHardwareId } from './hardwareId';
import type { IdLookup } from './pciLookup';
import { runPowerShellJson } from './powershell';
import type { DeviceInfo, ScanResult, SystemInfo } from './types';
import { buildDriverLinks, oemFromManufacturer } from './vendorLinks';

/*
 * QUÉT PHẦN CỨNG QUA WMI
 * ======================
 * Win32_PnPEntity liệt kê mọi thiết bị Plug and Play (tương đương Device Manager).
 * Đọc lớp này KHÔNG cần quyền admin. Ta chỉ đọc; không enable/disable/cài gì.
 *
 * Các thuộc tính dùng:
 *   Name                   tên hiển thị
 *   PNPDeviceID            ID duy nhất (Hardware ID cụ thể nhất + instance id)
 *   HardwareID[]           danh sách Hardware ID, cụ thể -> chung
 *   CompatibleID[]         ID "tương thích" (dự phòng khi HardwareID rỗng)
 *   Manufacturer           hãng theo driver .inf đang dùng (trống nếu thiếu driver)
 *   PNPClass               nhóm thiết bị: Display, Net, USB, ...
 *   ConfigManagerErrorCode mã lỗi Device Manager -> xem deviceStatus.ts
 *   Present                false nếu thiết bị đã được rút ra
 *
 * Kèm theo Win32_ComputerSystem + Win32_BaseBoard để biết hãng máy/bo mạch
 * (gợi ý trang hỗ trợ OEM).
 */

const SCAN_SCRIPT = `
$devices = @(Get-CimInstance -ClassName Win32_PnPEntity | ForEach-Object {
  [pscustomobject]@{
    name          = $_.Name
    pnpDeviceId   = $_.PNPDeviceID
    hardwareIds   = @($_.HardwareID | Where-Object { $_ })
    compatibleIds = @($_.CompatibleID | Where-Object { $_ })
    manufacturer  = $_.Manufacturer
    pnpClass      = $_.PNPClass
    errorCode     = $_.ConfigManagerErrorCode
    present       = $_.Present
  }
})
$cs = Get-CimInstance -ClassName Win32_ComputerSystem
$bb = Get-CimInstance -ClassName Win32_BaseBoard | Select-Object -First 1
[pscustomobject]@{
  devices = $devices
  system  = [pscustomobject]@{
    manufacturer      = $cs.Manufacturer
    model             = $cs.Model
    boardManufacturer = $bb.Manufacturer
    boardProduct      = $bb.Product
  }
} | ConvertTo-Json -Depth 4 -Compress
`;

/** Dạng dữ liệu thô PowerShell trả về (chưa tin cậy kiểu -> chuẩn hóa bên dưới). */
interface RawDevice {
  name?: string | null;
  pnpDeviceId?: string | null;
  hardwareIds?: string[] | string | null;
  compatibleIds?: string[] | string | null;
  manufacturer?: string | null;
  pnpClass?: string | null;
  errorCode?: number | null;
  present?: boolean | null;
}

interface RawScan {
  devices?: RawDevice[] | RawDevice | null;
  system?: Partial<Record<'manufacturer' | 'model' | 'boardManufacturer' | 'boardProduct', string | null>>;
}

/** ConvertTo-Json đôi khi biến mảng 1 phần tử thành giá trị đơn -> ép về mảng. */
function toArray<T>(value: T[] | T | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // Chuỗi mặc định vô nghĩa của nhiều BIOS máy tự ráp.
  if (!trimmed || /to be filled by o\.?e\.?m|system manufacturer|system product name|default string/i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export async function scanHardware(lookup: IdLookup): Promise<ScanResult> {
  const raw = await runPowerShellJson<RawScan>(SCAN_SCRIPT, 120_000);

  const sys = raw.system ?? {};
  const system: SystemInfo = {
    manufacturer: cleanString(sys.manufacturer),
    model: cleanString(sys.model),
    boardManufacturer: cleanString(sys.boardManufacturer),
    boardProduct: cleanString(sys.boardProduct),
    oemLink: null,
  };
  system.oemLink = oemFromManufacturer(system.manufacturer, system.boardManufacturer);

  const devices: DeviceInfo[] = [];
  let skippedDisconnected = 0;

  for (const d of toArray(raw.devices)) {
    const id = cleanString(d.pnpDeviceId);
    if (!id) continue;

    // Thiết bị "ma": đã rút ra hoặc báo Code 45 -> không cần driver lúc này.
    if (d.present === false || d.errorCode === CODE_NOT_CONNECTED) {
      skippedDisconnected++;
      continue;
    }

    const hardwareIds = toArray(d.hardwareIds).filter((x): x is string => typeof x === 'string' && x.length > 0);
    const compatibleIds = toArray(d.compatibleIds).filter((x): x is string => typeof x === 'string' && x.length > 0);
    const status = resolveStatus(d.errorCode);

    // Thứ tự ưu tiên khi chọn ID để tra: HardwareID -> PNPDeviceID -> CompatibleID.
    const parsedId = pickBestHardwareId([...hardwareIds, id, ...compatibleIds]);

    let vendorName: string | null = null;
    let deviceName: string | null = null;
    let subsysVendorName: string | null = null;
    let subsystemName: string | null = null;
    if (parsedId?.idSpace && parsedId.vendorId) {
      const r = lookup.lookup(
        parsedId.idSpace,
        parsedId.vendorId,
        parsedId.deviceId,
        parsedId.subsysVendorId,
        parsedId.subsysDeviceId,
      );
      ({ vendorName, deviceName, subsysVendorName, subsystemName } = r);
    }

    devices.push({
      id,
      name: cleanString(d.name) ?? deviceName ?? 'Thiết bị không tên',
      pnpClass: cleanString(d.pnpClass),
      manufacturer: cleanString(d.manufacturer),
      hardwareIds,
      errorCode: typeof d.errorCode === 'number' ? d.errorCode : 0,
      status: status.status,
      statusText: status.text,
      statusHint: status.hint,
      parsedId,
      vendorName,
      deviceName,
      subsysVendorName,
      subsystemName,
      links: buildDriverLinks(parsedId, system.oemLink),
    });
  }

  // Thiết bị có vấn đề lên đầu, sau đó sắp theo tên.
  const rank = { missing: 0, error: 1, disabled: 2, ok: 3 } as const;
  devices.sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name));

  return {
    scannedAt: new Date().toISOString(),
    system,
    devices,
    skippedDisconnected,
    idDatabaseLoaded: lookup.loaded,
  };
}
