// Resolve which bundled skills a command should act on, from the --skill option.
//
// --skill accepts a comma-separated list of skill names (e.g.
// "setup-divaa-docker-lv-vite,setup-divaa-docker-lv-webpack"). When omitted,
// every bundled skill is used. Unknown names are a hard error listing valid ones.
import { bundledSkillNames } from './assets.mjs';

export function parseSkillOption(raw) {
  const valid = bundledSkillNames();
  if (!raw) return valid;

  const wanted = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const unknown = wanted.filter((s) => !valid.includes(s));
  if (unknown.length) {
    throw new Error(
      `Unknown --skill ${unknown.map((s) => `"${s}"`).join(', ')}. ` +
        `Valid: ${valid.join(', ')}`,
    );
  }
  // De-dup while preserving the bundled order.
  return valid.filter((s) => wanted.includes(s));
}
