// Resolve the bundled skills payload that ships inside the npm tarball.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url)); // .../lib

// Dual candidates so it works whether lib/ sits one or two levels below the
// package root (mirrors the reference CLI's tolerance for different builds).
const CANDIDATES = [
  join(here, '..', 'assets', 'skills'),
  join(here, '..', '..', 'assets', 'skills'),
];

/** Absolute path to the bundled `assets/skills` directory. */
export function bundledSkillsRoot() {
  const found = CANDIDATES.find(existsSync);
  if (!found) {
    throw new Error(
      'Bundled skill assets not found. Try reinstalling: npm i -g divaa-docker',
    );
  }
  return found;
}

/**
 * Every bundled skill, discovered by scanning `assets/skills/*` for a folder
 * that contains a SKILL.md. Adding a new skill is just dropping its folder in —
 * no code change here.
 * @returns {{name: string, dir: string}[]} sorted by name.
 */
export function bundledSkills() {
  const root = bundledSkillsRoot();
  const skills = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    if (existsSync(join(dir, 'SKILL.md'))) skills.push({ name: entry.name, dir });
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  if (!skills.length) {
    throw new Error(`No bundled skills found under ${root}.`);
  }
  return skills;
}

/** Just the names of the bundled skills. */
export function bundledSkillNames() {
  return bundledSkills().map((s) => s.name);
}

/** Resolve one bundled skill by name, or throw with the valid set. */
export function bundledSkillDir(name) {
  const skill = bundledSkills().find((s) => s.name === name);
  if (!skill) {
    throw new Error(
      `Unknown skill "${name}". Bundled: ${bundledSkillNames().join(', ')}`,
    );
  }
  return skill.dir;
}
