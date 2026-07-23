// Small filesystem helpers (recursive copy / remove) that avoid the
// experimental-warning surface of fs.cp on older Node 18 lines.
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(s, d);
    } else if (entry.isSymbolicLink()) {
      const link = await fs.readlink(s);
      await fs.symlink(link, d);
    } else {
      await fs.copyFile(s, d);
    }
  }
}

export async function removeDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}
