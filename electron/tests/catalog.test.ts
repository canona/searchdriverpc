import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildQueries,
  normalizeDownloadUrl,
  parseDownloadDialog,
  parseSearchHtml,
  rankEntries,
  scoreEntry,
  type RawCatalogEntry,
} from '../catalog';
import { decodeInf, isInside } from '../driverDownload';
import { parseHardwareId } from '../hardwareId';
import type { DeviceInfo } from '../types';

// Fixture mô phỏng cấu trúc bảng kết quả của Search.aspx (rút gọn).
function row(guid: string, n: number, title: string, products: string, date: string, version: string, size: number) {
  return `</tr><tr id="${guid}_R${n}" style="border-width:0px;">
    <td class="resultsbottomBorder resultspadding resultsIconWidth " id="${guid}_C0_R${n}">
    </td><td class="resultsbottomBorder resultspadding" id="${guid}_C1_R${n}">
      <a id='${guid}_link' href= "javascript:void(0);" onclick='goToDetails("${guid}");' class="contentTextItemSpacerNoBreakLink">
        ${title}
      </a>
    </td><td class="resultsbottomBorder resultspadding" id="${guid}_C2_R${n}">
      ${products}
    </td><td class="resultsbottomBorder resultspadding" id="${guid}_C3_R${n}">
      Drivers (Other Hardware)
    </td><td class="resultsbottomBorder resultspadding " id="${guid}_C4_R${n}">
      ${date}
    </td><td class="resultsbottomBorder resultspadding" id="${guid}_C5_R${n}">
      ${version}
    </td><td class="resultsbottomBorder resultspadding resultsSizeWidth" id="${guid}_C6_R${n}">
      <span id="${guid}_size">60 KB</span>
      <span class="noDisplay" id="${guid}_originalSize">${size}</span>
    </td><td class="resultsbottomBorder resultsButtonWidth" id="${guid}_C7_R${n}">
      <input id="${guid}" class="flatBlueButtonDownload focus-only" type="button" value='Download' />
    </td>\r\n`;
}

const G1 = '94580c0a-d4a9-481d-ba7a-006b613a38b2';
const G2 = '7cc0bd1a-74f5-4938-b1a5-9f03535a1ef9';
const G3 = '0b3c9d7e-1111-4222-8333-944455556666';
const HTML =
  '<table><tr id="headerRow"><td>Title</td>' +
  row(G1, 1, 'INTEL - System - 1/3/2017 12:00:00 AM - 10.1.1.40', 'Windows 10 Anniversary Update and Later Servicing Drivers', '1/2/2017', 'n/a', 61469) +
  row(G2, 2, 'Intel Corporation &amp; Co - ARM64 - 2.0', 'Windows 11 Client, version 22H2 and later, Servicing Drivers', '10/15/2023', '2.0', 1000) +
  row(G3, 3, 'Old driver - 1.0', 'Windows 7', '3/4/2012', '1.0', 500) +
  '</tr></table>';

test('parseSearchHtml đọc đủ cột', () => {
  const rows = parseSearchHtml(HTML);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    updateId: G1,
    title: 'INTEL - System - 1/3/2017 12:00:00 AM - 10.1.1.40',
    products: 'Windows 10 Anniversary Update and Later Servicing Drivers',
    classification: 'Drivers (Other Hardware)',
    lastUpdated: '2017-01-02',
    version: '10.1.1.40', // lấy từ tiêu đề vì cột Version là n/a
    sizeBytes: 61469,
  });
  assert.equal(rows[1].title, 'Intel Corporation & Co - ARM64 - 2.0');
  assert.equal(rows[1].lastUpdated, '2023-10-15');
});

test('parseDownloadDialog lấy url, sha256, sha1', () => {
  const html = `
    downloadInformation[0].files[0].url = 'https://catalog.s.download.windowsupdate.com/c/msdownload/update/driver/drvs/2017/03/x_y.cab';
    downloadInformation[0].files[0].digest = '89TvkCh9Tijf0fKh2yfAFI2dtY0=';
    downloadInformation[0].files[0].sha256 = 'zoThwL55lhOp9IUu7SfXlinLNiJiPOV1TJGJvwEUr9s=';
    downloadInformation[0].files[0].fileName = 'x_y.cab';`;
  assert.deepEqual(parseDownloadDialog(html), {
    url: 'https://catalog.s.download.windowsupdate.com/c/msdownload/update/driver/drvs/2017/03/x_y.cab',
    fileName: 'x_y.cab',
    sha256: 'zoThwL55lhOp9IUu7SfXlinLNiJiPOV1TJGJvwEUr9s=',
    sha1: '89TvkCh9Tijf0fKh2yfAFI2dtY0=',
  });
  assert.equal(parseDownloadDialog('<html>lỗi</html>'), null);
  assert.equal(
    parseDownloadDialog(`downloadInformation[0].files[0].url = 'https://x.download.windowsupdate.com/a.exe';`),
    null,
  );
});

test('xếp hạng: loại ARM64 trên x64 và gói chỉ cho Windows 7', () => {
  const rows = parseSearchHtml(HTML);
  const env = { osBuild: 22621, arch: 'x64' as const };
  assert.equal(scoreEntry(rows[1], false, env), null); // ARM64
  assert.equal(scoreEntry(rows[2], false, env), null); // Windows 7
  const ranked = rankEntries([], rows, env);
  assert.deepEqual(ranked.map((e) => e.updateId), [G1]);
  assert.ok(ranked[0].recommended);
});

test('xếp hạng: gói tìm bằng SUBSYS được ưu tiên, cùng điểm thì mới hơn trước', () => {
  const base = (id: string, date: string): RawCatalogEntry => ({
    updateId: id,
    title: `Pkg ${id}`,
    products: 'Windows 10 and later drivers',
    classification: '',
    lastUpdated: date,
    version: null,
    sizeBytes: 1,
  });
  const env = { osBuild: 22621, arch: 'x64' as const };
  const ranked = rankEntries([base('a', '2018-01-01')], [base('b', '2024-01-01'), base('c', '2020-01-01'), base('a', '2018-01-01')], env);
  assert.deepEqual(ranked.map((e) => e.updateId), ['a', 'b', 'c']);
  assert.ok(ranked[0].matchedSubsys);
});

test('buildQueries: bỏ REV, có truy vấn cụ thể và chung', () => {
  const hw = ['PCI\\VEN_8086&DEV_A121&SUBSYS_86941043&REV_31', 'PCI\\VEN_8086&DEV_A121&SUBSYS_86941043'];
  const device = { hardwareIds: hw, parsedId: parseHardwareId(hw[0]) } as DeviceInfo;
  assert.deepEqual(buildQueries(device), {
    specific: 'PCI\\VEN_8086&DEV_A121&SUBSYS_86941043',
    general: 'PCI\\VEN_8086&DEV_A121',
  });
  assert.deepEqual(buildQueries({ hardwareIds: [], parsedId: null } as unknown as DeviceInfo), {
    specific: null,
    general: null,
  });
});

test('normalizeDownloadUrl chỉ nhận .cab trên máy chủ Microsoft', () => {
  assert.equal(
    normalizeDownloadUrl('http://download.windowsupdate.com/d/msdownload/a.cab'),
    'https://download.windowsupdate.com/d/msdownload/a.cab',
  );
  assert.ok(normalizeDownloadUrl('https://catalog.s.download.windowsupdate.com/c/a.cab'));
  assert.ok(normalizeDownloadUrl('https://catalog.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/x/a.cab'));
  assert.equal(normalizeDownloadUrl('https://catalog.s.download.windowsupdate.com/c/a.exe'), null);
  assert.equal(normalizeDownloadUrl('https://download.windowsupdate.com.evil.io/a.cab'), null);
  assert.equal(normalizeDownloadUrl('https://evil.io/download.windowsupdate.com/a.cab'), null);
  assert.equal(normalizeDownloadUrl('ftp://download.windowsupdate.com/a.cab'), null);
});

test('decodeInf đọc được UTF-16 LE và ANSI', () => {
  const text = '%PCI\\VEN_8086&DEV_A121Desc%=Needs_NO_DRV,PCI\\VEN_8086&DEV_A121';
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  assert.equal(decodeInf(utf16), text);
  assert.equal(decodeInf(Buffer.from(text, 'latin1')), text);
});

test('isInside chống path traversal', () => {
  assert.ok(isInside('G:\\dl', 'G:\\dl\\a\\b'));
  assert.equal(isInside('G:\\dl', 'G:\\dl'), false);
  assert.equal(isInside('G:\\dl', 'G:\\dl\\..\\x'), false);
  assert.equal(isInside('G:\\dl', 'G:\\dl2\\x'), false);
  assert.equal(isInside('G:\\dl', 'C:\\Windows'), false);
});
