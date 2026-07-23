#!/usr/bin/env node
// divaa-docker-config — the global Docker-host config store + its only writer.
//
// Persists the settings that are the SAME for every project onboarded onto the
// shared "divaa-docker" host (its IP, SSH identity, apps root, proxy network,
// where secrets live) plus a progressive registry of shared services (mysql,
// mailpit, redis, …). The setup generators read this file as host-fact defaults,
// so a value confirmed once here stops being re-typed per project.
//
// Store: ~/.divaa-docker/config.json  (versioned JSON, LF, trailing newline).
// This helper is the deterministic writer — same spirit as generate.mjs plan/
// generate: non-interactive, flag-driven, no host access. The LLM gathers the
// answers (AskUserQuestion, per SKILL.md) then persists them through these
// commands.
//
// SECRETS RULE — never store a real password/secret/token. Only a *pointer*
// such as `--password-source host-env` (meaning: injected on the host from
// host.secretsEnv). Mirrors the existing `__INJECT_ON_HOST__` ethos. A raw
// `--password`/`--secret`/`--token` flag is rejected with a non-zero exit.
//
// Usage:
//   node config.mjs path
//   node config.mjs show
//   node config.mjs get <dotpath>                 e.g. get host.ssh.user
//   node config.mjs set <dotpath> <value>         e.g. set host.ip 192.168.1.21
//   node config.mjs init [--mode remote] [--ip 192.168.1.21] [--ssh-alias divaa-docker]
//        [--ssh-user chintan] [--apps-root /home/chintan/apps] [--proxy proxy]
//        [--secrets-env ~/data/.env] [--domain-suffix app.test]
//   node config.mjs add-service <name> [--k v …]  e.g. add-service redis --mode shared
//        --host redis --port 6379 --password-source host-env
//   node config.mjs remove-service <name>
//
// Commands:
//   path            print the absolute store path (creates nothing). Handy for
//                   scripts that want to `cat` or back it up.
//   show            print the whole store as pretty JSON (an absent store reads
//                   as {"version":1}; nothing is written).
//   get             read one value by dot-path; prints scalars raw, objects as
//                   JSON. Missing path => stderr note + non-zero exit.
//   set             write one value by dot-path. The value is coerced (see
//                   below) so `set host.ip …` stores a string but `--port 6379`
//                   lands as a number. Deep-merges; never clobbers siblings.
//   init            set the host.* facts in one call from the named flags.
//   add-service     merge a service under services.<name> from its flags.
//   remove-service  drop services.<name>.
//
// Value coercion (set + every flag value): `true`/`false` => boolean; a bare
// integer => number; text that looks like JSON (`{`/`[`/quoted) => parsed;
// everything else => string. Force a string by quoting the JSON, e.g. '"6379"'.

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { randomBytes } from 'node:crypto'

// ---- store location -----------------------------------------------------
// os.homedir() + node:path keeps this correct on Windows (C:\Users\…) and POSIX
// (/home/…) alike — never hand-join with '/'.
const STORE_DIR = join(homedir(), '.divaa-docker')
const STORE_PATH = join(STORE_DIR, 'config.json')

// ---- parse args ---------------------------------------------------------
// Same shape as generate.mjs: first non-flag token is the command; `--k v`
// pairs become flags, a bare `--k` (no value / next is another flag) is `true`.
const argv = process.argv.slice(2)
const command = argv[0] && !argv[0].startsWith('--') ? argv.shift() : ''
const positionals = []
const flags = {}
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a.startsWith('--')) {
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) { flags[key] = next; i++ }
    else flags[key] = true
  } else {
    positionals.push(a)
  }
}

// ---- usage --------------------------------------------------------------
function usage(code = 0) {
  const out = code === 0 ? console.log : console.error
  out(`divaa-docker-config — global Docker-host config store

  store: ${STORE_PATH}

  node config.mjs path
  node config.mjs show
  node config.mjs get <dotpath>
  node config.mjs set <dotpath> <value>
  node config.mjs init [--mode --ip --ssh-alias --ssh-user --apps-root --proxy --secrets-env --domain-suffix]
  node config.mjs add-service <name> [--k v …]   (use --password-source, never --password)
  node config.mjs remove-service <name>

  Secrets: never a real password — only a pointer, e.g. --password-source host-env.`)
  process.exit(code)
}
if (command === '' || command === '--help' || command === '-h' || flags.help) usage(command === '' ? 1 : 0)

function die(msg) { console.error(`ERROR: ${msg}`); process.exit(1) }

// ---- value coercion -----------------------------------------------------
// Turn a CLI string into the most natural JSON type, so the store holds real
// numbers/booleans (which downstream readers can use without re-parsing) rather
// than everything-as-string. Deliberately conservative: only unambiguous shapes
// convert; anything else stays a string.
function coerce(raw) {
  if (typeof raw !== 'string') return raw // already a boolean `true` from a bare flag
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw === 'null') return null
  if (/^-?\d+$/.test(raw)) {
    const n = Number(raw)
    if (Number.isSafeInteger(n)) return n
  }
  const t = raw.trim()
  if (t && '{["'.includes(t[0])) {
    try { return JSON.parse(t) } catch { /* not JSON — fall through to string */ }
  }
  return raw
}

// ---- secrets guard ------------------------------------------------------
// Reject a raw secret flag/key before it can ever be written. A `*-source`
// pointer (passwordSource, tokenSource, …) is fine — that's the whole point.
function assertNotSecret(key) {
  const camel = toCamel(key)
  if (/(password|secret|token)$/i.test(camel)) {
    die(`refusing to store a raw secret ("${key}"). Store only a POINTER, e.g. `
      + `--password-source host-env (the value is injected on the host from host.secretsEnv).`)
  }
}

// ---- key normalisation --------------------------------------------------
// CLI flags are kebab (--password-source, --apps-root); store keys are camel
// (passwordSource, appsRoot). Convert once, in one place.
function toCamel(k) { return k.replace(/-([a-z0-9])/gi, (_, c) => c.toUpperCase()) }

// ---- load / persist -----------------------------------------------------
// Load is tolerant only about ABSENCE (fresh store); a corrupt file is a hard
// error here — this helper OWNS the file, so silently overwriting a parse error
// would destroy state the user meant to keep. (The generators, which only read,
// tolerate a bad file by ignoring it — that's their job, not this one's.)
function load() {
  if (!existsSync(STORE_PATH)) return { version: 1 }
  let text
  try { text = readFileSync(STORE_PATH, 'utf8') } catch (e) { die(`cannot read ${STORE_PATH}: ${e.message}`) }
  try {
    const obj = JSON.parse(text)
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      if (obj.version === undefined) obj.version = 1
      return obj
    }
    die(`${STORE_PATH} is not a JSON object`)
  } catch (e) {
    die(`${STORE_PATH} is not valid JSON (${e.message}). Fix or remove it — refusing to overwrite.`)
  }
}

// Atomic write: stringify, write a temp sibling, then rename over the target so
// a crash mid-write can never leave a half-written config. Pretty JSON + a
// trailing newline; LF endings (JSON.stringify never emits CR, so this is LF by
// construction and stays diff-friendly).
function persist(obj) {
  mkdirSync(STORE_DIR, { recursive: true })
  const json = JSON.stringify(obj, null, 2) + '\n'
  const tmp = join(STORE_DIR, `.config.${process.pid}.${randomBytes(4).toString('hex')}.tmp`)
  writeFileSync(tmp, json, 'utf8')
  renameSync(tmp, STORE_PATH)
}

// ---- dot-path helpers ---------------------------------------------------
function getPath(obj, dotpath) {
  const parts = dotpath.split('.')
  let cur = obj
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object' || !(p in cur)) return { found: false }
    cur = cur[p]
  }
  return { found: true, value: cur }
}

// Set-by-path that creates intermediate objects but never walks THROUGH a
// non-object (that would silently drop a scalar) — it errors instead.
function setPath(obj, dotpath, value) {
  const parts = dotpath.split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]
    if (cur[p] === undefined || cur[p] === null) cur[p] = {}
    else if (typeof cur[p] !== 'object' || Array.isArray(cur[p])) {
      die(`cannot set "${dotpath}": "${parts.slice(0, i + 1).join('.')}" is not an object`)
    }
    cur = cur[p]
  }
  cur[parts[parts.length - 1]] = value
}

// Deep-merge source INTO target (objects merge recursively; everything else,
// incl. arrays, replaces). Used by init/add-service so a partial update keeps
// unrelated siblings intact.
function deepMerge(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v)
        && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      deepMerge(target[k], v)
    } else {
      target[k] = v
    }
  }
  return target
}

// ---- commands -----------------------------------------------------------
switch (command) {
  case 'path': {
    console.log(STORE_PATH)
    break
  }

  case 'show': {
    const cfg = load()
    console.log(JSON.stringify(cfg, null, 2))
    break
  }

  case 'get': {
    const dotpath = positionals[0]
    if (!dotpath) die('get needs a <dotpath>, e.g. get host.ssh.user')
    const cfg = load()
    const r = getPath(cfg, dotpath)
    if (!r.found) { console.error(`(not set: ${dotpath})`); process.exit(1) }
    console.log(typeof r.value === 'object' ? JSON.stringify(r.value, null, 2) : String(r.value))
    break
  }

  case 'set': {
    const dotpath = positionals[0]
    if (!dotpath || positionals.length < 2) die('set needs <dotpath> <value>, e.g. set host.ip 192.168.1.21')
    // Guard the LAST segment — `set services.redis.password …` is still a secret.
    assertNotSecret(dotpath.split('.').pop())
    const value = coerce(positionals.slice(1).join(' '))
    const cfg = load()
    if (cfg.version === undefined) cfg.version = 1
    setPath(cfg, dotpath, value)
    persist(cfg)
    console.log(`set ${dotpath} = ${JSON.stringify(value)}`)
    break
  }

  case 'init': {
    // Named flags -> host.* facts. Only flags the caller actually passed are
    // written, so `init --ip X` updates the IP and leaves the rest untouched.
    const map = {
      mode: 'mode', ip: 'ip', 'ssh-alias': 'ssh.alias', 'ssh-user': 'ssh.user',
      'apps-root': 'appsRoot', proxy: 'proxyNetwork', 'secrets-env': 'secretsEnv',
      'domain-suffix': 'domainSuffix',
    }
    const host = {}
    let any = false
    for (const [flag, path] of Object.entries(map)) {
      if (flags[flag] === undefined) continue
      any = true
      const value = coerce(flags[flag])
      const parts = path.split('.')
      let cur = host
      for (let i = 0; i < parts.length - 1; i++) { cur[parts[i]] ??= {}; cur = cur[parts[i]] }
      cur[parts[parts.length - 1]] = value
    }
    // Reject any stray flag we don't recognise (likely a typo or a secret).
    for (const k of Object.keys(flags)) {
      if (k === 'help') continue
      assertNotSecret(k)
      if (!(k in map)) die(`unknown init flag "--${k}" (expected: ${Object.keys(map).map((f) => '--' + f).join(' ')})`)
    }
    if (!any) die('init needs at least one flag, e.g. init --ip 192.168.1.21 --ssh-user chintan')
    const cfg = load()
    if (cfg.version === undefined) cfg.version = 1
    cfg.host ??= {}
    deepMerge(cfg.host, host)
    persist(cfg)
    console.log(`init: merged host facts (${Object.keys(flags).filter((k) => k !== 'help').map((k) => '--' + k).join(' ')})`)
    console.log(JSON.stringify(cfg.host, null, 2))
    break
  }

  case 'add-service': {
    const name = positionals[0]
    if (!name) die('add-service needs a <name>, e.g. add-service redis --host redis --port 6379')
    const svc = {}
    for (const [k, raw] of Object.entries(flags)) {
      if (k === 'help') continue
      assertNotSecret(k) // rejects --password/--secret/--token; --password-source is fine
      svc[toCamel(k)] = coerce(raw)
    }
    const cfg = load()
    if (cfg.version === undefined) cfg.version = 1
    cfg.services ??= {}
    cfg.services[name] ??= {}
    deepMerge(cfg.services[name], svc)
    persist(cfg)
    console.log(`add-service: services.${name} =`)
    console.log(JSON.stringify(cfg.services[name], null, 2))
    break
  }

  case 'remove-service': {
    const name = positionals[0]
    if (!name) die('remove-service needs a <name>')
    const cfg = load()
    if (!cfg.services || !(name in cfg.services)) { console.error(`(no such service: ${name})`); process.exit(1) }
    delete cfg.services[name]
    persist(cfg)
    console.log(`removed service: ${name}`)
    break
  }

  default:
    console.error(`ERROR: unknown command "${command}"`)
    usage(1)
}
