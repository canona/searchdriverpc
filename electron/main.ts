import { app, BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions, type WebContents } from 'electron';
import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isValidUpdateId } from './catalog';
import { downloadDriverPackage, isInside } from './driverDownload';
import { cancelExportAll, exportAllDrivers, exportDeviceDriver, getInstalledDriver } from './driverExport';
import { autoFindDriver, cachedEntry, searchDriversForDevice } from './driverFinder';
import { formatExport, problemDevices } from './exporter';
import { scanHardware } from './hardwareScan';
import { IdLookup } from './pciLookup';
import { currentDownloadDir, getDir, setDir } from './settings';
import type {
  DeviceInfo,
  DownloadPhase,
  DownloadProgress,
  DriverExportResult,
  ExportFormat,
  ExportResult,
  ScanResult,
} from './types';
import { isAllowedExternalUrl, WINDOWS_UPDATE_SETTINGS_URI } from './vendorLinks';
import { checkWindowsUpdate } from './windowsUpdate';

/*
 * Main process. Nguyên tắc bảo mật:
 *  - Renderer chạy sandbox, contextIsolation, không có Node; chỉ gọi được 5
 *    hàm qua preload (xem preload.ts).
 *  - Không có IPC nào nhận lệnh/đường dẫn/script tùy ý từ renderer.
 *  - Chỉ mở URL https thuộc allowlist hãng chính chủ (vendorLinks.ts).
 *  - App chỉ TẢI gói .cab do Microsoft ký từ Microsoft Update Catalog (đã xác
 *    minh hash + chữ ký), KHÔNG cài và KHÔNG thực thi bất kỳ file nào trong gói.
 */

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

let lookup: IdLookup | null = null;
let lastScan: ScanResult | null = null;

function idsDirectory(): string {
  // Bản đóng gói: electron-builder copy resources/*.ids vào <resources>/ids.
  // Khi dev: dist-electron/ nằm cạnh resources/ ở gốc project.
  return app.isPackaged ? join(process.resourcesPath, 'ids') : join(__dirname, '..', 'resources');
}

function getLookup(): IdLookup {
  // Parse ~2 MB file .ids mất vài chục ms -> làm một lần, lazy khi quét lần đầu.
  lookup ??= new IdLookup(idsDirectory());
  return lookup;
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    title: 'SearchDriverPC',
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // Không cho renderer mở cửa sổ mới hay điều hướng đi nơi khác.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!DEV_SERVER_URL || !url.startsWith(DEV_SERVER_URL)) event.preventDefault();
  });

  if (DEV_SERVER_URL) void win.loadURL(DEV_SERVER_URL);
  else void win.loadFile(join(__dirname, '..', 'dist', 'index.html'));
}

function registerIpc(): void {
  ipcMain.handle('scan-hardware', async () => {
    lastScan = await scanHardware(getLookup());
    return lastScan;
  });

  ipcMain.handle('check-windows-update', () => checkWindowsUpdate());

  ipcMain.handle('open-external', async (_event, url: unknown) => {
    if (!isAllowedExternalUrl(url)) throw new Error('URL không nằm trong danh sách trang chính chủ được phép.');
    await shell.openExternal(url);
  });

  ipcMain.handle('open-windows-update-settings', () => shell.openExternal(WINDOWS_UPDATE_SETTINGS_URI));

  registerDriverDownloadIpc();
  registerDriverExportIpc();

  ipcMain.handle('export-devices', async (event, format: unknown): Promise<ExportResult> => {
    if (format !== 'csv' && format !== 'txt') throw new Error('Định dạng export không hợp lệ.');
    if (!lastScan) throw new Error('Chưa có kết quả quét. Hãy quét trước khi export.');
    const fmt: ExportFormat = format;

    const win = BrowserWindow.fromWebContents(event.sender);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const options = {
      title: 'Lưu danh sách thiết bị thiếu driver',
      defaultPath: join(app.getPath('documents'), `thiet-bi-thieu-driver-${stamp}.${fmt}`),
      filters: [fmt === 'csv' ? { name: 'CSV', extensions: ['csv'] } : { name: 'Văn bản', extensions: ['txt'] }],
    };
    const { canceled, filePath } = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (canceled || !filePath) return { saved: false };

    await writeFile(filePath, formatExport(lastScan, fmt), 'utf8');
    return { saved: true, filePath, count: problemDevices(lastScan).length };
  });
}

/** Thiết bị theo id, lấy từ kết quả quét giữ ở main (không tin dữ liệu thiết bị từ renderer). */
function deviceById(id: unknown): DeviceInfo {
  const device = typeof id === 'string' ? lastScan?.devices.find((d) => d.id === id) : undefined;
  if (!device) throw new Error('Không tìm thấy thiết bị. Hãy quét lại.');
  return device;
}

/*
 * Tìm & tải driver từ Microsoft Update Catalog. Renderer chỉ gửi deviceId và
 * updateId (GUID); link tải do main tự hỏi catalog và kiểm tra host, nên renderer
 * không thể khiến app tải file từ nơi khác.
 */
function registerDriverDownloadIpc(): void {
  const active = new Set<string>();

  const progressTo = (sender: WebContents, deviceId: string) => (updateId: string) => {
    return (phase: DownloadPhase, receivedBytes: number, totalBytes: number | null) => {
      if (!sender.isDestroyed()) {
        const p: DownloadProgress = { deviceId, updateId, phase, receivedBytes, totalBytes };
        sender.send('download-progress', p);
      }
    };
  };

  /** Chặn tải trùng cùng lúc cho một thiết bị. */
  async function exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (active.has(key)) throw new Error('Thiết bị này đang được tải, vui lòng đợi.');
    active.add(key);
    try {
      return await fn();
    } finally {
      active.delete(key);
    }
  }

  ipcMain.handle('search-driver', (_e, deviceId: unknown) => searchDriversForDevice(deviceById(deviceId)));

  ipcMain.handle('download-driver', (event, deviceId: unknown, updateId: unknown) => {
    const device = deviceById(deviceId);
    if (!isValidUpdateId(updateId)) throw new Error('updateId không hợp lệ.');
    const entry = cachedEntry(device.id, updateId);
    if (!entry) throw new Error('Gói này không có trong kết quả tìm kiếm gần nhất. Hãy tìm lại.');
    return exclusive(device.id, () =>
      downloadDriverPackage(device, entry, currentDownloadDir(), progressTo(event.sender, device.id)(updateId)),
    );
  });

  ipcMain.handle('auto-find-driver', (event, deviceId: unknown) => {
    const device = deviceById(deviceId);
    return exclusive(device.id, () => autoFindDriver(device, currentDownloadDir(), progressTo(event.sender, device.id)));
  });

  ipcMain.handle('get-download-dir', () => currentDownloadDir());

  // Mỗi lần tải, renderer gọi hàm này trước để người dùng chọn thư mục lưu.
  ipcMain.handle('choose-download-dir', (event) =>
    pickFolder(event.sender, 'downloadDir', 'Chọn thư mục lưu driver tải về'),
  );

  // Chỉ mở THƯ MỤC (trong Explorer) nằm dưới thư mục người dùng đã chọn; không bao giờ mở/chạy file.
  ipcMain.handle('open-download-folder', async (_e, folder: unknown) => {
    if (typeof folder !== 'string' || ![...allowedRoots].some((root) => isInside(root, folder))) {
      throw new Error('Thư mục không hợp lệ.');
    }
    if (!(await stat(folder)).isDirectory()) throw new Error('Không phải thư mục.');
    const err = await shell.openPath(folder);
    if (err) throw new Error(err);
  });
}

/**
 * Các thư mục gốc người dùng đã chọn qua hộp thoại (tải + export). Chỉ thư mục
 * con của chúng mới được "Mở thư mục" -> renderer không thể mở đường dẫn tùy ý.
 */
const allowedRoots = new Set<string>();

async function pickFolder(sender: WebContents, key: 'downloadDir' | 'exportDir', title: string): Promise<string | null> {
  const win = BrowserWindow.fromWebContents(sender);
  const options: OpenDialogOptions = {
    title,
    defaultPath: getDir(key),
    buttonLabel: 'Chọn thư mục này',
    properties: ['openDirectory', 'createDirectory'],
  };
  const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  const dir = r.canceled ? undefined : r.filePaths[0];
  if (!dir) return null;
  setDir(key, dir);
  allowedRoots.add(dir);
  return dir;
}

/*
 * Export (sao lưu) driver đang cài qua pnputil. Mỗi lần export đều hỏi thư mục
 * đích; pnputil chỉ sao chép gói từ Driver Store, không cài/gỡ gì.
 */
function registerDriverExportIpc(): void {
  ipcMain.handle('get-installed-driver', (_e, deviceId: unknown) => getInstalledDriver(deviceById(deviceId)));

  ipcMain.handle('export-device-driver', async (event, deviceId: unknown): Promise<DriverExportResult> => {
    const device = deviceById(deviceId);
    const dest = await pickFolder(event.sender, 'exportDir', `Chọn thư mục export driver của "${device.name}"`);
    if (!dest) return { saved: false };
    return exportDeviceDriver(device, dest);
  });

  ipcMain.handle('export-all-drivers', async (event): Promise<DriverExportResult> => {
    const dest = await pickFolder(event.sender, 'exportDir', 'Chọn thư mục export toàn bộ driver');
    if (!dest) return { saved: false };
    return exportAllDrivers(dest, (p) => {
      if (!event.sender.isDestroyed()) event.sender.send('export-all-progress', p);
    });
  });

  ipcMain.handle('cancel-export-all', () => cancelExportAll());
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
