import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, statfs, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getDownloadInfo, normalizeDownloadUrl } from './catalog';
import { shortHardwareId } from './hardwareId';
import { httpRequest } from './http';
import { runPowerShellJson } from './powershell';
import type { CatalogEntry, DeviceInfo, DownloadedDriver, DownloadPhase } from './types';
import { isLegacyWindows, listFilesRecursive } from './winCompat';

/*
 * TẢI GÓI DRIVER VỀ MÁY — KHÔNG CÀI ĐẶT
 * =====================================
 * Quy trình cho một gói:
 *   1. Hỏi catalog link tải (DownloadDialog.aspx). Chỉ nhận file .cab trên máy chủ
 *      phân phối của Microsoft (normalizeDownloadUrl).
 *   2. Tải về "package.cab.part", vừa tải vừa tính SHA-256/SHA-1.
 *   3. So hash với giá trị catalog công bố -> sai là xóa ngay.
 *   4. Kiểm tra chữ ký Authenticode của .cab: phải "Valid" và do Microsoft ký
 *      (driver trên catalog đều được Microsoft ký WHQL) -> sai là xóa ngay.
 *   5. Giải nén bằng expand.exe của Windows vào thư mục "driver\".
 *   6. Đọc các file .inf, xem có dòng nào chứa Hardware ID của thiết bị không
 *      (vì tìm kiếm của catalog khá lỏng, bước này mới khẳng định gói đúng thiết bị).
 *
 * App KHÔNG gọi pnputil / DIFxAPI / UpdateDriverForPlugAndPlayDevices, KHÔNG chạy
 * file nào trong gói. Người dùng tự cài qua Device Manager (hướng dẫn ghi trong
 * file HUONG-DAN-CAI-DAT.txt đặt cạnh gói).
 */

const MAX_DOWNLOAD_BYTES = 2 * 1024 ** 3;

export type ProgressFn = (phase: DownloadPhase, receivedBytes: number, totalBytes: number | null) => void;

/** Tên thư mục an toàn trên Windows. */
function safeName(s: string, max = 60): string {
  const cleaned = s
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '')
    .trim();
  return (cleaned || 'driver').slice(0, max);
}

/** "VEN_8086&DEV_A121" / "VID_046D&PID_C52B" — chuỗi dùng để dò trong file .inf. */
function infNeedle(device: DeviceInfo): string | null {
  const p = device.parsedId;
  if (!p?.vendorId) return null;
  const short = shortHardwareId(p);
  return short.slice(short.indexOf('\\') + 1).toUpperCase();
}

/** File .inf có thể là UTF-16 LE (có BOM FF FE) hoặc ANSI/UTF-8. */
export function decodeInf(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  return buf.toString('latin1');
}

interface SignatureInfo {
  status: string;
  subject: string | null;
}

async function checkSignature(file: string): Promise<SignatureInfo> {
  return runPowerShellJson<SignatureInfo>(
    // PowerShell 2.0 (Win7) chưa có -LiteralPath cho lệnh này.
    `$s = if ($PSVersionTable.PSVersion.Major -ge 3) { Get-AuthenticodeSignature -LiteralPath $env:SDP_TARGET_FILE } else { Get-AuthenticodeSignature -FilePath $env:SDP_TARGET_FILE }
Out-Json @{ status = [string]$s.Status; subject = $(if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { $null }) }`,
    60_000,
    { SDP_TARGET_FILE: file },
  );
}

function expandCab(cab: string, dest: string): Promise<void> {
  // Dùng đường dẫn tuyệt đối tới expand.exe hệ thống để tránh bị thay thế qua PATH.
  const expandExe = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'expand.exe');
  return new Promise((ok, fail) => {
    execFile(expandExe, [cab, '-F:*', dest], { windowsHide: true, timeout: 5 * 60_000 }, (err, _out, stderr) =>
      err ? fail(new Error(`Giải nén thất bại: ${stderr || err.message}`)) : ok(),
    );
  });
}

async function ensureFreeSpace(dir: string, needed: number): Promise<void> {
  try {
    const s = await statfs(dir);
    const free = s.bavail * s.bsize;
    if (free < needed) {
      throw new Error(
        `Ổ đĩa chứa thư mục tải không đủ chỗ (còn ${(free / 1024 ** 2).toFixed(0)} MB, cần khoảng ${(needed / 1024 ** 2).toFixed(0)} MB). Hãy đổi thư mục tải.`,
      );
    }
  } catch (err) {
    if ((err as Error).message.startsWith('Ổ đĩa')) throw err;
    // statfs không khả dụng -> bỏ qua kiểm tra, để bước ghi file tự báo lỗi.
  }
}

/** Kiểm tra `child` nằm bên trong `parent` (chống path traversal). */
export function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel !== '' && !rel.startsWith('..') && !rel.includes(`..${sep}`) && !/^[a-z]:/i.test(rel);
}

export async function downloadDriverPackage(
  device: DeviceInfo,
  entry: Pick<CatalogEntry, 'updateId' | 'title' | 'version' | 'lastUpdated' | 'sizeBytes'>,
  downloadRoot: string,
  onProgress: ProgressFn,
): Promise<DownloadedDriver> {
  onProgress('resolving', 0, entry.sizeBytes);
  const info = await getDownloadInfo(entry.updateId);
  const url = normalizeDownloadUrl(info.url);
  if (!url) throw new Error('Link tải không thuộc máy chủ phân phối của Microsoft hoặc không phải file .cab — đã từ chối.');

  const deviceDir = safeName(`${device.deviceName ?? device.name} (${infNeedle(device) ?? 'unknown'})`, 90);
  const pkgDir = safeName(`${entry.version ?? entry.lastUpdated ?? 'driver'}_${entry.updateId.slice(0, 8)}`);
  const folder = join(downloadRoot, deviceDir, pkgDir);
  if (!isInside(downloadRoot, folder)) throw new Error('Đường dẫn thư mục tải không hợp lệ.');

  await mkdir(folder, { recursive: true });
  await ensureFreeSpace(folder, (entry.sizeBytes ?? 50 * 1024 ** 2) * 3);

  const partPath = join(folder, 'package.cab.part');
  const cabPath = join(folder, 'package.cab');
  const driverDir = join(folder, 'driver');

  try {
    // --- 2. Tải ---
    const res = await httpRequest(url, { timeoutMs: 30 * 60_000 });
    if (res.status < 200 || res.status >= 300) {
      res.body.destroy();
      throw new Error(`Tải thất bại: HTTP ${res.status}`);
    }
    const total = Number(res.headers['content-length']) || entry.sizeBytes || null;
    if (total && total > MAX_DOWNLOAD_BYTES) {
      res.body.destroy();
      throw new Error('Gói quá lớn (> 2 GB), bỏ qua.');
    }

    // Tính hash ngay trong lúc tải để không phải đọc lại cả file (gói GPU có thể vài trăm MB).
    const sha256 = createHash('sha256');
    const sha1 = createHash('sha1');
    let received = 0;
    let lastReport = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length;
        if (received > MAX_DOWNLOAD_BYTES) return cb(new Error('Gói vượt quá 2 GB, đã dừng tải.'));
        sha256.update(chunk);
        sha1.update(chunk);
        const now = Date.now();
        if (now - lastReport > 200) {
          lastReport = now;
          onProgress('downloading', received, total);
        }
        cb(null, chunk);
      },
    });
    await pipeline(res.body, meter, createWriteStream(partPath));
    onProgress('downloading', received, total);

    // --- 3. Hash ---
    onProgress('verifying', received, total);
    let hashVerified = false;
    if (info.sha256) {
      if (sha256.digest('base64') !== info.sha256) throw new Error('SHA-256 không khớp với catalog — file đã bị xóa.');
      hashVerified = true;
    } else if (info.sha1) {
      if (sha1.digest('base64') !== info.sha1) throw new Error('SHA-1 không khớp với catalog — file đã bị xóa.');
      hashVerified = true;
    }
    await rename(partPath, cabPath);

    // --- 4. Chữ ký số ---
    const sig = await checkSignature(cabPath);
    if (sig.status !== 'Valid') {
      // Win7 chưa cài bản vá SHA-2 (KB4474419/KB3033929) không đọc được chữ ký SHA-256 của Microsoft.
      const hint = isLegacyWindows() ? ' Trên Windows 7 cần cài bản vá hỗ trợ SHA-2 (KB4474419).' : '';
      throw new Error(`Chữ ký số không hợp lệ (${sig.status}) — file đã bị xóa.${hint}`);
    }
    if (!/O=Microsoft Corporation/i.test(sig.subject ?? '')) {
      throw new Error(`Gói không do Microsoft ký (${sig.subject ?? 'không rõ'}) — file đã bị xóa.`);
    }

    // --- 5. Giải nén (chỉ giải nén, không chạy gì) ---
    onProgress('extracting', received, total);
    await rm(driverDir, { recursive: true, force: true });
    await mkdir(driverDir);
    await expandCab(cabPath, driverDir);
    const files = await listFilesRecursive(driverDir);
    if (files.some((f) => !isInside(driverDir, f))) throw new Error('Gói chứa đường dẫn bất thường — đã xóa.');

    // --- 6. Đối chiếu .inf với Hardware ID ---
    onProgress('checking', received, total);
    const needle = infNeedle(device);
    const matchedInfFiles: string[] = [];
    if (needle) {
      for (const f of files.filter((x) => /\.inf$/i.test(x))) {
        if (decodeInf(await readFile(f)).toUpperCase().includes(needle)) matchedInfFiles.push(relative(driverDir, f));
      }
    }

    await writeFile(join(folder, 'HUONG-DAN-CAI-DAT.txt'), guideText(device, entry, sig.subject ?? '', matchedInfFiles), 'utf8');
    onProgress('done', received, total);

    return {
      deviceId: device.id,
      updateId: entry.updateId,
      title: entry.title,
      folder,
      hashVerified,
      signer: sig.subject ?? '',
      infMatched: matchedInfFiles.length > 0,
      matchedInfFiles,
      fileCount: files.length,
    };
  } catch (err) {
    // Có lỗi ở bất kỳ bước nào -> xóa sạch thư mục gói vừa tạo.
    await rm(folder, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
}

/** Xóa thư mục một gói đã tải (dùng khi chế độ tự động thấy INF không khớp). */
export async function removePackage(downloadRoot: string, folder: string): Promise<void> {
  if (isInside(downloadRoot, folder)) await rm(folder, { recursive: true, force: true });
}

function guideText(device: DeviceInfo, entry: Pick<CatalogEntry, 'updateId' | 'title'>, signer: string, infs: string[]): string {
  return [
    'GÓI DRIVER TẢI TỪ MICROSOFT UPDATE CATALOG (CHƯA CÀI ĐẶT)',
    '',
    `Thiết bị     : ${device.name}${device.deviceName ? ` — ${device.deviceName}` : ''}`,
    `Hardware ID  : ${device.hardwareIds[0] ?? device.id}`,
    `Gói driver   : ${entry.title}`,
    `Update ID    : ${entry.updateId}`,
    `Chữ ký số    : ${signer}`,
    `INF khớp     : ${infs.length ? infs.join(', ') : 'KHÔNG tìm thấy Hardware ID của thiết bị trong file .inf — cân nhắc trước khi cài'}`,
    '',
    'CÁCH TỰ CÀI (cần quyền admin):',
    '  1. Mở Device Manager (chuột phải nút Start > Device Manager).',
    '  2. Chuột phải thiết bị ở trên > Update driver.',
    '  3. Chọn "Browse my computer for drivers".',
    '  4. Trỏ tới thư mục "driver" nằm cạnh file này, tick "Include subfolders" > Next.',
    '',
    'SearchDriverPC không tự cài và không chạy bất kỳ file nào trong gói.',
    '',
  ].join('\r\n');
}
