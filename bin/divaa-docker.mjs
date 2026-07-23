#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Command } from 'commander';
import { init } from '../lib/init.mjs';
import { uninstall } from '../lib/uninstall.mjs';
import { update } from '../lib/update.mjs';
import { AI_TYPES } from '../lib/platforms.mjs';
import { bundledSkillNames } from '../lib/assets.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));

const program = new Command();

program
  .name('divaa-docker')
  .description(
    'Install the divaa-docker Agent Skills (one-command Laravel onboarding onto the shared divaa-docker host) into AI coding assistants.',
  )
  .version(pkg.version, '-v, --version', 'output the version');

const aiHelp = `target assistant: ${AI_TYPES.join(', ')}, or "all"`;
const skillHelp = `limit to specific skill(s), comma-separated (default: all). Bundled: ${bundledSkillNames().join(', ')}`;

program
  .command('init')
  .description('Install the skill(s) into an assistant (project scope by default)')
  .option('--ai <type>', aiHelp)
  .option('--skill <names>', skillHelp)
  .option('--global', 'install into your home dir (all projects) instead of the current project')
  .option('--force', 'overwrite an existing install')
  .action((opts) => init(opts));

program
  .command('uninstall')
  .description('Remove the installed skill(s)')
  .option('--ai <type>', aiHelp)
  .option('--skill <names>', skillHelp)
  .option('--global', 'target the home-dir (global) install')
  .action((opts) => uninstall(opts));

program
  .command('update')
  .description('Re-install the bundled skill(s) over existing installs')
  .option('--ai <type>', aiHelp)
  .option('--skill <names>', skillHelp)
  .option('--global', 'target the home-dir (global) install')
  .action((opts) => update(opts));

program
  .command('skills')
  .description('List the skills bundled in this CLI')
  .action(() => {
    for (const name of bundledSkillNames()) console.log(name);
  });

program
  .command('versions')
  .description('Print the installed CLI version')
  .action(() => console.log(`divaa-docker v${pkg.version}`));

program.parseAsync(process.argv);
