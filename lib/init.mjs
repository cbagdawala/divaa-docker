import prompts from 'prompts';
import { bundledSkillDir } from './assets.mjs';
import { parseSkillOption } from './select-skills.mjs';
import { copyDir, removeDir, exists } from './fsops.mjs';
import {
  PLATFORMS,
  AI_TYPES,
  isValidAI,
  resolveSkillDir,
  expandTargets,
  platformChoices,
} from './platforms.mjs';
import { detectPlatform } from './detect.mjs';
import { spinner, added, chalk, heading, error, warn } from './logue.mjs';

export async function init(opts = {}) {
  let ai = opts.ai;

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

  if (!ai) {
    const suggested = detectPlatform();
    const initialIdx = suggested ? AI_TYPES.indexOf(suggested) : 0;
    const res = await prompts({
      type: 'select',
      name: 'ai',
      message: 'Install the divaa-docker skill(s) for which assistant?',
      choices: [...platformChoices(), { title: 'All of the above', value: 'all' }],
      initial: initialIdx < 0 ? 0 : initialIdx,
    });
    if (!res.ai) {
      warn('Cancelled.');
      return;
    }
    ai = res.ai;
  }

  const global = !!opts.global;
  const force = !!opts.force;
  const targets = expandTargets(ai);
  const installed = [];
  const skipped = [];

  const spin = spinner('Installing the divaa-docker skill(s)…').start();
  try {
    for (const t of targets) {
      for (const skill of skills) {
        const src = bundledSkillDir(skill);
        const dest = resolveSkillDir(t, skill, { global });
        if (await exists(dest)) {
          if (!force) {
            skipped.push({ t, skill, dest });
            continue;
          }
          await removeDir(dest);
        }
        await copyDir(src, dest);
        installed.push({ t, skill, dest });
      }
    }
    spin.succeed('divaa-docker installed.');
  } catch (e) {
    spin.fail('Installation failed.');
    error(e.message);
    process.exit(1);
  }

  if (installed.length) {
    heading('Installed:');
    for (const { t, skill, dest } of installed) {
      added(`${PLATFORMS[t].label} · ${skill}: ${dest}`);
    }
  }
  if (skipped.length) {
    heading('Skipped (already present — pass --force to overwrite):');
    for (const { t, skill, dest } of skipped) {
      warn(`  • ${PLATFORMS[t].label} · ${skill}: ${dest}`);
    }
  }
  if (!installed.length) return;

  heading('Next steps:');
  console.log('  1. Restart your AI coding assistant.');
  console.log(
    `  2. Invoke it — type ${chalk.cyan('/setup-divaa-docker-lv-vite')} (Vite) or ` +
      `${chalk.cyan('/setup-divaa-docker-lv-webpack')} (Laravel Mix), or just ask, e.g. ` +
      '"set up this Laravel project on divaa-docker".',
  );
}
