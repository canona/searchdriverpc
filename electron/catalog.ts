import { shortHardwareId } from './hardwareId';
import { httpText, type HttpOptions } from './http';
import type { CatalogEntry, DeviceInfo } from './types';

/*
 * TÌM DRIVER TRÊN MICROSOFT UPDATE CATALOG
 * ========================================
 * https://www.catalog.update.microsoft.com là kho driver chính thức của Microsoft
 * (cùng nguồn với Windows Update). Mọi gói driver là file .cab đã được Microsoft
 * ký số (WHQL). Catalog không có API JSON công khai nên ta đọc 2 trang:
 *
 * 1) Search.aspx?q=<Hardware ID>  -> bảng HTML, mỗi kết quả là một <tr>:
 *      <tr id="{GUID}_R{n}">
 *        <td id="{GUID}_C1_R{n}"> <a>Tiêu đề</a>            (vd "INTEL - System - 10.1.1.40")
 *        <td id="{GUID}_C2_R{n}"> Products                   (vd "Windows 10 and later drivers")
 *        <td id="{GUID}_C3_R{n}"> Classification             (vd "Drivers (Other Hardware)")
 *        <td id="{GUID}_C4_R{n}"> Last updated, dạng M/D/YYYY
 *        <td id="{GUID}_C5_R{n}"> Version hoặc "n/a"
 *        <td id="{GUID}_C6_R{n}"> <span id="{GUID}_originalSize">số byte</span>
 *    {GUID} chính là updateID dùng ở bước 2.
 *
 * 2) POST DownloadDialog.aspx (updateIDs=[{...}]) -> trang trả về đoạn JS:
 *      downloadInformation[0].files[0].url      = 'https://catalog.s.download.windowsupdate.com/...cab'
 *      downloadInformation[0].files[0].sha256   = '<base64>'
 *      downloadInformation[0].files[0].digest   = '<base64 SHA-1>'
 *      downloadInformation[0].files[0].fileName = '....cab'
 *
 * Tìm kiếm của catalog khá "lỏng" (tách từ, có thể trả hàng trăm kết quả), nên
 * kết quả chỉ là ỨNG VIÊN: sau khi tải, driverDownload.ts còn kiểm tra file .inf
 * trong gói có thật sự liệt kê Hardware ID của thiết bị hay không.
 */

const CATALOG = 'https://www.catalog.update.microsoft.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SearchDriverPC/1.0';
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUpdateId(id: unknown): id is string {
  return typeof id === 'string' && GUID_RE.test(id);
}

// ---------------------------------------------------------------------------
// Parse HTML
// ---------------------------------------------------------------------------

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function cellText(html: string, guid: string, col: number): string {
  const m = new RegExp(String.raw`id="${guid}_C${col}_R\d+"[^>]*>([\s\S]*?)</td>`, 'i').exec(html);
  if (!m) return '';
  return decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** "1/2/2017" (M/D/YYYY, định dạng Mỹ của catalog) -> "2017-01-02". */
export function parseUsDate(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/** Kết quả thô (chưa chấm điểm) đọc từ trang Search.aspx. */
export type RawCatalogEntry = Omit<CatalogEntry, 'score' | 'matchedSubsys' | 'recommended'>;

export function parseSearchHtml(html: string): RawCatalogEntry[] {
  const entries: RawCatalogEntry[] = [];
  const seen = new Set<string>();
  const rowRe = /<tr id="([0-9a-f-]{36})_R\d+"/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const guid = m[1].toLowerCase();
    if (seen.has(guid) || !GUID_RE.test(guid)) continue;
    seen.add(guid);

    const title = cellText(html, m[1], 1);
    if (!title) continue; // hàng tiêu đề bảng
    const versionCell = cellText(html, m[1], 5);
    // Cột Version thường là "n/a"; khi đó lấy số phiên bản ở cuối tiêu đề ("... - 10.1.1.40").
    const version =
      versionCell && versionCell.toLowerCase() !== 'n/a'
        ? versionCell
        : (/ - (\d+(?:\.\d+){1,3})\s*$/.exec(title)?.[1] ?? null);
    const size = new RegExp(String.raw`id="${m[1]}_originalSize"[^>]*>\s*(\d+)\s*<`, 'i').exec(html);

    entries.push({
      updateId: guid,
      title,
      products: cellText(html, m[1], 2),
      classification: cellText(html, m[1], 3),
      lastUpdated: parseUsDate(cellText(html, m[1], 4)),
      version,
      sizeBytes: size ? Number(size[1]) : null,
    });
  }
  return entries;
}

export interface DownloadInfo {
  url: string;
  fileName: string;
  sha256: string | null; // base64
  sha1: string | null; //   base64
}

/** Đọc các dòng "downloadInformation[0].files[i].x = '...'" và chọn file .cab. */
export function parseDownloadDialog(html: string): DownloadInfo | null {
  const files = new Map<number, Record<string, string>>();
  const re = /downloadInformation\[0\]\.files\[(\d+)\]\.(\w+)\s*=\s*'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const idx = Number(m[1]);
    if (!files.has(idx)) files.set(idx, {});
    files.get(idx)![m[2]] = m[3];
  }
  for (const f of files.values()) {
    if (f.url && /\.cab$/i.test(f.fileName ?? f.url)) {
      return { url: f.url, fileName: f.fileName ?? f.url.split('/').pop()!, sha256: f.sha256 || null, sha1: f.digest || null };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Xếp hạng
// ---------------------------------------------------------------------------

export interface HostEnvironment {
  /** Số build Windows, vd 22621. >= 22000 là Windows 11. */
  osBuild: number;
  arch: 'x64' | 'arm64' | 'ia32';
}

/**
 * Chấm điểm độ phù hợp của một gói với máy hiện tại. Trả về null nếu chắc chắn
 * không dùng được (sai kiến trúc CPU, chỉ dành cho Windows cũ).
 *
 *  +40  tìm được bằng Hardware ID có SUBSYS (driver dành đúng cho model máy/bo mạch)
 *  +30  products ghi Windows 11 và máy chạy Windows 11
 *  +20  products ghi Windows 10 (driver Win10 "and later" chạy được trên Win11)
 *  -15  products ghi Windows 11 nhưng máy chạy Windows 10
 *  -10  chỉ dành cho Windows Server
 *  null chỉ dành cho Windows 7/8/Vista/XP, hoặc sai kiến trúc (ARM64 vs x64)
 * Cùng điểm thì gói mới hơn đứng trước.
 */
export function scoreEntry(e: RawCatalogEntry, matchedSubsys: boolean, env: HostEnvironment): number | null {
  const text = `${e.title} ${e.products}`;
  const isArm = /\barm64\b/i.test(text);
  const isX64Only = /\b(x64|amd64)\b/i.test(e.title) && !isArm;
  if (env.arch === 'arm64' ? isX64Only : isArm) return null;
  if (env.arch === 'ia32' && isX64Only) return null;

  const win11 = /windows 11/i.test(e.products);
  const win10 = /windows 10/i.test(e.products);
  const serverOnly = /server/i.test(e.products) && !win10 && !win11;
  const legacyOnly = /windows (7|8(?!\.1 and later)|vista|xp)\b/i.test(e.products) && !win10 && !win11;
  if (legacyOnly) return null;

  let score = 0;
  if (matchedSubsys) score += 40;
  const hostIsWin11 = env.osBuild >= 22000;
  if (win11) score += hostIsWin11 ? 30 : -15;
  if (win10) score += 20;
  if (/windows 8\.1 and later/i.test(e.products)) score += 5;
  if (serverOnly) score -= 10;
  return score;
}

export function rankEntries(
  specific: RawCatalogEntry[],
  general: RawCatalogEntry[],
  env: HostEnvironment,
): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  const seen = new Set<string>();
  // Cùng một gói (cùng tiêu đề + kích thước) thường được liệt kê nhiều lần cho nhiều "product" -> gộp.
  const seenPackage = new Set<string>();
  const add = (list: RawCatalogEntry[], matchedSubsys: boolean) => {
    for (const e of list) {
      if (seen.has(e.updateId)) continue;
      seen.add(e.updateId);
      const score = scoreEntry(e, matchedSubsys, env);
      if (score === null) continue;
      const pkgKey = `${e.title}|${e.sizeBytes}`;
      if (seenPackage.has(pkgKey)) continue;
      seenPackage.add(pkgKey);
      out.push({ ...e, score, matchedSubsys, recommended: false });
    }
  };
  add(specific, true);
  add(general, false);

  out.sort(
    (a, b) =>
      b.score - a.score ||
      (b.lastUpdated ?? '').localeCompare(a.lastUpdated ?? '') ||
      compareVersions(b.version, a.version),
  );
  if (out[0]) out[0].recommended = true;
  return out;
}

function compareVersions(a: string | null, b: string | null): number {
  const pa = (a ?? '').split('.').map(Number);
  const pb = (b ?? '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Truy vấn
// ---------------------------------------------------------------------------

/**
 * Hai truy vấn cho mỗi thiết bị:
 *  - cụ thể: Hardware ID đầu tiên có SUBSYS, bỏ phần &REV_xx (catalog hiếm khi lập chỉ mục theo REV)
 *  - chung:  BUS\VEN_xxxx&DEV_yyyy
 */
export function buildQueries(device: DeviceInfo): { specific: string | null; general: string | null } {
  const parsed = device.parsedId;
  if (!parsed?.vendorId) return { specific: null, general: null };
  const withSubsys = device.hardwareIds.find((h) => /&SUBSYS_[0-9a-f]{8}/i.test(h));
  const specific = withSubsys ? withSubsys.replace(/&REV_[0-9a-f]+/i, '') : null;
  const general = shortHardwareId(parsed);
  return { specific: specific && specific !== general ? specific : null, general };
}

async function catalogText(url: string, init?: Pick<HttpOptions, 'method' | 'headers' | 'body'>): Promise<string> {
  const res = await httpText(url, { ...init, headers: { 'User-Agent': USER_AGENT, ...init?.headers }, timeoutMs: 30_000 });
  if (res.status < 200 || res.status >= 300) throw new Error(`Microsoft Update Catalog trả lỗi HTTP ${res.status}`);
  return res.text;
}

export async function searchCatalog(query: string): Promise<RawCatalogEntry[]> {
  const html = await catalogText(`${CATALOG}/Search.aspx?q=${encodeURIComponent(query)}`);
  if (html.includes('id="ctl00_catalogBody_noResultText"') && !/_R\d+"/.test(html)) return [];
  return parseSearchHtml(html);
}

export async function getDownloadInfo(updateId: string): Promise<DownloadInfo> {
  if (!isValidUpdateId(updateId)) throw new Error('updateId không hợp lệ');
  const body =
    'updateIDs=' +
    encodeURIComponent(JSON.stringify([{ size: 0, languages: '', uidInfo: updateId, updateID: updateId }]));
  const html = await catalogText(`${CATALOG}/DownloadDialog.aspx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const info = parseDownloadDialog(html);
  if (!info) throw new Error('Catalog không trả về link tải .cab cho gói này.');
  return info;
}

/**
 * Chỉ cho phép tải từ máy chủ phân phối của Microsoft. Link cũ trên catalog
 * đôi khi là http:// -> luôn nâng lên https:// (các host này đều hỗ trợ).
 */
export function normalizeDownloadUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  const allowed =
    host === 'download.windowsupdate.com' ||
    host.endsWith('.download.windowsupdate.com') ||
    host.endsWith('.delivery.mp.microsoft.com') ||
    host === 'download.microsoft.com';
  if (!allowed || !/\.cab$/i.test(url.pathname)) return null;
  return url.toString();
}
