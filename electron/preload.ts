import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { DownloadProgress, DriverApi, ExportAllProgress } from './types';

/** Đăng ký nghe một kênh sự kiện từ main; trả về hàm hủy đăng ký. */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

// Cầu nối duy nhất giữa renderer và main: chỉ phơi ra đúng các hàm cần dùng,
// không phơi ipcRenderer hay bất kỳ API Node nào.
const api: DriverApi = {
  scanHardware: () => ipcRenderer.invoke('scan-hardware'),
  checkWindowsUpdate: () => ipcRenderer.invoke('check-windows-update'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openWindowsUpdateSettings: () => ipcRenderer.invoke('open-windows-update-settings'),
  exportDevices: (format) => ipcRenderer.invoke('export-devices', format),

  searchDriver: (deviceId) => ipcRenderer.invoke('search-driver', deviceId),
  downloadDriver: (deviceId, updateId) => ipcRenderer.invoke('download-driver', deviceId, updateId),
  autoFindDriver: (deviceId) => ipcRenderer.invoke('auto-find-driver', deviceId),
  onDownloadProgress: (listener) => subscribe<DownloadProgress>('download-progress', listener),
  getDownloadDir: () => ipcRenderer.invoke('get-download-dir'),
  chooseDownloadDir: () => ipcRenderer.invoke('choose-download-dir'),
  openDownloadFolder: (folder) => ipcRenderer.invoke('open-download-folder', folder),

  getInstalledDriver: (deviceId) => ipcRenderer.invoke('get-installed-driver', deviceId),
  exportDeviceDriver: (deviceId) => ipcRenderer.invoke('export-device-driver', deviceId),
  exportAllDrivers: () => ipcRenderer.invoke('export-all-drivers'),
  cancelExportAll: () => ipcRenderer.invoke('cancel-export-all'),
  onExportAllProgress: (listener) => subscribe<ExportAllProgress>('export-all-progress', listener),
};

contextBridge.exposeInMainWorld('driverApi', api);
