import { bundledSkillDir } from './assets.mjs';
import { parseSkillOption } from './select-skills.mjs';
import { copyDir, removeDir, exists } from './fsops.mjs';
import {
  PLATFORMS,
  AI_TYPES,
  isValidAI,
  resolveSkillDir,
  expandTargets,
} from './platforms.mjs';
import { spinner, added, heading, warn, error } from './logue.mjs';

// Re-copy the bundled skills (from the installed CLI version) over any existing
// install. Targets come from --ai, else every harness that currently has one.
export async function update(opts = {}) {
  const ai = opts.ai;
  if (ai && !isValidAI(ai)) {
    error(`Unknown --ai "${ai}". Valid: ${AI_TYPES.join(', ')}, all`);
    process.exit(1);
  }

  let skills;
  try {
    skills = parseSkillOption(opts.skill);
  } catch (e) {
    error(e.message);
    process.exit(1);
  }

  const global = !!opts.global;
  const candidates = ai ? expandTargets(ai) : AI_TYPES;

  const targets = [];
  for (const t of candidates) {
    for (const skill of skills) {
      const dest = resolveSkillDir(t, skill, { global });
      if (await exists(dest)) targets.push({ t, skill, dest });
    }
  }

  if (!targets.length) {
    warn(
      `No existing divaa-docker install to update${global ? ' (global scope)' : ' in this project'}. Run "divaa-docker init" first.`,
    );
    return;
  }

  const spin = spinner('Updating the divaa-docker skill(s)…').start();
  try {
    for (const { skill, dest } of targets) {
      const src = bundledSkillDir(skill);
      await removeDir(dest);
      await copyDir(src, dest);
    }
    spin.succeed('divaa-docker updated.');
  } catch (e) {
    spin.fail('Update failed.');
    error(e.message);
    process.exit(1);
  }

  heading('Updated:');
  for (const { t, skill, dest } of targets) {
    added(`${PLATFORMS[t].label} · ${skill}: ${dest}`);
  }
}
