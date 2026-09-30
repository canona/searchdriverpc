import { readdir } from 'node:fs/promises';
import { release } from 'node:os';
import { join } from 'node:path';

/*
 * Tương thích Windows 7 / 8.1.
 *
 * Bản cho Win7 chạy trên Electron 22 (Node 16), nên KHÔNG dùng các API Node mới:
 * readdir({ recursive }) và Dirent.parentPath (Node 20), fetch (Node 18),
 * Readable.fromWeb (Node 17). Các helper dưới đây chạy được ở cả hai bản.
 */

/** Windows trước 10 (os.release(): "6.1" = Win7, "6.2" = Win8, "6.3" = Win8.1). */
export function isLegacyWindows(): boolean {
  return process.platform === 'win32' && Number(release().split('.')[0]) < 10;
}

/** Liệt kê mọi file trong cây thư mục (đường dẫn tuyệt đối). */
export async function listFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFilesRecursive(full)));
    else if (e.isFile()) out.push(full);
  }
  return out;
}
