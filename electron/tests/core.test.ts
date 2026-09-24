import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { resolveStatus } from '../deviceStatus';
import { formatExport } from '../exporter';
import { parseHardwareId, pickBestHardwareId, shortHardwareId } from '../hardwareId';
import { IdLookup, parseIdsFile } from '../pciLookup';
import type { ScanResult } from '../types';
import { buildDriverLinks, isAllowedExternalUrl } from '../vendorLinks';

// dist-electron/tests -> gốc project -> resources
const RESOURCES = join(__dirname, '..', '..', 'resources');

test('parse PCI Hardware ID với SUBSYS', () => {
  const p = parseHardwareId('PCI\\VEN_10EC&DEV_8168&SUBSYS_86771043&REV_15');
  assert.deepEqual(p, {
    raw: 'PCI\\VEN_10EC&DEV_8168&SUBSYS_86771043&REV_15',
    bus: 'PCI',
    idSpace: 'pci',
    vendorId: '10ec',
    deviceId: '8168',
    subsysVendorId: '1043',
    subsysDeviceId: '8677',
    revision: '15',
  });
});

test('parse USB, HDAUDIO, ACPI và PNPDeviceID có instance', () => {
  const usb = parseHardwareId('USB\\VID_046D&PID_C52B&MI_00');
  assert.equal(usb?.idSpace, 'usb');
  assert.equal(usb?.vendorId, '046d');
  assert.equal(usb?.deviceId, 'c52b');

  const hda = parseHardwareId('HDAUDIO\\FUNC_01&VEN_10EC&DEV_0887&SUBSYS_10438445&REV_1003');
  assert.equal(hda?.idSpace, 'pci');
  assert.equal(hda?.vendorId, '10ec');
  assert.equal(shortHardwareId(hda!), 'VEN_10EC&DEV_0887');

  const acpi = parseHardwareId('ACPI\\VEN_INT&DEV_33A0');
  assert.equal(acpi?.idSpace, null);
  assert.equal(acpi?.vendorId, null);

  const inst = parseHardwareId('PCI\\VEN_8086&DEV_A102&SUBSYS_86941043&REV_31\\3&11583659&0&B8');
  assert.equal(inst?.deviceId, 'a102');
  assert.equal(shortHardwareId(inst!), 'PCI\\VEN_8086&DEV_A102');

  assert.equal(parseHardwareId('khong-hop-le'), null);
});

test('pickBestHardwareId bỏ qua ID không có vendor', () => {
  const p = pickBestHardwareId(['ACPI\\PNP0A08', 'PCI\\VEN_8086&DEV_1234']);
  assert.equal(p?.vendorId, '8086');
});

test('map ConfigManagerErrorCode', () => {
  assert.equal(resolveStatus(0).status, 'ok');
  assert.equal(resolveStatus(null).status, 'ok');
  assert.equal(resolveStatus(28).status, 'missing');
  assert.equal(resolveStatus(22).status, 'disabled');
  assert.equal(resolveStatus(10).status, 'error');
  assert.equal(resolveStatus(999).status, 'error');
  assert.match(resolveStatus(28).text, /Code 28/);
});

test('parseIdsFile không gán dòng của section class vào vendor cuối', () => {
  const db = parseIdsFile(
    '# c\n8086  Intel Corporation\n\ta102  SATA\n\t\t1043 8694  Board\nffff  Last\n\t0001  Dev\nC 00  Unclassified\n\t00  Non-VGA\n',
  );
  assert.equal(db.get('8086')?.devices.get('a102')?.subsystems.get('1043 8694'), 'Board');
  assert.equal(db.get('ffff')?.devices.size, 1);
});

test('tra pci.ids / usb.ids thật', () => {
  const lookup = new IdLookup(RESOURCES);
  assert.ok(lookup.loaded, lookup.loadErrors.join('; '));
  const r = lookup.lookup('pci', '10de', '0fc1', '1043', '83f3');
  assert.equal(r.vendorName, 'NVIDIA Corporation');
  assert.match(r.deviceName ?? '', /GK107/);
  assert.match(r.subsysVendorName ?? '', /ASUS/);
  assert.match(lookup.lookup('usb', '046d').vendorName ?? '', /Logitech/);
});

test('link driver và allowlist URL', () => {
  const links = buildDriverLinks(parseHardwareId('PCI\\VEN_10EC&DEV_8168&SUBSYS_86771043'), null);
  assert.deepEqual(links.map((l) => l.kind), ['chip', 'oem', 'catalog']);
  for (const l of links) assert.ok(isAllowedExternalUrl(l.url), l.url);

  assert.equal(isAllowedExternalUrl('http://www.intel.com/'), false);
  assert.equal(isAllowedExternalUrl('https://evil.example.com/driver.exe'), false);
  assert.equal(isAllowedExternalUrl('https://www.intel.com.evil.io/'), false);
  assert.equal(isAllowedExternalUrl('file:///C:/Windows/System32/cmd.exe'), false);
  assert.equal(isAllowedExternalUrl(42), false);
});

test('export CSV escape và chống formula injection', () => {
  const scan: ScanResult = {
    scannedAt: new Date(0).toISOString(),
    system: { manufacturer: null, model: null, boardManufacturer: null, boardProduct: null, oemLink: null },
    skippedDisconnected: 0,
    idDatabaseLoaded: true,
    devices: [
      { id: 'A', name: '=HYPERLINK("x")', status: 'missing', errorCode: 28, statusText: 't', statusHint: null,
        pnpClass: null, manufacturer: null, hardwareIds: [], parsedId: null, vendorName: null, deviceName: null,
        subsysVendorName: null, subsystemName: null, links: [] },
      { id: 'B', name: 'OK dev', status: 'ok', errorCode: 0, statusText: 't', statusHint: null,
        pnpClass: null, manufacturer: null, hardwareIds: [], parsedId: null, vendorName: null, deviceName: null,
        subsysVendorName: null, subsystemName: null, links: [] },
    ],
  };
  const csv = formatExport(scan, 'csv');
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(!csv.includes('OK dev'));
});
