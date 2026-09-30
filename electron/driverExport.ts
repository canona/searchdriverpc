import { spawn, type ChildProcess } from 'node:child_process';
import { readdir, rm, stat, statfs, writeFile, mkdir } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { runPowerShellJson } from './powershell';
import type { DeviceInfo, DriverExportResult, ExportAllProgress, InstalledDriverInfo } from './types';
import { isLegacyWindows, listFilesRecursive } from './winCompat';

/*
 * EXPORT (SAO LƯU) DRIVER ĐANG CÀI
 * ================================
 * Dùng pnputil.exe có sẵn trong Windows:
 *   pnputil /export-driver oem56.inf <thư mục>   -> export một gói
 *   pnputil /export-driver *         <thư mục>   -> export mọi gói bên thứ ba (oem*.inf)
 * pnputil chỉ SAO CHÉP gói từ Driver Store (C:\Windows\System32\DriverStore) ra
 * thư mục đích, không thay đổi hệ thống, và chạy được với quyền user thường.
 *
 * "Export all" chỉ gồm driver bên thứ ba (oem*.inf) vì driver có sẵn của Windows
 * (inbox) luôn đi kèm bộ cài Windows, không cần sao lưu.
 *
 * Output của pnputil được dịch theo ngôn ngữ Windows nên KHÔNG parse chữ; tiến
 * trình được tính bằng số thư mục con pnputil tạo ra (mỗi gói một thư mục).
 */

const SYSTEM32 = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
const INF_NAME_RE = /^[\w.-]{1,64}\.inf$/i;

function safeName(s: string, max = 80): string {
  const cleaned = s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim();
  return (cleaned || 'driver').slice(0, max);
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

/*
 * Ngày driver từ Get-WmiObject là chuỗi DMTF ("20210315000000.000000-000"),
 * từ Get-PnpDeviceProperty là DateTime -> đưa cả hai về yyyy-MM-dd.
 */
const DATE_HELPER = `function Format-SdpDate($d) {
  if (-not $d) { return $null }
  if ($d -is [string]) { $d = [Management.ManagementDateTimeConverter]::ToDateTime($d) }
  return ([datetime]$d).ToString('yyyy-MM-dd')
}`;

/**
 * Đọc driver đang dùng của thiết bị (không cần admin): qua DEVPKEY nếu có lệnh
 * Get-PnpDeviceProperty (Win8+ / PowerShell 5), nếu không (Win7) thì qua WMI
 * Win32_PnPSignedDriver (chậm hơn vài giây nhưng có ở mọi bản Windows).
 */
export async function getInstalledDriver(device: DeviceInfo): Promise<InstalledDriverInfo> {
  const r = await runPowerShellJson<Partial<InstalledDriverInfo>>(
    String.raw`${DATE_HELPER}
if (Get-Command Get-PnpDeviceProperty -ErrorAction SilentlyContinue) {
  $keys = 'DEVPKEY_Device_DriverInfPath','DEVPKEY_Device_DriverProvider','DEVPKEY_Device_DriverVersion','DEVPKEY_Device_DriverDate'
  $m = @{}
  foreach ($p in @(Get-PnpDeviceProperty -InstanceId $env:SDP_DEVICE_ID -KeyName $keys -ErrorAction SilentlyContinue)) { $m[$p.KeyName] = $p.Data }
  Out-Json @{
    infName  = $m['DEVPKEY_Device_DriverInfPath']
    provider = $m['DEVPKEY_Device_DriverProvider']
    version  = $m['DEVPKEY_Device_DriverVersion']
    date     = Format-SdpDate $m['DEVPKEY_Device_DriverDate']
  }
} else {
  # Trong chuỗi WQL, dấu \ và ' phải escape bằng \ đứng trước.
  $id = $env:SDP_DEVICE_ID.Replace('\', '\\').Replace("'", "\'")
  $d = Get-WmiObject -Class Win32_PnPSignedDriver -Filter "DeviceID='$id'" | Select-Object -First 1
  Out-Json @{
    infName  = $(if ($d) { $d.InfName } else { $null })
    provider = $(if ($d) { $d.DriverProviderName } else { $null })
    version  = $(if ($d) { $d.DriverVersion } else { $null })
    date     = $(if ($d) { Format-SdpDate $d.DriverDate } else { $null })
  }
}`,
    30_000,
    { SDP_DEVICE_ID: device.id },
  );
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return { infName: str(r.infName), provider: str(r.provider), version: str(r.version), date: str(r.date) };
}

function runPnputil(args: string[], onSpawn?: (c: ChildProcess) => void): Promise<{ code: number | null; output: string }> {
  return new Promise((ok, fail) => {
    const child = spawn(join(SYSTEM32, 'pnputil.exe'), args, { windowsHide: true });
    onSpawn?.(child);
    let output = '';
    child.stdout.on('data', (b: Buffer) => (output = (output + b.toString('utf8')).slice(-8000)));
    child.stderr.on('data', (b: Buffer) => (output = (output + b.toString('utf8')).slice(-8000)));
    child.on('error', fail);
    child.on('close', (code) => ok({ code, output }));
  });
}

async function folderSize(dir: string): Promise<number> {
  let total = 0;
  for (const f of await listFilesRecursive(dir)) total += (await stat(f)).size;
  return total;
}

/** pnputil /export-driver chỉ có từ Windows 10 (1607); pnputil của Win7/8.1 không export được. */
function assertExportSupported(): void {
  if (isLegacyWindows()) {
    throw new Error(
      'Export driver cần Windows 10 trở lên (pnputil /export-driver). Trên Windows 7/8.1 hãy dùng công cụ sao lưu driver riêng hoặc tải lại driver từ trang hãng.',
    );
  }
}

async function ensureFreeSpace(dir: string, needed: number): Promise<void> {
  let free: number;
  try {
    const s = await statfs(dir);
    free = s.bavail * s.bsize;
  } catch {
    return;
  }
  if (free < needed) {
    throw new Error(
      `Ổ đĩa đích không đủ chỗ (còn ${(free / 1024 ** 2).toFixed(0)} MB, cần ít nhất ${(needed / 1024 ** 2).toFixed(0)} MB). Hãy chọn thư mục ở ổ khác.`,
    );
  }
}

/** Export driver của MỘT thiết bị vào <dest>\<tên thiết bị> (<oemXX.inf>)\ */
export async function exportDeviceDriver(device: DeviceInfo, dest: string): Promise<DriverExportResult> {
  assertExportSupported();
  const info = await getInstalledDriver(device);
  if (!info.infName) throw new Error('Thiết bị chưa có driver nên không có gì để export.');
  if (!INF_NAME_RE.test(info.infName)) throw new Error(`Tên INF không hợp lệ: ${info.infName}`);

  const folder = join(dest, safeName(`${device.name} (${info.infName})`));
  await mkdir(folder, { recursive: true });
  await ensureFreeSpace(folder, 50 * 1024 ** 2);

  const r = await runPnputil(['/export-driver', info.infName, folder]);
  const files = await readdir(folder).catch(() => [] as string[]);
  if (r.code !== 0 || files.length === 0) {
    await rm(folder, { recursive: true, force: true });
    throw new Error(`pnputil không export được (${r.code}): ${r.output.trim().split('\n').pop() ?? ''}`);
  }
  await writeFile(
    join(folder, 'THONG-TIN-DRIVER.txt'),
    [
      `Thiết bị    : ${device.name}`,
      `Hardware ID : ${device.hardwareIds[0] ?? device.id}`,
      `INF         : ${info.infName}`,
      `Nhà cung cấp: ${info.provider ?? ''}`,
      `Phiên bản   : ${info.version ?? ''}`,
      `Ngày driver : ${info.date ?? ''}`,
      '',
      'Cài lại: Device Manager > chuột phải thiết bị > Update driver > Browse my computer > chọn thư mục này.',
      '',
    ].join('\r\n'),
    'utf8',
  );
  return { saved: true, folder, exported: 1, total: 1, sizeBytes: await folderSize(folder) };
}

// ---------------------------------------------------------------------------
// Export all
// ---------------------------------------------------------------------------

let running: ChildProcess | null = null;
let cancelled = false;

export function cancelExportAll(): void {
  cancelled = true;
  running?.kill();
}

async function countThirdPartyInfs(): Promise<number> {
  const files = await readdir(join(process.env.SystemRoot ?? 'C:\\Windows', 'INF')).catch(() => [] as string[]);
  return files.filter((f) => /^oem\d+\.inf$/i.test(f)).length;
}

interface SignedDriverRow {
  deviceName: string | null;
  infName: string | null;
  provider: string | null;
  version: string | null;
  date: string | null;
  deviceClass: string | null;
  hardwareId: string | null;
}

/** Danh sách thiết bị <-> gói oem*.inf để người dùng biết mỗi thư mục là driver của thiết bị nào. */
async function listThirdPartyDrivers(): Promise<SignedDriverRow[]> {
  const rows = await runPowerShellJson<SignedDriverRow[] | SignedDriverRow | null>(
    `${DATE_HELPER}
Out-Json @(Get-WmiObject -Class Win32_PnPSignedDriver | Where-Object { $_.InfName -like 'oem*.inf' } | ForEach-Object {
  @{
    deviceName  = $_.DeviceName
    infName     = $_.InfName
    provider    = $_.DriverProviderName
    version     = $_.DriverVersion
    date        = Format-SdpDate $_.DriverDate
    deviceClass = $_.DeviceClass
    hardwareId  = $_.HardWareID
  }
})`,
    120_000,
  ).catch(() => null);
  return Array.isArray(rows) ? rows : rows ? [rows] : [];
}

function csvCell(v: string | null): string {
  const s = v ?? '';
  return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
}

/**
 * Export mọi driver bên thứ ba vào <dest>\DriverBackup-<máy>-<thời gian>\.
 * Hủy giữa chừng -> xóa thư mục dở dang.
 */
export async function exportAllDrivers(
  dest: string,
  onProgress: (p: ExportAllProgress) => void,
): Promise<DriverExportResult> {
  if (running) throw new Error('Đang export, vui lòng đợi.');
  assertExportSupported();
  const total = await countThirdPartyInfs();
  if (total === 0) throw new Error('Không có driver bên thứ ba nào trong Driver Store.');

  const folder = join(dest, safeName(`DriverBackup-${hostname()}-${timestamp()}`));
  await mkdir(folder, { recursive: true });
  await ensureFreeSpace(folder, 1024 ** 3);

  cancelled = false;
  onProgress({ done: 0, total });
  const timer = setInterval(async () => {
    const dirs = await readdir(folder, { withFileTypes: true }).catch(() => []);
    onProgress({ done: Math.min(total, dirs.filter((d) => d.isDirectory()).length), total });
  }, 1000);

  try {
    const r = await runPnputil(['/export-driver', '*', folder], (c) => (running = c));
    if (cancelled) throw new Error('Đã hủy export — thư mục dở dang đã được xóa.');

    const exported = (await readdir(folder, { withFileTypes: true })).filter((d) => d.isDirectory()).length;
    if (exported === 0) throw new Error(`pnputil không export được gói nào (${r.code}): ${r.output.trim().split('\n').pop() ?? ''}`);
    onProgress({ done: exported, total });

    const rows = await listThirdPartyDrivers();
    const header = ['Thiết bị', 'INF (Driver Store)', 'Nhà cung cấp', 'Phiên bản', 'Ngày', 'Loại', 'Hardware ID'];
    const csv = [header, ...rows.map((x) => [x.deviceName, x.infName, x.provider, x.version, x.date, x.deviceClass, x.hardwareId])]
      .map((cols) => cols.map((c) => csvCell(c)).join(','))
      .join('\r\n');
    await writeFile(join(folder, 'DANH-SACH-DRIVER.csv'), '\uFEFF' + csv + '\r\n', 'utf8');
    await writeFile(
      join(folder, 'HUONG-DAN-KHOI-PHUC.txt'),
      [
        `Sao lưu driver của máy ${hostname()} lúc ${new Date().toLocaleString('vi-VN')}`,
        `Số gói: ${exported}/${total} (chỉ driver bên thứ ba; driver có sẵn của Windows không cần sao lưu).`,
        'DANH-SACH-DRIVER.csv cho biết mỗi thiết bị dùng gói oemXX.inf nào.',
        '',
        'KHÔI PHỤC (tự làm, cần quyền admin):',
        '  • Từng thiết bị: Device Manager > chuột phải thiết bị > Update driver > Browse my computer',
        '    > chọn thư mục này, tick "Include subfolders".',
        '  • Tất cả một lần: mở PowerShell/Command Prompt bằng "Run as administrator" rồi chạy',
        `      pnputil /add-driver "${folder}\\*.inf" /subdirs /install`,
        '',
        'SearchDriverPC chỉ sao chép gói driver ra đây, không cài hay thay đổi gì trên máy.',
        '',
      ].join('\r\n'),
      'utf8',
    );
    return { saved: true, folder, exported, total, sizeBytes: await folderSize(folder) };
  } catch (err) {
    if (cancelled) await rm(folder, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  } finally {
    clearInterval(timer);
    running = null;
  }
}
