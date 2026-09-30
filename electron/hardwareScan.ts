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

// Get-WmiObject thay vì Get-CimInstance: có từ PowerShell 2.0 (Win7) và cho cùng dữ liệu.
// Win7/8.1 không có thuộc tính PNPClass/Present -> gửi kèm ClassGuid để suy ra nhóm thiết bị.
export const SCAN_SCRIPT = `
$devices = @(Get-WmiObject -Class Win32_PnPEntity | ForEach-Object {
  @{
    name          = $_.Name
    pnpDeviceId   = $_.PNPDeviceID
    hardwareIds   = @($_.HardwareID | Where-Object { $_ })
    compatibleIds = @($_.CompatibleID | Where-Object { $_ })
    manufacturer  = $_.Manufacturer
    pnpClass      = $_.PNPClass
    classGuid     = $_.ClassGuid
    errorCode     = $_.ConfigManagerErrorCode
    present       = $_.Present
  }
})
$cs = Get-WmiObject -Class Win32_ComputerSystem
$bb = Get-WmiObject -Class Win32_BaseBoard | Select-Object -First 1
Out-Json @{
  devices = $devices
  system  = @{
    manufacturer      = $cs.Manufacturer
    model             = $cs.Model
    boardManufacturer = $bb.Manufacturer
    boardProduct      = $bb.Product
  }
}
`;

/*
 * ClassGuid -> tên nhóm (giống PNPClass của Win10) cho Windows 7/8.1.
 * Nguồn: "System-Defined Device Setup Classes" (Microsoft Learn).
 */
const CLASS_BY_GUID: Record<string, string> = {
  '{4d36e968-e325-11ce-bfc1-08002be10318}': 'Display',
  '{4d36e972-e325-11ce-bfc1-08002be10318}': 'Net',
  '{4d36e96c-e325-11ce-bfc1-08002be10318}': 'MEDIA',
  '{36fc9e60-c465-11cf-8056-444553540000}': 'USB',
  '{745a17a0-74d3-11d0-b6fe-00a0c90f57da}': 'HIDClass',
  '{4d36e96b-e325-11ce-bfc1-08002be10318}': 'Keyboard',
  '{4d36e96f-e325-11ce-bfc1-08002be10318}': 'Mouse',
  '{4d36e97d-e325-11ce-bfc1-08002be10318}': 'System',
  '{4d36e96a-e325-11ce-bfc1-08002be10318}': 'hdc',
  '{4d36e97b-e325-11ce-bfc1-08002be10318}': 'SCSIAdapter',
  '{4d36e967-e325-11ce-bfc1-08002be10318}': 'DiskDrive',
  '{4d36e965-e325-11ce-bfc1-08002be10318}': 'CDROM',
  '{71a27cdd-812a-11d0-bec7-08002be2092f}': 'Volume',
  '{50dd5230-ba8a-11d1-bf5d-0000f805f530}': 'SmartCardReader',
  '{e0cbf06c-cd8b-4647-bb8a-263b43f0f974}': 'Bluetooth',
  '{6bdd1fc6-810f-11d0-bec7-08002be2092f}': 'Image',
  '{ca3e7ab9-b4c3-4ae6-8251-579ef933890f}': 'Camera',
  '{4d36e979-e325-11ce-bfc1-08002be10318}': 'Printer',
  '{4d36e978-e325-11ce-bfc1-08002be10318}': 'Ports',
  '{4d36e96d-e325-11ce-bfc1-08002be10318}': 'Modem',
  '{4d36e97e-e325-11ce-bfc1-08002be10318}': 'Unknown',
  '{50127dc3-0f36-415e-a6cc-4cb3be910b65}': 'Processor',
  '{72631e54-78a4-11d0-bcf7-00aa00b7b32a}': 'Battery',
  '{4d36e97c-e325-11ce-bfc1-08002be10318}': 'Sound',
  '{4d36e96e-e325-11ce-bfc1-08002be10318}': 'Monitor',
  '{8ecc055d-047f-11d1-a537-0000f8753ed1}': 'LegacyDriver',
  '{d45b1c18-c8fa-11d1-9f77-0000f805f530}': 'Infrared',
  '{6d807884-7d21-11cf-801c-08002be10318}': 'PCMCIA',
  '{a0a588a4-c46f-4b37-b7ea-c82fe89870c6}': 'SDHost',
  '{d48179be-ec20-11d1-b6b8-00c04fa372a7}': 'SBP2',
  '{6bdd1fc1-810f-11d0-bec7-08002be2092f}': '1394',
  '{88bae032-5a81-49f0-bc3d-a4ff138216d6}': 'USBDevice',
  '{eec5ad98-8080-425f-922a-dabf3de3f69a}': 'WPD',
  '{5099944a-f6b9-4057-a056-8c550228544c}': 'Firmware',
  '{c166523c-fe0c-4a94-a586-f1a80cfbbf3e}': 'AudioEndpoint',
  '{62f9c741-b25a-46ce-b54c-9bccce08b6f2}': 'SoftwareDevice',
  '{d94ee5d8-d189-4994-83d2-f68d7d41b0e6}': 'SecurityDevices',
  '{f2e7dd72-6468-4e36-b6f1-6488f42c1b52}': 'Biometric',
  '{5175d334-c371-4806-b3ba-71fd53c9258d}': 'SensorDevice',
};

export function classFromGuid(guid: unknown): string | null {
  return typeof guid === 'string' ? (CLASS_BY_GUID[guid.trim().toLowerCase()] ?? null) : null;
}

/** Dạng dữ liệu thô PowerShell trả về (chưa tin cậy kiểu -> chuẩn hóa bên dưới). */
interface RawDevice {
  name?: string | null;
  pnpDeviceId?: string | null;
  hardwareIds?: string[] | string | null;
  compatibleIds?: string[] | string | null;
  manufacturer?: string | null;
  pnpClass?: string | null;
  classGuid?: string | null;
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
      pnpClass: cleanString(d.pnpClass) ?? classFromGuid(d.classGuid),
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
