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
export function runPowerShellJson<T>(script: string, timeoutMs: number, env?: Record<string, string>): Promise<T> {
  const fullScript = `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
${script}`;
  const encoded = Buffer.from(fullScript, 'utf16le').toString('base64');

  return new Promise((resolve, reject) => {
    execFile(
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
  });
}
