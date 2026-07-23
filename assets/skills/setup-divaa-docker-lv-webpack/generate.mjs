#!/usr/bin/env node
// setup-divaa-docker-lv-webpack — deterministic template stamper + deploy entrypoint.
//
// Writes the divaa-docker config fileset into a Laravel + **Laravel Mix / webpack**
// project (Vue 2 era), including the Mutagen project file that carries the 0644/0755
// permissions block. Generation is pure: no host access, no secrets. Deployment is a
// separate, explicit step.
//
// For a Laravel + **Vite** project use the sibling skill `setup-divaa-docker-lv-vite`
// instead. The two differ by more than a rename — see "Webpack vs Vite" in SKILL.md.
//
// Usage:
//   node generate.mjs --slug precision-fabrication-vue --prefix precisionfab --php 8.2 \
//        --db precisionfab_db --topology a --target .
//   node generate.mjs plan --slug precision-fabrication-vue --target .  (resolve + print, write nothing)
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
//   --slug        subdomain base -> <slug>.app.test and <slug>-hot.app.test   (required)
//   --domain      PRIMARY dev domain             (default: <slug>.app.test)
//   --hot-domain  webpack-dev-server domain      (default: <slug>-hot.app.test)
//   --prefix      container/router prefix, e.g. precisionfab (default: slug w/o non-alnum)
//   --php         PHP image tag, e.g. 8.2 (default: 8.2 — detect from composer.lock!)
//   --node        node image tag for the hot container
//                 (default: detected from the laravel-mix major — Mix 5 => 16-bullseye)
//   --db          MySQL database name (default: <prefix>_db)
//   --topology    a | b | c   (a = host + Mutagen, b = local PC, c = host, edit-on-host)
//   --web-port    local (topology b) app port   (default: 8080)
//   --hot-port    webpack-dev-server port        (default: 443 — see below)
//   --hot-port-local  dev-server port for topology B only (default: 8081)
//   --hot-probe   asset path used to health-check the dev server
//                 (default: detected from webpack.mix.js mix.js() output dir)
//   --host-user   SSH user on divaa-docker       (default: chintan) -> beta path
//   --target      project directory to write into (default: current dir)
//   --force       overwrite files that already exist (default: skip + warn)
//   --no-patch    skip the webpack.mix.js / .gitignore auto-patch
//
// WHY --hot-port DEFAULTS TO 443 (and not a 5xxx port like the Vite skill):
// Laravel's mix() reads public/hot and rewrites asset URLs to that host:port. The
// browser is on an HTTPS page, so the bundle + HMR websocket must arrive over
// 443/wss via Traefik or they are blocked as mixed content. Rather than proxy a
// high port, webpack-dev-server simply listens on 443 inside the container and
// Traefik routes straight to it. Changing this means changing the Traefik
// loadbalancer port and MIX_HMR_PORT together — they are one setting in two places.

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs'
import { dirname, resolve, basename, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

// Resolved from this file's own URL, so the skill works from any location and
// never reaches back into a sibling skill directory.
const HERE = dirname(fileURLToPath(import.meta.url))
const TPL = join(HERE, 'templates')

// ---- global divaa-docker config (host-fact defaults) --------------------
// Read-only view of ~/.divaa-docker/config.json (written by the
// divaa-docker-config skill). Supplies host facts — IP, SSH user, apps root —
// as DEFAULTS so they aren't retyped per project. TOLERANT BY DESIGN: a missing
// file or a parse error yields {} and never throws, so with no config present
// the generator behaves EXACTLY as before (byte-identical output). Precedence is
// always: explicit CLI flag > global config > hardcoded fallback.
function loadGlobalConfig() {
  try {
    const p = join(homedir(), '.divaa-docker', 'config.json')
    if (!existsSync(p)) return {}
    const obj = JSON.parse(readFileSync(p, 'utf8'))
    return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {}
  } catch { return {} }
}
const gcfg = loadGlobalConfig()
const gHost = (gcfg && typeof gcfg.host === 'object' && gcfg.host) || {}
const gSsh = (gHost && typeof gHost.ssh === 'object' && gHost.ssh) || {}
// Resolve one host fact: explicit flag wins, else global config, else fallback.
// Also reports the source so `plan` can label it (`given` / `config` / default).
function hostFact(flagKey, cfgVal, fallback) {
  if (args[flagKey] !== undefined) return { value: String(args[flagKey]), src: 'given' }
  if (cfgVal !== undefined && cfgVal !== null && cfgVal !== '') return { value: String(cfgVal), src: 'config' }
  return { value: fallback, src: `derived (${fallback})` }
}

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
const php = String(args.php || '8.2')
const db = args.db || `${prefix}_db`
const topology = String(args.topology || 'a').toLowerCase()
const webPort = String(args['web-port'] || '8080')
const hotPort = String(args['hot-port'] || '443')
// Topology B has no Traefik and no TLS — the page is plain http://localhost, so
// the dev server needs a normal high port instead of 443 (which would also want
// privileges and collide with anything already on it).
const hotPortLocal = String(args['hot-port-local'] || '8081')
// Host facts: explicit flag > global config > hardcoded fallback (see hostFact).
// With no config file present, every fallback below equals today's literal, so
// output stays byte-identical.
const hostUserF = hostFact('host-user', gSsh.user, 'chintan')
const hostUser = hostUserF.value
const divaaIpF = hostFact('ip', gHost.ip, '192.168.1.21')
const divaaIp = divaaIpF.value
// appsRoot defaults to /home/<user>/apps — the SAME string BETA_PATH used before,
// so an absent config reproduces the old path exactly. There is no CLI flag for
// it (kept config-or-default).
const appsRootF = (gHost.appsRoot !== undefined && gHost.appsRoot !== null && gHost.appsRoot !== '')
  ? { value: String(gHost.appsRoot), src: 'config' }
  : { value: `/home/${hostUser}/apps`, src: `derived (/home/${hostUser}/apps)` }
const appsRoot = appsRootF.value
// The dev domains are asked for explicitly (SKILL.md Step 1) rather than being
// silently derived — but the derivation stays as the default so the common case
// needs no typing.
const appDomain = String(args.domain || `${slug}.app.test`)
const hotDomain = String(args['hot-domain'] || `${slug}-hot.app.test`)
const force = !!args.force
const noPatch = !!args['no-patch']

// ---- detect: node tag for the hot container -----------------------------
// Laravel Mix 5 pins webpack 4, whose hashing calls a MD4 digest that OpenSSL 3
// (node >= 17) removed. On node 18+ the build dies instantly with
// `error:0308010C:digital envelope routines::unsupported` (ERR_OSSL_EVP_UNSUPPORTED).
// So the node tag is a FUNCTION of the Mix major, not a taste choice. Mix 6+ moved
// to webpack 5 and is fine on modern node.
// Returns null when it can't tell — the caller then keeps the conservative default
// rather than guessing high and shipping a container that crash-loops.
function detectNodeTag(dir) {
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) return null
  let pkg
  try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) } catch { return null }
  const range = (pkg.devDependencies || {})['laravel-mix'] || (pkg.dependencies || {})['laravel-mix']
  if (!range) return null
  const major = Number((String(range).match(/(\d+)/) || [])[1])
  if (!Number.isFinite(major)) return null
  return major <= 5 ? '16-bullseye' : '18-bullseye'
}
const detectedNode = detectNodeTag(target)
const node = String(args.node || detectedNode || '16-bullseye')

// ---- detect: dev-server health probe ------------------------------------
// webpack-dev-server has no reliable generic health endpoint: `/webpack-dev-server`
// answers 502 through Traefik on this stack (verified against both live Mix
// projects), so we probe a real emitted asset instead. Derive it from the mix.js()
// output dir — `mix.js('resources/adminapp/js/app.js', 'public/adminapp/js')`
// serves at `/adminapp/js/app.js`. Falls back to that same path, which is the
// QuickAdminPanel convention both current projects happen to share — a convention,
// not a guarantee, hence --hot-probe.
function detectHotProbe(dir) {
  const cfg = join(dir, 'webpack.mix.js')
  if (!existsSync(cfg)) return null
  const m = readFileSync(cfg, 'utf8')
    .match(/mix\s*(?:\.\w+\([^)]*\)\s*)*?\.js\(\s*['"]([^'"]+)['"]\s*,\s*['"]public\/([^'"]+)['"]\s*\)/)
  if (!m) return null
  const entry = basename(m[1])                 // app.js
  return `/${m[2].replace(/\/+$/, '')}/${entry}` // /adminapp/js/app.js
}
const detectedProbe = detectHotProbe(target)
const hotProbe = String(args['hot-probe'] || detectedProbe || '/adminapp/js/app.js')

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
  HOT_DOMAIN: hotDomain,
  HOT_PORT: hotPort,
  HOT_PORT_LOCAL: hotPortLocal,
  HOT_PROBE: hotProbe,
  NODE: node,
  DIVAA_IP: divaaIp,
  WEB_PORT: webPort,
  REDIS_PREFIX: `${prefix}_`,
  PROJECT_DIR: projectDir,
  HOST_USER: hostUser,
  // Mutagen beta + host deploy dir. The SAME string must be used by the scp
  // target, the sync beta, and the host compose dir — so it is derived once.
  // appsRoot comes from the global config when set (else /home/<user>/apps).
  BETA_PATH: `${appsRoot}/${projectDir}`,
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
    ['hot domain', vars.HOT_DOMAIN, provided('hot-domain', `${slug}-hot.app.test`)],
    ['mysql database', db, provided('db', `${prefix}_db`)],
    ['container prefix', prefix, provided('prefix', 'slug w/o non-alnum')],
    ['php version', php, provided('php', '8.2 — DETECT from composer.lock')],
    ['node tag (hot)', node, args.node !== undefined
      ? 'given'
      : detectedNode
        ? `detected (laravel-mix major -> node:${detectedNode})`
        : 'FALLBACK 16-bullseye — no laravel-mix found, CONFIRM'],
    ['hot port', hotPort, provided('hot-port', '443 — Traefik TLS port')],
    ['hot probe', hotProbe, args['hot-probe'] !== undefined
      ? 'given'
      : detectedProbe
        ? 'detected (webpack.mix.js mix.js output)'
        : 'FALLBACK /adminapp/js/app.js — CONFIRM'],
    ['web port (topology b)', webPort, provided('web-port', '8080')],
    ['host ssh user', hostUser, hostUserF.src],
    ['host dir', vars.BETA_PATH, appsRootF.src === 'config'
      ? `config appsRoot (${appsRoot}/${projectDir})`
      : `derived (${appsRoot}/${projectDir})`],
    ['mutagen session', vars.MUTAGEN_NAME, 'derived (= prefix)'],
    ['redis key prefix', vars.REDIS_PREFIX, 'derived (= prefix_)'],
    // 'fixed' preserves the pre-config label when neither flag nor config set it.
    ['divaa host ip', vars.DIVAA_IP, divaaIpF.src === 'given' ? 'given' : divaaIpF.src === 'config' ? 'config' : 'fixed'],
  ]
  console.log('\nsetup-divaa-docker-lv-webpack — PLAN (nothing written)\n')
  const w = Math.max(...rows.map(([k]) => k.length))
  for (const [k, v, src] of rows) console.log(`  ${k.padEnd(w)}  ${String(v).padEnd(34)} ${src}`)
  console.log('\n  hosts entries that will be needed:')
  console.log(`    ${vars.DIVAA_IP}  ${vars.APP_DOMAIN}`)
  if (topology !== 'b') console.log(`    ${vars.DIVAA_IP}  ${vars.HOT_DOMAIN}`)
  if (!detectedNode && !args.node) {
    console.log('\n  ⚠️  laravel-mix not found in package.json — is this actually a Mix project?')
    console.log('      If it uses Vite, STOP and use the setup-divaa-docker-lv-vite skill instead.')
  }
  console.log('\n  JSON:')
  console.log('  ' + JSON.stringify({
    topology, slug, domain: vars.APP_DOMAIN, hotDomain: vars.HOT_DOMAIN, db, prefix,
    php, node, hotPort, hotProbe, webPort, hostUser, betaPath: vars.BETA_PATH, target,
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

// ---- auto-patch: webpack.mix.js ----------------------------------------
// Inserts the env-gated HMR block ahead of the first `mix.js(...)` call, matching
// the layout of the two projects already running this on the host. The block is
// inert unless MIX_HMR_HOST is set, so a patched config behaves exactly as before
// on the PC. An existing devServer/hmrOptions config is left alone with
// instructions — silently merging two dev-server configs produces a server that
// starts but serves the wrong origin, which is slow and miserable to diagnose.
function patchWebpackMix() {
  const cfg = join(target, 'webpack.mix.js')
  const blockRef = join(HERE, 'mix-hmr-block.js')
  if (!existsSync(cfg)) {
    manual.push(`webpack.mix.js not found — is this a Laravel Mix project?
      If it uses Vite, use the setup-divaa-docker-lv-vite skill instead.`)
    return
  }
  const name = 'webpack.mix.js'
  let text = readFileSync(cfg, 'utf8')

  // Detect against CODE only. A stock webpack.mix.js is mostly comment prose (the
  // `/* | Mix Asset Management */` banner), and Mix's own docs mention devServer —
  // so testing the raw text reports a hand-merge for a file that configures nothing.
  // Only whole-line // comments are stripped, never trailing ones: a naive strip
  // would eat the `//` in a `'http://...'` string literal and could hide real code.
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')

  if (/MIX_HMR_HOST/.test(code)) { patched.push(`${name} (already patched — left as-is)`); return }
  if (/\b(devServer|hmrOptions)\b/.test(code)) {
    manual.push(`${name} — already configures devServer/hmrOptions; merge by hand from ${blockRef}
      (keep the existing keys; output.publicPath MUST end up protocol-relative)`)
    return
  }
  const m = text.match(/^\s*mix\s*[\s\S]{0,40}?\.js\s*\(/m)
  if (!m) {
    manual.push(`${name} — no \`mix.js(...)\` call found to anchor the block; merge by hand from ${blockRef}`)
    return
  }

  // Anchor above the mix.js() call — but first back up over any comment lines
  // directly above it. Inserting between a `// Admin App` header and the call it
  // labels would leave that header captioning our HMR block instead.
  let at = m.index
  const before = text.slice(0, at).split('\n')
  while (before.length && /^\s*(\/\/|\/\*|\*|$)/.test(before[before.length - 1])) before.pop()
  at = before.join('\n').length + (before.length ? 1 : 0)

  const block = readFileSync(blockRef, 'utf8').replace(/\r\n/g, '\n')
  text = text.slice(0, at) + block + '\n' + text.slice(at)
  writeFileSync(cfg, text, 'utf8')
  patched.push(`${name} (+ env-gated MIX_HMR block)`)
}

if (!noPatch) {
  patchGitignore()
  if (topology !== 'b') patchWebpackMix()
}

// ---- report -------------------------------------------------------------
console.log(`\nsetup-divaa-docker-lv-webpack — topology ${topology.toUpperCase()}`)
console.log('  slug     :', slug)
console.log('  prefix   :', prefix)
console.log('  php      :', php)
console.log('  node     : ' + node + (detectedNode ? '  (detected from laravel-mix)' : '  (FALLBACK — confirm)'))
console.log('  database :', db)
if (topology !== 'b') {
  console.log('  app URL  : https://' + vars.APP_DOMAIN)
  console.log('  hot URL  : https://' + vars.HOT_DOMAIN + '  (port ' + hotPort + ')')
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
