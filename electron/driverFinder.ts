import { release } from 'node:os';
import { buildQueries, rankEntries, searchCatalog, type HostEnvironment } from './catalog';
import { downloadDriverPackage, removePackage, type ProgressFn } from './driverDownload';
import type { AutoFindResult, CatalogEntry, DeviceInfo, DownloadedDriver, DriverSearchResult } from './types';

/** Số gói tối đa chế độ tự động thử tải cho một thiết bị trước khi bỏ cuộc. */
const AUTO_MAX_TRIES = 3;
/** Chế độ tự động bỏ qua gói lớn hơn mức này (người dùng vẫn tải tay được). */
const AUTO_MAX_BYTES = 1.5 * 1024 ** 3;

export function hostEnvironment(): HostEnvironment {
  const build = Number(release().split('.')[2]) || 0;
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' ? 'ia32' : 'x64';
  return { osBuild: build, arch };
}

/** Kết quả tìm kiếm gần nhất của từng thiết bị (để lấy metadata khi tải theo updateId). */
const searchCache = new Map<string, DriverSearchResult>();

export async function searchDriversForDevice(device: DeviceInfo): Promise<DriverSearchResult> {
  const { specific, general } = buildQueries(device);
  if (!general) {
    throw new Error('Thiết bị không có Vendor/Device ID dạng PCI hoặc USB nên không tìm được trên catalog.');
  }
  const [specificHits, generalHits] = await Promise.all([
    specific ? searchCatalog(specific) : Promise.resolve([]),
    searchCatalog(general),
  ]);
  const result: DriverSearchResult = {
    deviceId: device.id,
    queries: [specific, general].filter((q): q is string => !!q),
    entries: rankEntries(specificHits, generalHits, hostEnvironment()),
  };
  searchCache.set(device.id, result);
  return result;
}

export function cachedEntry(deviceId: string, updateId: string): CatalogEntry | undefined {
  return searchCache.get(deviceId)?.entries.find((e) => e.updateId === updateId);
}

/**
 * Tự tìm + tải: lấy các gói xếp hạng cao nhất, tải lần lượt; gói nào có .inf
 * liệt kê đúng Hardware ID thì giữ lại và dừng. Gói không khớp bị xóa ngay để
 * không để lại driver sai trong thư mục tải.
 */
export async function autoFindDriver(
  device: DeviceInfo,
  downloadRoot: string,
  onProgress: (updateId: string) => ProgressFn,
): Promise<AutoFindResult> {
  let search: DriverSearchResult;
  try {
    search = await searchDriversForDevice(device);
  } catch (err) {
    return { deviceId: device.id, outcome: 'failed', message: (err as Error).message, tried: 0 };
  }

  const candidates = search.entries
    .filter((e) => e.sizeBytes === null || e.sizeBytes <= AUTO_MAX_BYTES)
    .slice(0, AUTO_MAX_TRIES);
  if (candidates.length === 0) {
    return {
      deviceId: device.id,
      outcome: 'no-results',
      message:
        search.entries.length > 0
          ? 'Chỉ có gói lớn hơn 1.5 GB — hãy tải thủ công trong phần chi tiết thiết bị.'
          : 'Microsoft Update Catalog không có gói phù hợp.',
      tried: 0,
    };
  }

  let tried = 0;
  let lastError: string | null = null;
  for (const entry of candidates) {
    tried++;
    let driver: DownloadedDriver;
    try {
      driver = await downloadDriverPackage(device, entry, downloadRoot, onProgress(entry.updateId));
    } catch (err) {
      lastError = (err as Error).message;
      continue;
    }
    if (driver.infMatched) {
      return { deviceId: device.id, outcome: 'downloaded', driver, message: `Đã tải và xác minh: ${entry.title}`, tried };
    }
    await removePackage(downloadRoot, driver.folder);
  }

  return {
    deviceId: device.id,
    outcome: lastError && tried === 1 ? 'failed' : 'no-match',
    message: lastError
      ? `Không tải được gói phù hợp (${lastError}).`
      : `Đã thử ${tried} gói nhưng không gói nào có .inf khớp Hardware ID — đã xóa. Hãy xem danh sách kết quả và chọn thủ công.`,
    tried,
  };
}
