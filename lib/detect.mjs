// Best-effort detection of which harness the user is in, to pre-select the
// interactive prompt. Prefers a project-level marker dir, then a global one.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PLATFORMS, AI_TYPES } from './platforms.mjs';

export function detectPlatform() {
  const cwd = process.cwd();
  for (const t of AI_TYPES) {
    if (existsSync(join(cwd, PLATFORMS[t].projectBase))) return t;
  }
  for (const t of AI_TYPES) {
    if (existsSync(PLATFORMS[t].globalBase)) return t;
  }
  return null;
}
