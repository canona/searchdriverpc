/*
 * Build bộ cài tổng (Windows 7 -> 11):  npm run dist:universal
 *   1. Build renderer + main một lần.
 *   2. electron-builder: bộ cài NSIS bản chính (x64) và bản Win7 (x64 + ia32).
 *   3. makensis gói hai bộ cài đó vào build/universal-installer.nsi.
 * Kết quả: release/SearchDriverPC-Setup-Universal-<version>.exe
 */
const { execSync } = require('node:child_process');
const { existsSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const { version, build } = require(join(root, 'package.json'));
const productName = build.productName;

function run(cmd, args) {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  // Chạy qua shell để gọi được npm.cmd/npx.cmd; tham số là hằng hoặc đường dẫn đã bọc "".
  execSync(`${cmd} ${args.join(' ')}`, { cwd: root, stdio: 'inherit' });
}

/** makensis: biến MAKENSIS, hoặc bản electron-builder đã tải về cache, hoặc trong PATH. */
function findMakensis() {
  if (process.env.MAKENSIS) return process.env.MAKENSIS;
  const cache = join(process.env.LOCALAPPDATA ?? '', 'electron-builder', 'Cache');
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache).filter((d) => /^nsis-\d/.test(d)).sort().reverse()) {
      for (const sub of readdirSync(join(cache, dir))) {
        const exe = join(cache, dir, sub, 'Bin', 'makensis.exe');
        if (existsSync(exe)) return exe;
      }
    }
  }
  return 'makensis';
}

function requireFile(path) {
  if (!existsSync(path)) throw new Error(`Không thấy ${path}`);
  return path;
}

run('npm', ['run', 'build']);
run('npx', ['electron-builder', '--win', 'nsis', '--x64']);
run('npx', ['electron-builder', '--win', 'nsis', '--x64', '--ia32', '--config', 'electron-builder.win7.js']);

const mainSetup = requireFile(join(root, 'release', `${productName}-Setup-${version}.exe`));
const win7Setup = requireFile(join(root, 'release', 'win7', `${productName}-Win7-Setup-${version}.exe`));
const outFile = join(root, 'release', `${productName}-Setup-Universal-${version}.exe`);

run(`"${findMakensis()}"`, [
  '-V2',
  `"-DVERSION=${version}"`,
  `"-DOUTFILE=${outFile}"`,
  `"-DMAIN_SETUP=${mainSetup}"`,
  `"-DWIN7_SETUP=${win7Setup}"`,
  `"${join(root, 'build', 'universal-installer.nsi')}"`,
]);
console.log(`\nĐã tạo ${outFile}`);
