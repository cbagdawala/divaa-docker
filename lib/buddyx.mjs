// Co-install the BuddyX orchestrator skill alongside divaa-docker's own skills.
//
// BuddyX is a hard dependency (see package.json). After divaa-docker's own
// install succeeds, `init` invokes BuddyX's own installer once per resolved
// target harness so the orchestrator lands in the SAME assistant(s) and scope.
//
// This step is best-effort: if BuddyX can't be resolved or an install call
// errors, we warn and continue — divaa-docker's install already succeeded.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORMS } from './platforms.mjs';
import { heading, added, warn, chalk } from './logue.mjs';

// divaa-docker harness key -> BuddyX `--ai` value. BuddyX currently exposes the
// same harness set as divaa-docker, so this is an identity map; harnesses absent
// here (or valued null) are skipped with a warning rather than failing.
const AI_MAP = {
  claude: 'claude',
  opencode: 'opencode',
  cursor: 'cursor',
  windsurf: 'windsurf',
  codex: 'codex',
  gemini: 'gemini',
  antigravity: 'antigravity',
  factory: 'factory',
};

/**
 * Resolve BuddyX's executable .mjs entry via its package.json `bin`.
 * @returns {string} absolute path to the BuddyX CLI entry file.
 */
function resolveBuddyxBin() {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve('buddyx/package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const bin = pkg.bin;
  const rel = typeof bin === 'string' ? bin : bin && bin.buddyx;
  if (!rel) throw new Error('buddyx package.json has no usable "bin" entry');
  return resolvePath(dirname(pkgPath), rel);
}

/**
 * Co-install BuddyX into each resolved target harness.
 * Never throws — all failures are surfaced via logue.warn and swallowed.
 * @param {object} params
 * @param {string[]} params.targets  divaa-docker harness keys (already expanded).
 * @param {boolean} [params.global]
 * @param {boolean} [params.force]
 */
export function installBuddyx({ targets, global = false, force = false }) {
  let binPath;
  try {
    binPath = resolveBuddyxBin();
  } catch (e) {
    warn(`BuddyX companion not installed (could not resolve buddyx): ${e.message}`);
    return;
  }

  const installedFor = [];
  for (const t of targets) {
    const aiValue = AI_MAP[t];
    if (!aiValue) {
      warn(`BuddyX does not support ${PLATFORMS[t]?.label ?? t} — skipping its companion.`);
      continue;
    }

    const args = [binPath, 'init', '--ai', aiValue];
    if (global) args.push('--global');
    if (force) args.push('--force');

    let res;
    try {
      res = spawnSync(process.execPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
      });
    } catch (e) {
      warn(`BuddyX companion failed for ${PLATFORMS[t]?.label ?? t}: ${e.message}`);
      continue;
    }

    if (res.error) {
      warn(`BuddyX companion failed for ${PLATFORMS[t]?.label ?? t}: ${res.error.message}`);
      continue;
    }
    if (res.status !== 0) {
      const detail = (res.stderr || res.stdout || '').trim().split('\n').pop() || `exit ${res.status}`;
      warn(`BuddyX companion failed for ${PLATFORMS[t]?.label ?? t}: ${detail}`);
      continue;
    }

    installedFor.push(PLATFORMS[t]?.label ?? t);
  }

  if (installedFor.length) {
    // buddyx's own installer is idempotent and exits 0 whether it wrote the skill
    // or skipped an existing one, so "ready" is accurate in both cases (its own
    // output reports the installed-vs-skipped detail).
    heading('BuddyX companion:');
    added(`ready for ${installedFor.join(', ')}`);
    console.log(
      `  Orchestrate multi-step work with ${chalk.cyan('/buddyx')} — it routes sub-tasks to specialists.`,
    );
  }
}
