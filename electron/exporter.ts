import type { DeviceInfo, ExportFormat, ScanResult } from './types';

/*
 * Xuất danh sách thiết bị CÓ VẤN ĐỀ (thiếu driver / lỗi / bị tắt) ra CSV hoặc TXT
 * để người dùng tự tra cứu thêm. Dữ liệu lấy từ kết quả quét giữ ở main process,
 * không nhận dữ liệu từ renderer.
 */

const STATUS_LABEL: Record<DeviceInfo['status'], string> = {
  ok: 'OK',
  missing: 'Thiếu driver',
  error: 'Lỗi',
  disabled: 'Bị tắt',
};

const COLUMNS: Array<[string, (d: DeviceInfo) => string]> = [
  ['Tên thiết bị', (d) => d.name],
  ['Trạng thái', (d) => STATUS_LABEL[d.status]],
  ['Mã lỗi', (d) => String(d.errorCode)],
  ['Mô tả', (d) => d.statusText],
  ['Hãng chip (pci/usb.ids)', (d) => d.vendorName ?? ''],
  ['Tên chip (pci/usb.ids)', (d) => d.deviceName ?? ''],
  ['Hãng OEM (SUBSYS)', (d) => d.subsysVendorName ?? ''],
  ['Vendor ID', (d) => d.parsedId?.vendorId?.toUpperCase() ?? ''],
  ['Device ID', (d) => d.parsedId?.deviceId?.toUpperCase() ?? ''],
  ['Hardware ID', (d) => d.hardwareIds[0] ?? d.id],
  ['Trang driver', (d) => d.links[0]?.url ?? ''],
];

/**
 * Escape một ô CSV: bọc trong dấu nháy kép, nhân đôi nháy kép bên trong.
 * Thêm dấu ' trước các ô bắt đầu bằng = + - @ để Excel không hiểu nhầm là
 * công thức (chống CSV/formula injection).
 */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function problemDevices(scan: ScanResult): DeviceInfo[] {
  return scan.devices.filter((d) => d.status !== 'ok');
}

export function formatExport(scan: ScanResult, format: ExportFormat): string {
  const devices = problemDevices(scan);

  if (format === 'csv') {
    const lines = [COLUMNS.map(([h]) => csvCell(h)).join(',')];
    for (const d of devices) lines.push(COLUMNS.map(([, get]) => csvCell(get(d))).join(','));
    // BOM UTF-8 để Excel hiển thị đúng tiếng Việt; CRLF theo chuẩn RFC 4180.
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  const sys = scan.system;
  const out: string[] = [
    'DANH SÁCH THIẾT BỊ THIẾU DRIVER / LỖI',
    `Thời điểm quét : ${new Date(scan.scannedAt).toLocaleString('vi-VN')}`,
    `Máy            : ${[sys.manufacturer, sys.model].filter(Boolean).join(' ') || '(không rõ)'}`,
    `Bo mạch        : ${[sys.boardManufacturer, sys.boardProduct].filter(Boolean).join(' ') || '(không rõ)'}`,
    `Số thiết bị    : ${devices.length}`,
    '='.repeat(72),
  ];
  if (devices.length === 0) out.push('', 'Không có thiết bị nào thiếu driver hoặc bị lỗi.');
  devices.forEach((d, i) => {
    out.push('', `${i + 1}. ${d.name}`);
    for (const [header, get] of COLUMNS.slice(1)) {
      const value = get(d);
      if (value) out.push(`   ${header.padEnd(24)}: ${value}`);
    }
    if (d.hardwareIds.length > 1) {
      out.push(`   ${'Các Hardware ID khác'.padEnd(24)}:`);
      for (const hw of d.hardwareIds.slice(1)) out.push(`      ${hw}`);
    }
  });
  return out.join('\r\n') + '\r\n';
}
