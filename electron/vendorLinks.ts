import { shortHardwareId } from './hardwareId';
import type { DriverLink, IdSpace, ParsedHardwareId } from './types';

/*
 * LINK TRANG TẢI DRIVER CHÍNH CHỦ
 * ===============================
 * App KHÔNG tải file nào. Mỗi thiết bị chỉ được gắn link tới trang hỗ trợ /
 * download center CHÍNH THỨC của hãng; người dùng tự mở trình duyệt và tự quyết.
 *
 * Mọi URL mở ra ngoài đều phải qua isAllowedExternalUrl(): chỉ chấp nhận https
 * và hostname nằm trong allowlist xây từ chính các bảng dưới đây, nên renderer
 * (kể cả khi bị chèn nội dung độc hại) không thể dùng app để mở URL tùy ý.
 */

interface Vendor {
  name: string;
  url: string;
}

const INTEL: Vendor = { name: 'Intel', url: 'https://www.intel.com/content/www/us/en/download-center/home.html' };
const AMD: Vendor = { name: 'AMD', url: 'https://www.amd.com/en/support/download/drivers.html' };
const NVIDIA: Vendor = { name: 'NVIDIA', url: 'https://www.nvidia.com/en-us/drivers/' };
const REALTEK: Vendor = { name: 'Realtek', url: 'https://www.realtek.com/' }; // vào mục Downloads
const QUALCOMM: Vendor = { name: 'Qualcomm', url: 'https://www.qualcomm.com/support' };
const MEDIATEK: Vendor = { name: 'MediaTek', url: 'https://www.mediatek.com/' };
const BROADCOM: Vendor = { name: 'Broadcom', url: 'https://www.broadcom.com/support/download-search' };
const MARVELL: Vendor = { name: 'Marvell', url: 'https://www.marvell.com/support.html' };
const SYNAPTICS: Vendor = { name: 'Synaptics', url: 'https://www.synaptics.com/' };
const ASUS: Vendor = { name: 'ASUS', url: 'https://www.asus.com/support/download-center/' };
const MICROSOFT: Vendor = { name: 'Microsoft', url: 'https://support.microsoft.com/' };

/** Hãng CHIP theo Vendor ID PCI-SIG (dùng cho bus PCI và HDAUDIO). */
const PCI_VENDORS: Record<string, Vendor> = {
  '8086': INTEL,
  '1002': AMD, // ATI / AMD Radeon
  '1022': AMD, // AMD chipset
  '10de': NVIDIA,
  '10ec': REALTEK,
  '168c': QUALCOMM, // Qualcomm Atheros Wi-Fi
  '17cb': QUALCOMM,
  '1969': QUALCOMM, // Qualcomm Atheros Ethernet
  '14c3': MEDIATEK,
  '14e4': BROADCOM,
  '11ab': MARVELL,
  '1b4b': MARVELL,
  '1d6a': MARVELL, // Aquantia (thuộc Marvell)
  '1b21': { name: 'ASMedia', url: 'https://www.asmedia.com.tw/' },
  '1106': { name: 'VIA', url: 'https://www.viatech.com/en/support/drivers/' },
  '197b': { name: 'JMicron', url: 'https://www.jmicron.com/' },
  '144d': { name: 'Samsung Semiconductor', url: 'https://semiconductor.samsung.com/consumer-storage/support/tools/' },
  '15b7': { name: 'Western Digital / SanDisk', url: 'https://www.westerndigital.com/support' },
  '14f1': SYNAPTICS, // Conexant audio (nay thuộc Synaptics)
};

/** Hãng theo Vendor ID USB-IF (dùng cho bus USB / HID). */
const USB_VENDORS: Record<string, Vendor> = {
  '8087': INTEL, // Intel Bluetooth
  '0bda': REALTEK,
  '0cf3': QUALCOMM,
  '0e8d': MEDIATEK,
  '0a5c': BROADCOM,
  '06cb': SYNAPTICS,
  '046d': { name: 'Logitech', url: 'https://support.logi.com/' },
  '045e': MICROSOFT,
  '0b05': ASUS,
  '1532': { name: 'Razer', url: 'https://mysupport.razer.com/' },
  '1038': { name: 'SteelSeries', url: 'https://steelseries.com/gg' },
  '05ac': { name: 'Apple', url: 'https://support.apple.com/' },
  '04e8': { name: 'Samsung', url: 'https://developer.samsung.com/android-usb-driver' },
  '18d1': { name: 'Google', url: 'https://developer.android.com/studio/run/win-usb' },
  '10c4': { name: 'Silicon Labs', url: 'https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers' },
  '0403': { name: 'FTDI', url: 'https://ftdichip.com/drivers/' },
  '1a86': { name: 'WCH (CH340/CH341)', url: 'https://www.wch-ic.com/' },
  '067b': { name: 'Prolific', url: 'https://www.prolific.com.tw/' },
};

/** Hãng MÁY/BO MẠCH (OEM) theo subsystem vendor ID trong SUBSYS_xxxxVVVV. */
const OEM_BY_SUBSYS: Record<string, Vendor> = {
  '1028': { name: 'Dell', url: 'https://www.dell.com/support/home' },
  '103c': { name: 'HP', url: 'https://support.hp.com/drivers' },
  '17aa': { name: 'Lenovo', url: 'https://pcsupport.lenovo.com/' },
  '1043': ASUS,
  '1025': { name: 'Acer', url: 'https://www.acer.com/us-en/support/drivers-and-manuals' },
  '1462': { name: 'MSI', url: 'https://www.msi.com/support/download' },
  '1458': { name: 'Gigabyte', url: 'https://www.gigabyte.com/Support' },
  '1849': { name: 'ASRock', url: 'https://www.asrock.com/support/index.asp' },
  '144d': { name: 'Samsung', url: 'https://www.samsung.com/support/' },
  '1179': { name: 'Dynabook (Toshiba)', url: 'https://support.dynabook.com/' },
  '1414': { name: 'Microsoft Surface', url: 'https://support.microsoft.com/surface' },
};

/** Hãng máy theo chuỗi Manufacturer của Win32_ComputerSystem / Win32_BaseBoard. */
const OEM_BY_NAME: Array<[RegExp, Vendor]> = [
  [/\bdell\b/i, OEM_BY_SUBSYS['1028']],
  [/\bhp\b|hewlett/i, OEM_BY_SUBSYS['103c']],
  [/lenovo/i, OEM_BY_SUBSYS['17aa']],
  [/asus/i, ASUS],
  [/\bacer\b/i, OEM_BY_SUBSYS['1025']],
  [/\bmsi\b|micro-star/i, OEM_BY_SUBSYS['1462']],
  [/gigabyte/i, OEM_BY_SUBSYS['1458']],
  [/asrock/i, OEM_BY_SUBSYS['1849']],
  [/microsoft/i, OEM_BY_SUBSYS['1414']],
  [/samsung/i, OEM_BY_SUBSYS['144d']],
  [/toshiba|dynabook/i, OEM_BY_SUBSYS['1179']],
  [/huawei/i, { name: 'Huawei', url: 'https://consumer.huawei.com/en/support/' }],
  [/\blg\b/i, { name: 'LG', url: 'https://www.lg.com/us/support/software-firmware-drivers' }],
];

/**
 * Bus không nên gợi ý trang hãng máy: thiết bị ảo do phần mềm tạo (driver đi
 * kèm phần mềm đó), audio endpoint của Windows, và màn hình rời (driver của hãng màn hình).
 */
const SOFTWARE_BUSES = new Set(['ROOT', 'SWD', 'SW', 'MMDEVAPI', 'MONITOR', 'DISPLAY']);

const CATALOG_HOST ='www.catalog.update.microsoft.com';

/** URI mở trang "Optional updates" trong Settings của Windows. */
export const WINDOWS_UPDATE_SETTINGS_URI = 'ms-settings:windowsupdate-optionalupdates';
/** Windows 7/8.1 không có ms-settings: -> mở Windows Update trong Control Panel. */
export const LEGACY_WINDOWS_UPDATE_ARGS = ['/name', 'Microsoft.WindowsUpdate'];

function chipVendor(space: IdSpace | null, vendorId: string | null): Vendor | null {
  if (!space || !vendorId) return null;
  return (space === 'pci' ? PCI_VENDORS : USB_VENDORS)[vendorId] ?? null;
}

export function oemFromManufacturer(...names: Array<string | null | undefined>): DriverLink | null {
  for (const name of names) {
    if (!name) continue;
    const hit = OEM_BY_NAME.find(([re]) => re.test(name));
    if (hit) return { label: `Hỗ trợ ${hit[1].name}`, url: hit[1].url, kind: 'oem' };
  }
  return null;
}

/**
 * Danh sách link cho một thiết bị, theo thứ tự ưu tiên:
 *  1. Trang hãng chip (theo VEN/VID).
 *  2. Trang hãng máy/bo mạch (theo SUBSYS; với laptop, driver OEM thường
 *     được tùy biến nên ưu tiên hơn driver chung của hãng chip).
 *  3. Microsoft Update Catalog tìm theo Hardware ID (trang chính thức của
 *     Microsoft; người dùng tự xem và tải nếu muốn).
 */
export function buildDriverLinks(parsed: ParsedHardwareId | null, systemOem: DriverLink | null): DriverLink[] {
  const links: DriverLink[] = [];

  const chip = parsed ? chipVendor(parsed.idSpace, parsed.vendorId) : null;
  if (chip) links.push({ label: `Trang driver ${chip.name}`, url: chip.url, kind: 'chip' });

  const oem = parsed?.subsysVendorId ? OEM_BY_SUBSYS[parsed.subsysVendorId] : undefined;
  if (oem && oem.url !== chip?.url) {
    links.push({ label: `Hỗ trợ ${oem.name}`, url: oem.url, kind: 'oem' });
  } else if (!oem && systemOem && systemOem.url !== chip?.url && parsed && !SOFTWARE_BUSES.has(parsed.bus)) {
    // Thiết bị không có SUBSYS (ACPI, USB...) -> gợi ý trang của hãng máy/bo mạch.
    links.push(systemOem);
  }

  if (parsed?.vendorId) {
    const q = encodeURIComponent(shortHardwareId(parsed));
    links.push({
      label: 'Microsoft Update Catalog',
      url: `https://${CATALOG_HOST}/Search.aspx?q=${q}`,
      kind: 'catalog',
    });
  }
  return links;
}

/** Allowlist hostname = mọi host xuất hiện trong các bảng trên + Update Catalog. */
const ALLOWED_HOSTS: ReadonlySet<string> = new Set(
  [
    ...Object.values(PCI_VENDORS),
    ...Object.values(USB_VENDORS),
    ...Object.values(OEM_BY_SUBSYS),
    ...OEM_BY_NAME.map(([, v]) => v),
  ]
    .map((v) => new URL(v.url).hostname)
    .concat(CATALOG_HOST),
);

export function isAllowedExternalUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > 2048) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && !parsed.username && !parsed.password && ALLOWED_HOSTS.has(parsed.hostname);
}
