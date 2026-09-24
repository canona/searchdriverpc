import type { DriverApi } from '../electron/types';

declare global {
  interface Window {
    /** Được preload.ts gắn vào; undefined nếu mở trang ngoài Electron. */
    driverApi?: DriverApi;
  }
}
