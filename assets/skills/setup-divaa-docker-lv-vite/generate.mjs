#!/usr/bin/env node
// setup-divaa-docker-lv-vite — deterministic template stamper + deploy entrypoint.
//
// Writes the divaa-docker config fileset into a Laravel (+ Vite) project, including
// the Mutagen project file that carries the 0644/0755 permissions block. Generation
// is pure: no host access, no secrets. Deployment is a separate, explicit step.
//
// Usage:
//   node generate.mjs --slug inn-flow-2026 --prefix innflow --php 8.4 \
//        --db inn_flow_2026_db --topology a --target .
//   node generate.mjs plan --slug inn-flow-2026 --target .   (resolve + print, write nothing)
//   node generate.mjs deploy --target . [--mode dev|prod]
//
// Commands:
//   plan          resolve every parameter (including derived defaults) and print
//                 them as a table + JSON. Writes NOTHING. Run this FIRST so the
//                 values can be confirmed before anything is stamped — see the
//                 "Step 1" intake gate in SKILL.md.
//   (default)     stamp the config fileset into --target
//   deploy        run <target>/docker/deploy-divaa.sh (topology A only). It
//                 confirms before mutating shared-host state; nothing about the
//                 shared host is auto-approved. --mode selects dev (default)/prod.
//
// Options:
//   --slug        subdomain base -> <slug>.app.test and <slug>-vite.app.test   (required)
//   --domain      PRIMARY dev domain             (default: <slug>.app.test)
//   --vite-domain Vite dev-server domain         (default: <slug>-vite.app.test)
//   --prefix      container/router prefix, e.g. innflow (default: slug w/o non-alnum)
//   --php         PHP image tag, e.g. 8.4 (default: 8.4 — detect from composer.lock!)
//   --db          MySQL database name (default: <prefix>_db)
//   --topology    a | b | c   (a = host + Mutagen, b = local PC, c = host, edit-on-host)
//   --web-port    local (topology b) app port   (default: 8080)
//   --vite-port   Vite dev-server port           (default: 5281 — house convention)
//   --host-user   SSH user on divaa-docker       (default: chintan) -> beta path
//   --target      project directory to write into (default: current dir)
//   --force       overwrite files that already exist (default: skip + warn)
//   --no-patch    skip the vite.config / .gitignore auto-patch

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs'
import { dirname, resolve, basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

// Resolved from this file's own URL, so the skill works from any location and
// never reaches back into a sibling skill directory.
const HERE = dirname(fileURLToPath(import.meta.url))
const TPL = join(HERE, 'templates')

// ---- parse args ---------------------------------------------------------
const argv = process.argv.slice(2)
const command = argv[0] && !argv[0].startsWith('--') ? argv.shift() : 'generate'
const args = {}
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a.startsWith('--')) {
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) { args[key] = next; i++ }
    else args[key] = true
  }
}
const target = resolve(args.target || '.')

// ---- deploy command -----------------------------------------------------
if (command === 'deploy') {
  const script = join(target, 'docker', 'deploy-divaa.sh')
  if (!existsSync(script)) {
    console.error(`ERROR: ${script} not found — run the generator (topology a) first.`)
    process.exit(1)
  }
  const mode = (args.mode === true || !args.mode) ? 'dev' : String(args.mode)
  if (!['dev', 'prod'].includes(mode)) {
    console.error(`ERROR: --mode must be dev or prod (got "${mode}")`)
    process.exit(1)
  }
  // stdio inherit so the script's confirmation prompts reach the real terminal.
  const r = spawnSync('bash', [script, mode], { cwd: target, stdio: 'inherit' })
  if (r.error) { console.error(`ERROR: could not run bash — ${r.error.message}`); process.exit(1) }
  process.exit(r.status ?? 1)
}

if (!['generate', 'plan'].includes(command)) {
  console.error(`ERROR: unknown command "${command}" (expected "plan", "deploy", or no command to generate)`)
  process.exit(1)
}

const slug = args.slug
if (!slug) {
  console.error('ERROR: --slug is required (e.g. --slug inn-flow-2026)')
  process.exit(1)
}
const prefix = args.prefix || slug.replace(/[^a-z0-9]/gi, '').toLowerCase()
const php = String(args.php || '8.4')
const db = args.db || `${prefix}_db`
const topology = String(args.topology || 'a').toLowerCase()
const webPort = String(args['web-port'] || '8080')
const vitePort = String(args['vite-port'] || '5281')
const hostUser = String(args['host-user'] || 'chintan')
// The dev domains are asked for explicitly (SKILL.md Step 1) rather than being
// silently derived — but the derivation stays as the default so the common case
// needs no typing.
const appDomain = String(args.domain || `${slug}.app.test`)
const viteDomain = String(args['vite-domain'] || `${slug}-vite.app.test`)
const force = !!args.force
const noPatch = !!args['no-patch']

// Which values the user actually supplied vs. which we derived — `plan` shows this
// so nothing is confirmed blind.
const provided = (k, v) => (args[k] !== undefined ? 'given' : `derived (${v})`)

if (!['a', 'b', 'c'].includes(topology)) {
  console.error(`ERROR: --topology must be a, b, or c (got "${topology}")`)
  process.exit(1)
}

const projectDir = basename(target)

const vars = {
  SLUG: slug,
  PREFIX: prefix,
  PHP: php,
  DB: db,
  APP_DOMAIN: appDomain,
  VITE_DOMAIN: viteDomain,
  VITE_PORT: vitePort,
  DIVAA_IP: '192.168.1.21',
  WEB_PORT: webPort,
  REDIS_PREFIX: `${prefix}_`,
  PROJECT_DIR: projectDir,
  HOST_USER: hostUser,
  // Mutagen beta + host deploy dir. The SAME string must be used by the scp
  // target, the sync beta, and the host compose dir — so it is derived once.
  BETA_PATH: `/home/${hostUser}/apps/${projectDir}`,
  MUTAGEN_NAME: prefix,
  // php-fpm HTTPS signal: on behind Traefik TLS (A/C), off for plain-http local (B).
  FPM_HTTPS: topology === 'b'
    ? '        # Served over plain HTTP locally (topology B) — do NOT force HTTPS.'
    : '        # Reached only via the TLS-terminating proxy — tell the app it is HTTPS.\n'
      + '        fastcgi_param HTTPS on;\n'
      + '        fastcgi_param HTTP_X_FORWARDED_PROTO https;',
}

// ---- plan command -------------------------------------------------------
// Resolve-and-print, writing nothing. The point is that every default is SHOWN
// before it is used, so the user confirms real values instead of trusting that
// the generator guessed right.
if (command === 'plan') {
  const rows = [
    ['topology', topology, provided('topology', 'a')],
    ['slug', slug, 'given'],
    ['primary domain', vars.APP_DOMAIN, provided('domain', `${slug}.app.test`)],
    ['vite domain', vars.VITE_DOMAIN, provided('vite-domain', `${slug}-vite.app.test`)],
    ['mysql database', db, provided('db', `${prefix}_db`)],
    ['container prefix', prefix, provided('prefix', 'slug w/o non-alnum')],
    ['php version', php, provided('php', '8.4 — DETECT from composer.lock')],
    ['vite port', vitePort, provided('vite-port', '5281 house convention')],
    ['web port (topology b)', webPort, provided('web-port', '8080')],
    ['host ssh user', hostUser, provided('host-user', 'chintan')],
    ['host dir', vars.BETA_PATH, `derived (/home/${hostUser}/apps/${projectDir})`],
    ['mutagen session', vars.MUTAGEN_NAME, 'derived (= prefix)'],
    ['redis key prefix', vars.REDIS_PREFIX, 'derived (= prefix_)'],
    ['divaa host ip', vars.DIVAA_IP, 'fixed'],
  ]
  console.log('\nsetup-divaa-docker-lv-vite — PLAN (nothing written)\n')
  const w = Math.max(...rows.map(([k]) => k.length))
  for (const [k, v, src] of rows) console.log(`  ${k.padEnd(w)}  ${String(v).padEnd(34)} ${src}`)
  console.log('\n  hosts entries that will be needed:')
  console.log(`    ${vars.DIVAA_IP}  ${vars.APP_DOMAIN}`)
  if (topology !== 'b') console.log(`    ${vars.DIVAA_IP}  ${vars.VITE_DOMAIN}`)
  console.log('\n  JSON:')
  console.log('  ' + JSON.stringify({
    topology, slug, domain: vars.APP_DOMAIN, viteDomain: vars.VITE_DOMAIN, db, prefix,
    php, vitePort, webPort, hostUser, betaPath: vars.BETA_PATH, target,
  }))
  console.log('\nConfirm these with the user, then re-run without `plan` to write.')
  process.exit(0)
}

// ---- file map -----------------------------------------------------------
const shared = [
  ['docker/php/Dockerfile.tmpl', 'docker/php/Dockerfile'],
  ['docker/php/php.ini.tmpl', 'docker/php/php.ini'],
  ['docker/nginx/default.conf.tmpl', 'docker/nginx/default.conf'],
]
const hostFiles = [
  ...shared,
  ['docker-compose.divaa.yml.tmpl', 'docker-compose.divaa.yml'],
  ['docker-compose.divaa.dev.yml.tmpl', 'docker-compose.divaa.dev.yml'],
  ['env.divaa.tmpl', '.env.divaa'],
  ['README.divaa.md.tmpl', 'docker/README.divaa.md'],
  // Topology A and C both route through Traefik, so both need hosts entries.
  ['hosts-divaa.ps1.tmpl', 'docker/hosts-divaa.ps1'],
]
// Mutagen + the deploy script are topology-A only: C edits on the host (no sync),
// B never touches the host at all.
const mutagenFiles = [
  ['mutagen.yml.tmpl', 'mutagen.yml'],
  ['deploy-divaa.sh.tmpl', 'docker/deploy-divaa.sh'],
]
const localFiles = [
  ...shared,
  ['docker-compose.local.yml.tmpl', 'docker-compose.local.yml'],
  ['env.local.tmpl', '.env.local'],
]
const files = topology === 'b'
  ? localFiles
  : topology === 'a' ? [...hostFiles, ...mutagenFiles] : hostFiles

const EXECUTABLE = new Set(['docker/deploy-divaa.sh'])
// Windows PowerShell 5.1 decodes a BOM-less .ps1 as ANSI/cp1252. A UTF-8 em-dash
// then arrives as 'a€"' whose last char is U+201D — a smart quote the PS parser
// treats as a string terminator, producing a cascade of bogus syntax errors. The
// template is kept ASCII-only AND written with a BOM; either alone would do, but
// the BOM also protects anyone who later edits in a typographic character.
const BOM_FILES = new Set(['docker/hosts-divaa.ps1'])

// ---- stamp --------------------------------------------------------------
function stamp(text) {
  // Only {{WORD}} is a token. Go template syntax like {{.Names}} (docker ps
  // --format) contains a dot, so it never matches — that is deliberate.
  return text.replace(/\{\{(\w+)\}\}/g, (m, k) => {
    if (!(k in vars)) throw new Error(`Unknown template token {{${k}}}`)
    return vars[k]
  })
}

const written = [], skipped = []
for (const [tpl, out] of files) {
  const src = join(TPL, tpl)
  const dst = join(target, out)
  // Read template, normalise to LF — critical for .env files (a trailing CR gets
  // baked into a password and breaks auth) and for the deploy script (a CRLF
  // shebang makes the host say "bad interpreter"). Then stamp.
  const raw = readFileSync(src, 'utf8').replace(/\r\n/g, '\n')
  const content = stamp(raw)
  if (existsSync(dst) && !force) { skipped.push(out); continue }
  mkdirSync(dirname(dst), { recursive: true })
  if (BOM_FILES.has(out)) {
    // Fail loudly rather than emit a .ps1 that dies with an unrelated-looking
    // syntax error three months from now.
    const bad = [...content].filter((c) => c.charCodeAt(0) > 127)
    if (bad.length) {
      throw new Error(`${out} must be ASCII-only (PowerShell 5.1 ANSI decoding); `
        + `found: ${[...new Set(bad)].join(' ')}`)
    }
    writeFileSync(dst, '﻿' + content, 'utf8')
  } else {
    writeFileSync(dst, content, 'utf8') // LF preserved
  }
  if (EXECUTABLE.has(out)) { try { chmodSync(dst, 0o755) } catch { /* Windows: no-op */ } }
  written.push(out)
}

// ---- auto-patch: .gitignore --------------------------------------------
// Safe to automate: append-only and idempotent — it never reorders, rewrites, or
// drops an existing line.
const patched = [], manual = []
function patchGitignore() {
  const gi = join(target, '.gitignore')
  const need = topology === 'b' ? ['.env.local'] : ['.env.divaa']
  let text = existsSync(gi) ? readFileSync(gi, 'utf8') : ''
  const lines = text.split(/\r?\n/).map((l) => l.trim())
  const missing = need.filter((n) => !lines.includes(n) && !lines.includes(`/${n}`))
  if (!missing.length) return
  if (text.length && !text.endsWith('\n')) text += '\n'
  text += `\n# divaa-docker host-only env (holds injected secrets — never commit)\n${missing.join('\n')}\n`
  writeFileSync(gi, text, 'utf8')
  patched.push(`.gitignore (+ ${missing.join(', ')})`)
}

// ---- auto-patch: vite.config -------------------------------------------
// Only patches the one unambiguous shape: `defineConfig({ ... })` with NO
// existing `server` key. A factory form, or an existing server block we would
// have to merge into, is left alone with instructions — a bad automated merge
// here breaks the dev server in ways that are slow to diagnose.
function patchViteConfig() {
  const cfg = ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs']
    .map((f) => join(target, f)).find((f) => existsSync(f))
  if (!cfg) return
  const name = basename(cfg)
  const blockRef = join(HERE, 'vite-server-block.js')
  let text = readFileSync(cfg, 'utf8')

  if (text.includes('VITE_HMR_HOST')) { patched.push(`${name} (already patched — left as-is)`); return }
  if (/\bserver\s*:/.test(text)) {
    manual.push(`${name} — already has a \`server:\` key; merge by hand from ${blockRef}
      (keep the existing keys; if it has \`server.watch\`, merge usePolling INTO that watch object)`)
    return
  }
  const m = text.match(/export\s+default\s+defineConfig\s*\(\s*\{/)
  if (!m) {
    manual.push(`${name} — not the plain \`defineConfig({...})\` shape (factory form?);
      merge by hand from ${blockRef}`)
    return
  }

  const consts = `
// --- divaa-docker dev server (env-gated) ------------------------------------
// No-op locally: with no VITE_* vars set, Vite keeps its defaults. Only the
// <prefix>-vite container sets these, routing the dev server + HMR websocket
// through Traefik over WSS. Never hardcode the domain — keep it env-driven so
// the same config works on the PC and on the host.
const hmrHost = process.env.VITE_HMR_HOST
const hmrProtocol = process.env.VITE_HMR_PROTOCOL // 'wss' behind Traefik TLS
const hmrClientPort = process.env.VITE_HMR_CLIENT_PORT ? Number(process.env.VITE_HMR_CLIENT_PORT) : undefined
const allowedHosts = process.env.VITE_ALLOWED_HOSTS?.split(',').map((h) => h.trim()).filter(Boolean)
const corsOrigin = process.env.VITE_CORS_ORIGIN
// Escape hatch: bind-mount inotify events don't always reach the container and
// HMR then goes dead with no error. Off by default — costs nothing unused.
const usePolling = process.env.VITE_USE_POLLING === '1'

const divaaServer = {
  ...(process.env.VITE_DEV_SERVER_HOST ? { host: process.env.VITE_DEV_SERVER_HOST } : {}),
  ...(process.env.VITE_DEV_SERVER_PORT ? { port: Number(process.env.VITE_DEV_SERVER_PORT), strictPort: true } : {}),
  ...(allowedHosts ? { allowedHosts } : {}),
  ...(corsOrigin ? { cors: { origin: corsOrigin } } : {}),
  ...(hmrHost
    ? { hmr: { host: hmrHost, ...(hmrProtocol ? { protocol: hmrProtocol } : {}), ...(hmrClientPort ? { clientPort: hmrClientPort } : {}) } }
    : {}),
  ...(usePolling ? { watch: { usePolling: true } } : {}),
}
// ---------------------------------------------------------------------------

`
  text = text.slice(0, m.index) + consts + text.slice(m.index)
  const m2 = text.match(/export\s+default\s+defineConfig\s*\(\s*\{/)
  const at = m2.index + m2[0].length
  text = text.slice(0, at) + `\n  server: divaaServer,` + text.slice(at)
  writeFileSync(cfg, text, 'utf8')
  patched.push(`${name} (+ env-gated server block)`)
}

if (!noPatch) {
  patchGitignore()
  if (topology !== 'b') patchViteConfig()
}

// ---- report -------------------------------------------------------------
console.log(`\nsetup-divaa-docker-lv-vite — topology ${topology.toUpperCase()}`)
console.log('  slug     :', slug)
console.log('  prefix   :', prefix)
console.log('  php      :', php)
console.log('  database :', db)
if (topology !== 'b') {
  console.log('  app URL  : https://' + vars.APP_DOMAIN)
  console.log('  vite URL : https://' + vars.VITE_DOMAIN + '  (port ' + vitePort + ')')
  console.log('  host dir : ' + vars.BETA_PATH)
} else {
  console.log('  app URL  : http://localhost:' + webPort)
}
console.log('\nWrote:')
for (const f of written) console.log('  +', f)
if (skipped.length) {
  console.log('\nSkipped (already exist — pass --force to overwrite):')
  for (const f of skipped) console.log('  -', f)
}
if (patched.length) {
  console.log('\nPatched:')
  for (const f of patched) console.log('  ~', f)
}
if (manual.length) {
  console.log('\nNEEDS A HAND-MERGE (not safe to automate):')
  for (const f of manual) console.log('  !', f)
}
if (topology === 'a') {
  console.log('\nNext:')
  console.log('  1) hosts entries (append-only, needs admin — prints the exact command if not):')
  console.log('       powershell -NoProfile -ExecutionPolicy Bypass -File docker/hosts-divaa.ps1 -Elevate')
  console.log('  2) deploy (confirms before every shared-host mutation):')
  console.log(`       node ${join(HERE, 'generate.mjs')} deploy --target . --mode dev`)
} else {
  console.log('\nNext: see SKILL.md for the topology ' + topology.toUpperCase() + ' steps.')
  if (topology === 'c') console.log('  hosts entries: powershell -File docker/hosts-divaa.ps1 -Elevate')
}
