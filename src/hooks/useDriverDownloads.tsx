import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  AutoFindResult,
  DeviceInfo,
  DownloadedDriver,
  DownloadProgress,
  DriverSearchResult,
} from '../../electron/types';
import { errorMessage, getApi } from '../api';

/** Trạng thái tìm/tải driver của MỘT thiết bị. */
export interface DeviceDriverState {
  searching?: boolean;
  search?: DriverSearchResult;
  searchError?: string;
  /** updateId đang tải (mỗi thiết bị tải một gói một lúc). */
  downloadingId?: string;
  progress?: DownloadProgress;
  /** Kết quả tải theo updateId. */
  downloaded: Record<string, DownloadedDriver>;
  downloadErrors: Record<string, string>;
  autoRunning?: boolean;
  auto?: AutoFindResult;
}

interface DriverDownloadsContext {
  states: Record<string, DeviceDriverState>;
  downloadDir: string | null;
  search(deviceId: string): Promise<void>;
  download(deviceId: string, updateId: string): Promise<void>;
  /** askFolder=false khi thư mục đã được chọn trước (chạy hàng loạt). */
  autoFind(deviceId: string, askFolder?: boolean): Promise<AutoFindResult | undefined>;
  autoFindAll(devices: DeviceInfo[]): Promise<void>;
  bulkRunning: boolean;
  cancelBulk(): void;
  openFolder(folder: string): Promise<void>;
  lastError: string | null;
}

const Ctx = createContext<DriverDownloadsContext | null>(null);

const EMPTY: DeviceDriverState = { downloaded: {}, downloadErrors: {} };

export function DriverDownloadsProvider({ children }: { children: ReactNode }) {
  const [states, setStates] = useState<Record<string, DeviceDriverState>>({});
  const [downloadDir, setDownloadDir] = useState<string | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const patch = useCallback((deviceId: string, fn: (s: DeviceDriverState) => Partial<DeviceDriverState>) => {
    setStates((prev) => {
      const cur = prev[deviceId] ?? EMPTY;
      return { ...prev, [deviceId]: { ...cur, ...fn(cur) } };
    });
  }, []);

  useEffect(() => {
    const api = window.driverApi;
    if (!api) return;
    api.getDownloadDir().then(setDownloadDir, () => undefined);
    // Tiến trình tải do main process đẩy sang.
    return api.onDownloadProgress((p) => patch(p.deviceId, () => ({ progress: p, downloadingId: p.updateId })));
  }, [patch]);

  /**
   * Hỏi người dùng thư mục lưu trước MỖI lần tải (mặc định là thư mục lần trước).
   * Trả false nếu người dùng bấm Hủy -> không tải.
   */
  const pickFolder = useCallback(async (): Promise<boolean> => {
    try {
      const dir = await getApi().chooseDownloadDir();
      if (dir) setDownloadDir(dir);
      return !!dir;
    } catch (err) {
      setLastError(errorMessage(err));
      return false;
    }
  }, []);

  const search = useCallback(
    async (deviceId: string) => {
      patch(deviceId, () => ({ searching: true, searchError: undefined }));
      try {
        const result = await getApi().searchDriver(deviceId);
        patch(deviceId, () => ({ searching: false, search: result }));
      } catch (err) {
        patch(deviceId, () => ({ searching: false, searchError: errorMessage(err) }));
      }
    },
    [patch],
  );

  const download = useCallback(
    async (deviceId: string, updateId: string) => {
      if (!(await pickFolder())) return;
      patch(deviceId, (s) => ({
        downloadingId: updateId,
        progress: undefined,
        downloadErrors: { ...s.downloadErrors, [updateId]: '' },
      }));
      try {
        const r = await getApi().downloadDriver(deviceId, updateId);
        patch(deviceId, (s) => ({ downloadingId: undefined, downloaded: { ...s.downloaded, [updateId]: r } }));
      } catch (err) {
        patch(deviceId, (s) => ({
          downloadingId: undefined,
          downloadErrors: { ...s.downloadErrors, [updateId]: errorMessage(err) },
        }));
      }
    },
    [patch, pickFolder],
  );

  const autoFind = useCallback(
    async (deviceId: string, askFolder = true) => {
      if (askFolder && !(await pickFolder())) return undefined;
      patch(deviceId, () => ({ autoRunning: true, auto: undefined, progress: undefined }));
      try {
        const r = await getApi().autoFindDriver(deviceId);
        patch(deviceId, (s) => ({
          autoRunning: false,
          downloadingId: undefined,
          auto: r,
          downloaded: r.driver ? { ...s.downloaded, [r.driver.updateId]: r.driver } : s.downloaded,
        }));
        return r;
      } catch (err) {
        const r: AutoFindResult = { deviceId, outcome: 'failed', message: errorMessage(err), tried: 0 };
        patch(deviceId, () => ({ autoRunning: false, downloadingId: undefined, auto: r }));
        return r;
      }
    },
    [patch, pickFolder],
  );

  /** Chạy tuần tự từng thiết bị để không tải song song nhiều gói lớn. */
  const autoFindAll = useCallback(
    async (devices: DeviceInfo[]) => {
      // Chọn thư mục MỘT lần cho cả lượt tải hàng loạt.
      if (!(await pickFolder())) return;
      cancelRef.current = false;
      setBulkRunning(true);
      try {
        for (const d of devices) {
          if (cancelRef.current) break;
          await autoFind(d.id, false);
        }
      } finally {
        setBulkRunning(false);
      }
    },
    [autoFind, pickFolder],
  );

  const openFolder = useCallback(async (folder: string) => {
    try {
      await getApi().openDownloadFolder(folder);
    } catch (err) {
      setLastError(errorMessage(err));
    }
  }, []);

  const value = useMemo<DriverDownloadsContext>(
    () => ({
      states,
      downloadDir,
      search,
      download,
      autoFind,
      autoFindAll,
      bulkRunning,
      cancelBulk: () => {
        cancelRef.current = true;
      },
      openFolder,
      lastError,
    }),
    [states, downloadDir, search, download, autoFind, autoFindAll, bulkRunning, openFolder, lastError],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDriverDownloads(): DriverDownloadsContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDriverDownloads phải nằm trong DriverDownloadsProvider');
  return ctx;
}

export function useDeviceDriverState(deviceId: string): DeviceDriverState {
  return useDriverDownloads().states[deviceId] ?? EMPTY;
}

/** Thiết bị có thể tìm trên catalog: có vấn đề và có Vendor ID PCI/USB. */
export function canSearchCatalog(d: DeviceInfo): boolean {
  return d.status !== 'ok' && !!d.parsedId?.idSpace && !!d.parsedId.vendorId;
}

export function formatBytes(n: number | null | undefined): string {
  if (!n) return '—';
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export const PHASE_LABEL: Record<DownloadProgress['phase'], string> = {
  resolving: 'Đang lấy link tải…',
  downloading: 'Đang tải',
  verifying: 'Đang kiểm tra SHA-256…',
  extracting: 'Đang giải nén…',
  checking: 'Đang đối chiếu .inf…',
  done: 'Xong',
};
