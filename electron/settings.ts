import { app } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Cài đặt nhỏ lưu ở %APPDATA%\SearchDriverPC\settings.json. */
interface Settings {
  /** Thư mục người dùng chọn lần gần nhất để lưu driver tải về. */
  downloadDir?: string;
  /** Thư mục người dùng chọn lần gần nhất để export driver. */
  exportDir?: string;
}

type Key = keyof Settings;

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

function load(): Settings {
  try {
    return JSON.parse(readFileSync(settingsPath(), 'utf8')) as Settings;
  } catch {
    return {};
  }
}

/** Nếu không ghi được file cài đặt (ổ đầy...) vẫn nhớ được trong phiên này. */
const session: Settings = {};

function defaultFor(key: Key): string {
  return key === 'downloadDir'
    ? join(app.getPath('downloads'), 'SearchDriverPC')
    : join(app.getPath('documents'), 'SearchDriverPC-DriverBackup');
}

export function getDir(key: Key): string {
  return session[key] ?? load()[key] ?? defaultFor(key);
}

export function setDir(key: Key, dir: string): void {
  session[key] = dir;
  try {
    writeFileSync(settingsPath(), JSON.stringify({ ...load(), [key]: dir }, null, 2), 'utf8');
  } catch {
    /* bỏ qua */
  }
}

export const currentDownloadDir = (): string => getDir('downloadDir');
