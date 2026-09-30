import { execFile } from 'node:child_process';

/*
 * Chạy một script PowerShell CỐ ĐỊNH (do app viết sẵn, không ghép input của
 * người dùng) và parse output JSON.
 *
 * - Truyền script qua -EncodedCommand (Base64 UTF-16LE) để tránh mọi vấn đề
 *   escape dấu nháy / ký tự đặc biệt khi đi qua command line.
 * - -NoProfile: không nạp profile của người dùng (nhanh hơn, kết quả ổn định).
 * - Ép [Console]::OutputEncoding = UTF-8 để tên thiết bị có dấu (tiếng Việt,
 *   ký hiệu ™ ®) không bị vỡ font khi Node đọc stdout.
 * - Chạy với quyền của user hiện tại; không có bước "runas"/nâng quyền nào.
 */
/*
 * Out-Json: xuất một giá trị ra stdout dạng JSON. Script dùng hàm này thay vì
 * gọi thẳng ConvertTo-Json, vì Windows 7 mặc định chỉ có PowerShell 2.0 (chưa có
 * ConvertTo-Json, [pscustomobject], Get-CimInstance). Trên PowerShell 3+ vẫn dùng
 * ConvertTo-Json gốc; trên 2.0 dùng bộ tuần tự hóa tự viết bên dưới.
 * Script chỉ nên dựng dữ liệu bằng hashtable @{...}, mảng @(...), chuỗi, số, bool.
 */
export const JSON_PRELUDE = String.raw`
function ConvertTo-SdpJson($o) {
  if ($null -eq $o) { return 'null' }
  if ($o -is [bool]) { if ($o) { return 'true' } else { return 'false' } }
  if ($o -is [datetime]) { $o = $o.ToString('o') }
  if ($o -is [string] -or $o -is [char] -or $o -is [enum] -or $o -is [guid]) {
    $s = ([string]$o).Replace('\', '\\').Replace('"', '\"')
    if ($s -match '[\x00-\x1f]') {
      $sb = New-Object System.Text.StringBuilder
      foreach ($c in $s.ToCharArray()) {
        if ([int]$c -lt 32) { [void]$sb.Append(('\u{0:x4}' -f [int]$c)) } else { [void]$sb.Append($c) }
      }
      $s = $sb.ToString()
    }
    return '"' + $s + '"'
  }
  if ($o -is [ValueType]) { return ([IFormattable]$o).ToString($null, [Globalization.CultureInfo]::InvariantCulture) }
  if ($o -is [Collections.IDictionary]) {
    $parts = @(foreach ($k in $o.Keys) { (ConvertTo-SdpJson ([string]$k)) + ':' + (ConvertTo-SdpJson $o[$k]) })
    return '{' + ($parts -join ',') + '}'
  }
  if ($o -is [Collections.IEnumerable]) {
    $parts = @(foreach ($x in $o) { ConvertTo-SdpJson $x })
    return '[' + ($parts -join ',') + ']'
  }
  $parts = @(foreach ($p in $o.PSObject.Properties) { (ConvertTo-SdpJson $p.Name) + ':' + (ConvertTo-SdpJson $p.Value) })
  return '{' + ($parts -join ',') + '}'
}
function Out-Json($o) {
  if ($PSVersionTable.PSVersion.Major -ge 3) { $json = ConvertTo-Json -InputObject $o -Depth 6 -Compress }
  else { $json = ConvertTo-SdpJson $o }
  # Ghi thẳng ra stdout: PowerShell 2.0 tự ngắt dòng output pipeline ở cột 80, làm hỏng JSON.
  [Console]::Out.Write($json)
}
`;

/** Script đầy đủ (prelude + script) — tách riêng để test chạy được với `powershell -Version 2`. */
export function buildPowerShellScript(script: string): string {
  return `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
${JSON_PRELUDE}
${script}`;
}

export function runPowerShellJson<T>(script: string, timeoutMs: number, env?: Record<string, string>): Promise<T> {
  const fullScript = buildPowerShellScript(script);
  const encoded = Buffer.from(fullScript, 'utf16le').toString('base64');

  return new Promise((resolve, reject) => {
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      {
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
        encoding: 'utf8',
        // Tham số (vd đường dẫn file) truyền qua biến môi trường, KHÔNG ghép vào script.
        env: env ? { ...process.env, ...env } : process.env,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr?.trim() || error.message;
          reject(new Error(error.killed ? `PowerShell quá thời gian (${timeoutMs / 1000}s)` : detail));
          return;
        }
        try {
          // Loại BOM nếu có rồi parse.
          resolve(JSON.parse(stdout.replace(/^﻿/, '').trim()) as T);
        } catch {
          reject(new Error(`Không đọc được kết quả PowerShell: ${stdout.slice(0, 300)}`));
        }
      },
    );
    // PowerShell 2.0 (Win7) đợi stdin đóng rồi mới thoát, dù chạy -EncodedCommand -> treo nếu không đóng.
    child.stdin?.end();
  });
}
