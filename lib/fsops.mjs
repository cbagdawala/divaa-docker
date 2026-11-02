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

/**
 * Copy a bundled skill folder to `dest`, then rewrite every `fromPrefix` in its
 * SKILL.md to `toPrefix` so the commands it tells the agent to run point at
 * where this copy actually lives (not at Claude Code's global skills dir).
 */
export async function installSkillDir(src, dest, { fromPrefix, toPrefix }) {
  await copyDir(src, dest);
  if (!fromPrefix || fromPrefix === toPrefix) return;
  const skillMd = join(dest, 'SKILL.md');
  const raw = await fs.readFile(skillMd, 'utf8');
  const next = raw.split(fromPrefix).join(toPrefix);
  if (next !== raw) await fs.writeFile(skillMd, next);
}

export async function removeDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}
