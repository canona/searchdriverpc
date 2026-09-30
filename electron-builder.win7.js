/*
 * Cấu hình đóng gói bản cho Windows 7 SP1 / 8 / 8.1:  npm run dist:win7
 *
 * Electron 23+ đã bỏ Windows 7/8/8.1, nên bản này dùng Electron 22 (bản cuối hỗ
 * trợ; Chromium 108, Node 16). Mã nguồn dùng chung với bản chính — main process
 * chỉ dùng API có từ Node 16 (xem electron/winCompat.ts, electron/http.ts) và
 * renderer build với target chrome108 (vite.config.ts).
 *
 * Lưu ý: Electron 22 không còn nhận bản vá bảo mật. Máy Windows 10/11 nên dùng
 * bản chính (npm run dist).
 */
const base = require('./package.json').build;

module.exports = {
  ...base,
  electronVersion: '22.3.27',
  directories: { output: 'release/win7' },
  win: {
    ...base.win,
    // Nhiều máy Win7 còn chạy bản 32-bit.
    target: [
      { target: 'nsis', arch: ['x64', 'ia32'] },
      { target: 'portable', arch: ['x64', 'ia32'] },
    ],
  },
  nsis: {
    ...base.nsis,
    // Gộp x64 + ia32 vào một bộ cài; NSIS tự chọn đúng bản theo máy.
    artifactName: '${productName}-Win7-Setup-${version}.${ext}',
    include: 'build/installer-win7.nsh',
  },
  portable: {
    ...base.portable,
    artifactName: '${productName}-Win7-Portable-${version}-${arch}.${ext}',
  },
};
