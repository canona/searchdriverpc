import { runPowerShellJson } from './powershell';
import type { WindowsUpdateDriver, WindowsUpdateResult } from './types';

/*
 * KIỂM TRA DRIVER QUA WINDOWS UPDATE (CHỈ TÌM KIẾM)
 * ================================================
 * Dùng COM API "Microsoft.Update.Session" có sẵn trong mọi bản Windows. Đây
 * chính là API mà module PSWindowsUpdate (Get-WindowsUpdate) bọc lại, nên không
 * bắt người dùng cài thêm module. Các lựa chọn khác trong spec:
 *   - UsoClient StartScan: chỉ kích hoạt quét ngầm, không trả kết quả.
 *   - Get-WindowsUpdateLog: chỉ xuất log lịch sử, không cho biết update đang chờ.
 *
 * Query "IsInstalled=0 and Type='Driver' and IsHidden=0" = các driver chưa cài,
 * chưa bị ẩn — tương ứng mục "Optional updates > Driver updates" trong Settings.
 *
 * IUpdateSearcher.Search() chạy được với quyền user thường. Script này KHÔNG gọi
 * CreateUpdateDownloader/CreateUpdateInstaller: không tải, không cài gì. Người
 * dùng tự cài qua Settings (nút "Mở Windows Update").
 */

const WU_SCRIPT = `
$session  = New-Object -ComObject Microsoft.Update.Session
$searcher = $session.CreateUpdateSearcher()
$result   = $searcher.Search("IsInstalled=0 and Type='Driver' and IsHidden=0")
$updates = @(foreach ($u in $result.Updates) {
  [pscustomobject]@{
    title        = $u.Title
    manufacturer = $u.DriverManufacturer
    model        = $u.DriverModel
    driverClass  = $u.DriverClass
    hardwareId   = $u.DriverHardwareID
    driverDate   = $(if ($u.DriverVerDate) { ([datetime]$u.DriverVerDate).ToString('yyyy-MM-dd') } else { $null })
    sizeMB       = [math]::Round($u.MaxDownloadSize / 1MB, 1)
  }
})
[pscustomobject]@{ updates = $updates } | ConvertTo-Json -Depth 3 -Compress
`;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export async function checkWindowsUpdate(): Promise<WindowsUpdateResult> {
  // Lần tìm đầu tiên có thể mất vài phút (Windows Update phải tải metadata).
  const raw = await runPowerShellJson<{ updates?: unknown }>(WU_SCRIPT, 5 * 60_000);
  const list = Array.isArray(raw.updates) ? raw.updates : raw.updates ? [raw.updates] : [];

  const updates: WindowsUpdateDriver[] = list.map((u: Record<string, unknown>) => ({
    title: str(u.title) ?? '(không có tiêu đề)',
    manufacturer: str(u.manufacturer),
    model: str(u.model),
    driverClass: str(u.driverClass),
    hardwareId: str(u.hardwareId),
    driverDate: str(u.driverDate),
    sizeMB: typeof u.sizeMB === 'number' ? u.sizeMB : null,
  }));

  return { checkedAt: new Date().toISOString(), updates };
}
