import type { DriverStatus } from './types';

/*
 * MAP ConfigManagerErrorCode -> TRẠNG THÁI DỄ HIỂU
 * ================================================
 * Win32_PnPEntity.ConfigManagerErrorCode chính là "Device Manager error code"
 * (Code 10, Code 28, ...) mà người dùng thấy trong Device Manager. Tham khảo:
 * https://learn.microsoft.com/windows-hardware/drivers/install/device-manager-error-messages
 *
 * Ta gom ~50 mã thành 4 nhóm mà người dùng quan tâm:
 *   ok       : mã 0 — thiết bị chạy bình thường.
 *   missing  : THIẾU driver — Windows không tìm/không có driver để nạp.
 *              Mã 28 là điển hình ("drivers for this device are not installed");
 *              mã 1, 18, 24, 39 thực tế cũng hầu như luôn do driver không có
 *              hoặc hỏng file, cách xử lý giống nhau: cài lại driver.
 *   disabled : bị tắt có chủ đích (22 người dùng tắt, 29 firmware tắt,
 *              47 đã "safely remove"). Không phải lỗi driver.
 *   error    : driver CÓ nhưng không chạy được (10 không khởi động, 43 thiết bị
 *              báo lỗi, 52 chữ ký số không hợp lệ...). Thường cần cập nhật
 *              driver đúng phiên bản hoặc kiểm tra phần cứng.
 * Mã không có trong bảng -> coi là 'error' để không bỏ sót.
 *
 * Mã 45 ("device is not connected") được xử lý riêng ở hardwareScan.ts:
 * thiết bị đã rút ra, không cần driver lúc này -> bỏ khỏi danh sách.
 */

interface StatusEntry {
  status: DriverStatus;
  text: string;
  hint?: string;
}

const REINSTALL = 'Cài driver từ trang chính chủ của hãng chip hoặc hãng máy.';
const UPDATE = 'Thử cập nhật/cài lại driver đúng phiên bản; nếu vẫn lỗi, kiểm tra phần cứng.';
const RESTART = 'Khởi động lại máy.';

export const ERROR_CODE_TABLE: Readonly<Record<number, StatusEntry>> = {
  0: { status: 'ok', text: 'Hoạt động bình thường' },

  // --- Thiếu driver ---
  1: { status: 'missing', text: 'Chưa được cấu hình đúng (thường do thiếu driver)', hint: REINSTALL },
  18: { status: 'missing', text: 'Cần cài lại driver', hint: REINSTALL },
  24: { status: 'missing', text: 'Không có mặt, không hoạt động hoặc chưa có driver', hint: REINSTALL },
  28: { status: 'missing', text: 'Chưa cài driver', hint: REINSTALL },
  39: { status: 'missing', text: 'Không nạp được driver (file driver bị thiếu hoặc hỏng)', hint: REINSTALL },

  // --- Bị tắt ---
  22: { status: 'disabled', text: 'Đã bị vô hiệu hóa', hint: 'Bật lại trong Device Manager nếu cần dùng (cần quyền admin).' },
  29: { status: 'disabled', text: 'Bị tắt bởi firmware (BIOS/UEFI)', hint: 'Bật lại thiết bị trong BIOS/UEFI.' },
  47: { status: 'disabled', text: 'Đã được chuẩn bị để tháo an toàn', hint: 'Rút ra và cắm lại thiết bị.' },

  // --- Có driver nhưng lỗi ---
  3: { status: 'error', text: 'Driver có thể bị hỏng hoặc hệ thống thiếu bộ nhớ', hint: UPDATE },
  10: { status: 'error', text: 'Thiết bị không thể khởi động', hint: UPDATE },
  12: { status: 'error', text: 'Không đủ tài nguyên hệ thống (IRQ/bộ nhớ) cho thiết bị', hint: 'Tắt bớt thiết bị khác hoặc cập nhật BIOS.' },
  14: { status: 'error', text: 'Cần khởi động lại để thiết bị hoạt động', hint: RESTART },
  16: { status: 'error', text: 'Windows không xác định được đủ tài nguyên cho thiết bị', hint: UPDATE },
  19: { status: 'error', text: 'Thông tin cấu hình trong registry bị hỏng', hint: 'Gỡ thiết bị trong Device Manager rồi cài lại driver.' },
  21: { status: 'error', text: 'Windows đang gỡ thiết bị', hint: RESTART },
  31: { status: 'error', text: 'Không nạp được driver cần thiết', hint: UPDATE },
  32: { status: 'error', text: 'Dịch vụ driver đã bị tắt', hint: 'Cài lại driver để khôi phục dịch vụ.' },
  33: { status: 'error', text: 'Không xác định được tài nguyên cần cho thiết bị', hint: 'Có thể do phần cứng; thử cập nhật BIOS.' },
  34: { status: 'error', text: 'Thiết bị cần cấu hình thủ công', hint: 'Xem tài liệu của phần cứng.' },
  35: { status: 'error', text: 'Firmware thiếu thông tin cấu hình thiết bị', hint: 'Cập nhật BIOS/UEFI từ trang hãng máy.' },
  36: { status: 'error', text: 'Xung đột ngắt IRQ', hint: 'Kiểm tra cấu hình IRQ trong BIOS.' },
  37: { status: 'error', text: 'Không khởi tạo được driver', hint: UPDATE },
  38: { status: 'error', text: 'Phiên bản driver cũ vẫn còn trong bộ nhớ', hint: RESTART },
  40: { status: 'error', text: 'Khóa dịch vụ driver trong registry bị thiếu hoặc sai', hint: 'Cài lại driver.' },
  41: { status: 'error', text: 'Đã nạp driver nhưng không tìm thấy phần cứng', hint: 'Kiểm tra kết nối phần cứng, cài lại driver.' },
  42: { status: 'error', text: 'Trùng thiết bị đã có trong hệ thống', hint: RESTART },
  43: { status: 'error', text: 'Thiết bị báo lỗi và đã bị dừng', hint: UPDATE },
  44: { status: 'error', text: 'Một ứng dụng/dịch vụ đã tắt thiết bị', hint: RESTART },
  46: { status: 'error', text: 'Không truy cập được vì Windows đang tắt máy', hint: RESTART },
  48: { status: 'error', text: 'Driver bị chặn do có vấn đề tương thích đã biết', hint: 'Tải phiên bản driver mới hơn từ trang hãng.' },
  49: { status: 'error', text: 'Registry hệ thống vượt quá kích thước cho phép', hint: 'Gỡ các thiết bị không còn dùng.' },
  50: { status: 'error', text: 'Không áp dụng được toàn bộ thuộc tính cho thiết bị', hint: UPDATE },
  51: { status: 'error', text: 'Đang chờ thiết bị khác khởi động', hint: 'Kiểm tra các thiết bị lỗi khác trước.' },
  52: { status: 'error', text: 'Không xác minh được chữ ký số của driver', hint: 'Chỉ dùng driver có chữ ký từ trang chính chủ.' },
  53: { status: 'error', text: 'Thiết bị dành riêng cho kernel debugger', hint: 'Tắt kernel debugging nếu không cần.' },
  54: { status: 'error', text: 'Thiết bị gặp lỗi và đang được reset', hint: RESTART },
  56: { status: 'error', text: 'Windows đang hoàn tất cấu hình thiết bị', hint: RESTART },
};

export interface ResolvedStatus {
  status: DriverStatus;
  text: string;
  hint: string | null;
}

export function resolveStatus(errorCode: number | null | undefined): ResolvedStatus {
  // WMI trả null cho vài thiết bị ảo/phần mềm -> coi như 0 (không có lỗi được báo).
  const code = typeof errorCode === 'number' ? errorCode : 0;
  const entry = ERROR_CODE_TABLE[code];
  if (entry) {
    const text = code === 0 ? entry.text : `${entry.text} (Code ${code})`;
    return { status: entry.status, text, hint: entry.hint ?? null };
  }
  return { status: 'error', text: `Lỗi không xác định (Code ${code})`, hint: UPDATE };
}

/** Mã 45: thiết bị đã từng cắm nhưng hiện không kết nối. */
export const CODE_NOT_CONNECTED = 45;
