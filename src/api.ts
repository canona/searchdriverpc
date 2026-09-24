import type { DriverApi } from '../electron/types';

/** Lấy API từ preload; báo lỗi rõ ràng nếu trang bị mở trong trình duyệt thường. */
export function getApi(): DriverApi {
  if (!window.driverApi) throw new Error('Ứng dụng phải chạy trong Electron (không tìm thấy window.driverApi).');
  return window.driverApi;
}

/** Electron bọc lỗi IPC thành "Error invoking remote method 'x': Error: ..." -> lấy phần cuối. */
export function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
