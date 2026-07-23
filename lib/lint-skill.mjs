// Validates every bundled SKILL.md against the shared Agent Skills constraints
// that both Claude Code and opencode enforce.
import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { bundledSkills } from './assets.mjs';

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
}

function lintSkill(skillDir) {
  const skillMd = join(skillDir, 'SKILL.md');
  const raw = readFileSync(skillMd, 'utf8');
  const dirName = basename(skillDir);

  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) {
    fail(`${dirName}: SKILL.md has no YAML frontmatter block.`);
    return;
  }
  const body = fm[1];
  const nameLine = body.match(/^name:\s*(.+)$/m);
  const descLine = body.match(/^description:\s*([\s\S]+?)(?:\n[a-z_]+:|$)/m);

  let ok = true;

  if (!nameLine) {
    fail(`${dirName}: missing required frontmatter field: name`);
    ok = false;
  } else {
    const name = nameLine[1].trim();
    if (!NAME_RE.test(name)) {
      fail(`${dirName}: name "${name}" must be kebab-case (^[a-z0-9]+(-[a-z0-9]+)*$).`);
      ok = false;
    }
    if (name !== dirName) {
      fail(`${dirName}: name "${name}" must match the skill directory "${dirName}".`);
      ok = false;
    }
  }

  if (!descLine) {
    fail(`${dirName}: missing required frontmatter field: description`);
    ok = false;
  } else {
    const desc = descLine[1].replace(/\s+/g, ' ').trim();
    if (desc.length < 1 || desc.length > 1024) {
      fail(`${dirName}: description must be 1–1024 chars (got ${desc.length}).`);
      ok = false;
    }
  }

  if (ok) {
    console.log(`✓ ${dirName} — frontmatter and description within limits.`);
  }
}

for (const { dir } of bundledSkills()) lintSkill(dir);
