// Platform (AI harness) registry and skill-path resolution.
//
// Each harness discovers Agent Skills in a `<root>/skills/<name>/SKILL.md` folder.
// `projectBase` is the dir under the current project; `globalBase` is the absolute
// dir under the user's home. Most harnesses use `~/<projectBase>` for global, but a
// few (opencode) keep global skills elsewhere, so `globalBase` can override that.

import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();

/**
 * projectBase — relative dir under the project root (process.cwd()).
 * globalBase   — absolute dir used with --global (defaults to ~/<projectBase>).
 * skillsSub    — sub-directory that holds skill folders (almost always "skills").
 */
export const PLATFORMS = {
  claude:   { label: 'Claude Code',  projectBase: '.claude',      globalBase: join(HOME, '.claude'),                   skillsSub: 'skills' },
  opencode: { label: 'opencode',     projectBase: '.opencode',    globalBase: join(HOME, '.config', 'opencode'),       skillsSub: 'skills' },
  cursor:   { label: 'Cursor',       projectBase: '.cursor',      globalBase: join(HOME, '.cursor'),                   skillsSub: 'skills' },
  windsurf: { label: 'Windsurf',     projectBase: '.windsurf',    globalBase: join(HOME, '.windsurf'),                 skillsSub: 'skills' },
  codex:    { label: 'Codex',        projectBase: '.codex',       globalBase: join(HOME, '.codex'),                    skillsSub: 'skills' },
  gemini:   { label: 'Gemini CLI',   projectBase: '.gemini',      globalBase: join(HOME, '.gemini'),                   skillsSub: 'skills' },
  antigravity: { label: 'Antigravity', projectBase: '.agents',    globalBase: join(HOME, '.agents'),                   skillsSub: 'skills' },
  factory:  { label: 'Factory Droid', projectBase: '.factory',    globalBase: join(HOME, '.factory'),                  skillsSub: 'skills' },
};

export const AI_TYPES = Object.keys(PLATFORMS);

/** Human-friendly list for prompts. */
export function platformChoices() {
  return AI_TYPES.map((value) => ({ title: `${PLATFORMS[value].label} (${value})`, value }));
}

export function isValidAI(ai) {
  return ai === 'all' || AI_TYPES.includes(ai);
}

/** Resolve the absolute install dir for one skill under a harness. */
export function resolveSkillDir(ai, skillName, { global = false } = {}) {
  const p = PLATFORMS[ai];
  if (!p) throw new Error(`Unknown AI harness: ${ai}`);
  const base = global ? p.globalBase : join(process.cwd(), p.projectBase);
  return join(base, p.skillsSub, skillName);
}

/** Expand "all" into every concrete harness key. */
export function expandTargets(ai) {
  return ai === 'all' ? [...AI_TYPES] : [ai];
}
