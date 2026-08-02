---
name: setup-divaa-docker-ci3
description: Use when onboarding a CodeIgniter 3 project onto the shared "divaa-docker" homelab host, or moving a CI3 app off XAMPP/WAMP/a bare LAMP onto it. Sets up Mutagen file-sync with the 0644/0755 permissions block, the Traefik HTTPS route, getenv()-driven database config, and a gated one-command deploy. Triggers: "set up this project on divaa-docker", "/setup-divaa-docker-ci3", "dockerise this CodeIgniter app on the shared host".
---

# setup-divaa-docker-ci3

## Overview
Onboards a CodeIgniter 3 project onto the shared **divaa-docker** host. A
deterministic generator (`generate.mjs`) stamps the Docker/Mutagen fileset from
templates; a generated, gated `docker/deploy-divaa.sh` then sequences the host
work (DB → secrets → sync → compose → first-run → verify).

CI3 has no native `.env` support, so the environment flows in two ways:
- **`ENVIRONMENT`** — the stock CI3 `index.php` reads `$_SERVER['CI_ENV']`;
  `.env.divaa` sets `CI_ENV=production` and the dev compose overlay flips it to
  `development`. No patch needed when `index.php` is stock.
- **DB credentials** — the generator patches `application/config/database.php`
  to read `getenv('DB_*')` with the existing literals kept as fallbacks (stock
  file shape only; anything else is reported for a hand-merge).

**REQUIRED BACKGROUND:** Use the **divaa-infra** skill — it holds the host facts
(IP `192.168.1.21`, `ssh divaa-docker`, the `proxy` network, Mailpit, and where
secrets live: `~/data/.env` on the host). This skill never embeds credentials.

## The shared host is shared — treat it that way
divaa-docker runs ~25 containers for 6+ sibling projects. A careless step there
breaks other people's work. **Confirm with the user before any mutation of shared
state**: creating a database on the shared MySQL, or taking a container/router
name on the `proxy` network. `deploy-divaa.sh` gates both (a y/N prompt on DB
creation, a collision check on the prefix) — do not pass `ASSUME_YES=1` on a
first deploy, and never bypass a gate on the user's behalf.

## Never commit secrets
Templates ship `DB_PASSWORD`/`REDIS_PASSWORD` as `__INJECT_ON_HOST__`. The real
values are read from the host's `~/data/.env` and written into the host-only
`.env.divaa`/`.env.local`, which are gitignored. Never bake a password into a
committed file or print one.

## Orchestration (optional)
This section is **optional**. If you skip it, follow the numbered steps below
exactly as before - the generator and `deploy-divaa.sh` are the source of truth
either way, and nothing about the core flow changes.

If **BuddyX** is available (it is normally auto-installed alongside divaa-docker),
you can run `/buddyx` - or just say "orchestrate this setup" - to have BuddyX plan
the onboarding and route sub-tasks to specialists:
- container build / Mutagen sync / Traefik / docker-compose -> **docker-infra**
- env files / deploy script / hosts entries / README -> **skill-author**
- global divaa-docker host settings (IP, ssh user, services) -> the **divaa-docker-config** skill

BuddyX bootstraps any missing agents in the project and gates the result through
its review step. **Graceful fallback:** BuddyX is entirely optional - if it isn't
present, ignore this section and run the deterministic manual steps below.

## Step 1 — Preflight & gather parameters (prompt the user)
Verify: `ssh divaa-docker 'echo ok'` works; the target dir is CodeIgniter 3 —
**`index.php` at the root + `application/` + `system/`** all present. Confirm the
version: `grep "const CI_VERSION" system/core/CodeIgniter.php` should say 3.x
(CI4 has a completely different layout — `public/`, `app/`, `spark` — and is NOT
this skill).

**`composer.json` is OPTIONAL in CI3** — many apps have none. **Detect the PHP
version** from `composer.json`'s `require.php` when it exists; otherwise the
generator defaults to **7.4 and marks it derived**, which the intake gate below
turns into a forced confirmation. A CI3 codebase may genuinely need something
older or newer — old CI3 code on PHP 8.x can throw deprecations and fatals, so
never let 7.4 pass through unconfirmed.

**Check `application/config/config.php`:** note the `encryption_key` and
`base_url`. They're committed config (nothing to generate), but a hardcoded
`base_url` pointing at the old XAMPP vhost is the classic post-migration redirect
bug — flag it. `.env.divaa` ships a `BASE_URL` env var if they want it env-driven.

**Install Mutagen** if missing: `scoop install mutagen` / `winget install Mutagen.Mutagen`.

### The intake gate — REQUIRED, do not skip
Never infer these silently. Resolve them, **show** them, have the user confirm.

**First** run `plan` — it resolves every value (including derived defaults) and
writes nothing:
```bash
node ~/.claude/skills/setup-divaa-docker-ci3/generate.mjs plan --slug <slug> --target .
```
It prints each parameter with its value and whether it was **given** or **derived**,
plus the exact hosts entry that will be needed.

**Then** put those values to the user with **AskUserQuestion** before generating.
Ask in one batch, offering the plan's value as the default option so confirming is
one click — but every one of these must be overridable:

| Param | Default | Why it gets confirmed, not assumed |
|-------|---------|-------------------------------------|
| **primary dev domain** | `<slug>.app.test` | The name they'll actually type in the browser; must be unique on the shared Traefik |
| **MySQL database** | `<prefix>_db` | Lands on the **shared** MySQL; they may already have one, or want a specific name |
| **topology** | ask A/B/C | A = host + Mutagen dev; B = local PC + shared MySQL; C = host + edit-on-host |
| **mode** | ask dev/prod | dev = `CI_ENV=development` overlay (errors shown); prod = `CI_ENV=production`, base only |
| **slug** | dir name, cleaned | Drives the domain and the host dir |
| **prefix** | slug w/o non-alnum | Container/router/Mutagen-session names — **collides on the shared `proxy`** if reused |
| **php** | detected from `composer.json`, else **7.4** | No composer.json = a pure guess; a wrong version fails the build or fatals at runtime — ALWAYS confirm |
| **host-user** | `chintan` | SSH user → host dir `/home/<user>/apps/<projectDir>` |

> **Global host config.** Three of the host facts above — IP (`192.168.1.21`),
> host-user (`chintan`), and apps root (`/home/<user>/apps`) — are sourced from
> the global `~/.divaa-docker/config.json` when it exists (managed by the
> **divaa-docker-config** skill), falling back to the built-in defaults shown here
> otherwise. Explicit generator flags still win over both. `plan` labels each
> value's source, so `config` means it came from that store. (The `proxy` network
> and `app.test` domain suffix live in the config schema too but are still
> hardcoded in the templates — not yet read by the generator.)

Pass the confirmed values as explicit flags in Step 2 — including `--domain` and
`--db` even when they match the default — so the generated files record what was
agreed rather than what happened to be inferred.

## Step 2 — Generate files
```bash
node ~/.claude/skills/setup-divaa-docker-ci3/generate.mjs \
  --slug <slug> --domain <domain> --prefix <prefix> --php <php> --db <db> \
  --topology <a|b|c> --target .
```
Writes the Docker fileset, `.env.divaa`, **`mutagen.yml`**,
**`docker/hosts-divaa.ps1`**, and **`docker/deploy-divaa.sh`** (topology A). It
also **auto-patches**:
- **`.gitignore`** — appends `.env.divaa` (or `.env.local`). Append-only, idempotent.
- **`application/config/database.php`** — rewrites the four `$db['default']`
  connection values (`hostname`/`username`/`password`/`database`) to
  `getenv('DB_*') ?: '<existing literal>'`, but ONLY when all four are plain
  string literals (the stock CI3 shape). Anything else — constants, expressions,
  an already-customised file — it reports under "NEEDS A HAND-MERGE" — read
  `ci3-database-env-block.php` in this skill dir and merge by hand. Read the
  generator's output; don't assume it patched.
- **`index.php` (report-only, never patched)** — if `ENVIRONMENT` is hardcoded
  instead of reading `$_SERVER['CI_ENV']`, that too is reported under "NEEDS A
  HAND-MERGE" with the stock line to restore. The generator will not touch the
  front controller.

`--force` overwrites existing files; `--no-patch` skips the patches and checks.

`mutagen.yml` is meant to be **committed** (it's project config, not a secret).

## Step 3 — Hosts entry (append-only; needs Administrator)
One domain for CI3 — no second dev-server entry. Use the generated script — it is
append-only, idempotent, backs up first, and refuses to guess:
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File docker/hosts-divaa.ps1 -Elevate
# add -Domain mailpit.app.test if you want the mail UI too
# omit -Elevate to preview: it prints the exact lines and changes nothing
```

**Elevation — the honest situation.** `C:\Windows\System32\drivers\etc\hosts` grants
`BUILTIN\Users` only ReadAndExecute; write needs Administrator. **Claude Code does
not normally run elevated**, so a direct append raises
`System.UnauthorizedAccessException` and writes nothing. Behaviour by exit code:

| Exit | Meaning | What you do |
|------|---------|-------------|
| **0** | Nothing to do, or appended **and verified** | Carry on |
| **2** | Not elevated (or UAC declined). **Nothing written.** | Give the user the printed command to paste into an elevated shell. `-Elevate` triggers a UAC prompt they can approve instead. |
| **3** | **Conflict** — the domain already points at a different IP | Do NOT auto-resolve. Show the user; let them decide. |
| **1** | Wrote but verification failed, or backup failed | Stop. Do not claim success. |

Never claim the entry was added on the strength of an exit code alone — the
script re-reads the file to confirm, and so should you. If you get exit 2, say
"this needs admin, here's the command" rather than implying it worked.

**Why it never rewrites the file:** the hosts file is shared with every other
project on the PC (innflow, brahma-inventory, hwrf, optus, precision-*,
spool-tracker…) *and* with unrelated blocks like `0.0.0.0` ad/licence blackholes.
The script only ever appends, and asserts afterwards that the prior content is
still an exact prefix of the new content. Entries go in a marked block so a future
uninstall can find them:
```
# >>> divaa-docker: <slug> >>>
192.168.1.21  <slug>.app.test
# <<< divaa-docker: <slug> <<<
```

> `docker/hosts-divaa.ps1` is **ASCII-only and emitted with a UTF-8 BOM** on
> purpose. Windows PowerShell 5.1 reads a BOM-less `.ps1` as cp1252, where a UTF-8
> em-dash decodes to a smart quote (U+201D) that silently terminates a string and
> produces a cascade of unrelated syntax errors. The generator refuses to emit the
> file if a non-ASCII character creeps in. Don't "tidy" the punctuation.

## Step 4 — Deploy (topology A — the common path)
```bash
node ~/.claude/skills/setup-divaa-docker-ci3/generate.mjs deploy --target . --mode dev
# equivalently, from the project root:  ./docker/deploy-divaa.sh dev
```
Idempotent and gated. It sequences:
1. **Preflight** — ssh, mutagen, config present; **prefix collision check** on the shared daemon.
2. **DB** — checks `information_schema`; only creates after a y/N confirm.
3. **Secrets** — `scp .env.divaa`, inject both passwords via awk's `ENVIRON[]` (no
   escape processing, so `| / & \ $` in a password survive byte-for-byte), `chmod 600`,
   then assert no `__INJECT_ON_HOST__` remains.
4. **Sync** — `mutagen project start`, wait for *Watching for changes*, then **assert
   `index.php` is 0644 on the host** (see the 0600 gotcha below).
5. **Compose up** — base + dev overlay (or base alone for prod).
6. **First-run** — `composer install` **only if `composer.json` exists** (normal
   for CI3 to have none), then `chown www-data` on `application/cache` +
   `application/logs`. No artisan, no key generation, no migrations — CI3 has
   none of that machinery; schema changes are the app's own affair.
7. **Verify** — curls the app domain through Traefik from the host.

**Topology B**: `docker compose -f docker-compose.local.yml up -d --build` on the PC;
fill `DB_PASSWORD` in `.env.local`; no hosts entry, no Mutagen, no deploy script.
**Topology C**: as A but no Mutagen — edit on the host via VS Code Remote-SSH; run
the numbered steps in `docker/README.divaa.md` by hand.

## Mutagen: use the project file, never `sync create`
`mutagen.yml` is the single source of truth for both the ignore list **and** the
`permissions` block. Lifecycle, run from the project root:
```bash
mutagen project start          # create + start the "<prefix>" session
mutagen project terminate      # tear it down (NOT "stop")
mutagen sync list <prefix>     # status; add -l for the full config incl. permissions
```
A `mutagen sync create --ignore ...` session silently loses the permissions block
and every synced file lands 0600. If you ever DO call raw `mutagen sync` from Git
Bash with path-like arguments, prefix it with `MSYS2_ARG_CONV_EXCL='*'` — MSYS
rewrites `/vendor` into a Windows path (`C:/Program Files/Git/vendor`) and the
ignore silently never matches. The project file avoids this entirely; that is one
of the reasons to prefer it.

## Step 5 — Verify (don't claim success without this)
The deploy script does this, but to re-check by hand:
```bash
ssh divaa-docker 'curl -sk --resolve <slug>.app.test:443:127.0.0.1 -o /dev/null -w "%{http_code}\n" https://<slug>.app.test/'
```
Then load `https://<slug>.app.test` in the browser and confirm the app renders.
In dev mode, break something on purpose and confirm you get a CI error page —
if you get a white screen instead, `ENVIRONMENT` is still `production` (see the
gotchas: hardcoded `index.php`, or the container didn't get `CI_ENV`).

## Gotchas (these bit us for real — bake them in)
| Symptom | Cause / fix |
|---------|-------------|
| `include(...): Failed to open stream: **Permission denied**` on every request | **The 0600 gotcha.** Windows alpha has no POSIX modes, so Mutagen's default *Portable* mode writes host files 0600; php-fpm is www-data, not the owner. The `permissions:` block in `mutagen.yml` (0644/0755) fixes it — but only on a session created by `mutagen project start`. Check with `mutagen sync list <prefix> -l`. |
| Dev overlay up but errors are still blank white pages | `ENVIRONMENT` never became `development` — the project's `index.php` hardcodes it instead of reading `$_SERVER['CI_ENV']`. Hand-merge the stock line (see `ci3-database-env-block.php`). |
| `Unable to connect to your database server` | `application/config/database.php` still holds the old literal `localhost` — the generator reported NEEDS A HAND-MERGE and it wasn't done. The shared MySQL is `mysql:3306` via `getenv('DB_HOSTNAME')`. |
| MySQL/Redis `NOAUTH`/auth fail | `.env.divaa` has CRLF — must be **LF**; generator writes LF, keep it |
| App 500s / logs nothing | `application/logs` + `application/cache` not writable — `chown www-data` (the deploy script does) |
| Every URL but `/` is 404 | nginx→CI3 rewrite — the generated `default.conf` uses `try_files ... /index.php?$args`; if the app relied on Apache `.htaccess` extras (custom rewrites), port them by hand |
| Redirects go to the old XAMPP vhost / wrong scheme | Hardcoded `base_url` in `config/config.php` — point it at `https://<slug>.app.test/` or read `getenv('BASE_URL')` |
| Traefik "404 page not found" | Nothing deployed / `web` not on `proxy` — check `docker ps`, labels |
| A `/vendor`-style ignore never matches (raw CLI only) | MSYS path conversion — `MSYS2_ARG_CONV_EXCL='*'`, or just use `mutagen.yml` |
| Wrong PHP / deprecation fatals on every page | No `composer.json` to detect from, so 7.4 was guessed — confirm with the user; old CI3 needs old PHP, patched CI 3.1.13+ runs on 8.x |

## Common mistakes
- Committing `.env.divaa`/`.env.local` (they hold injected secrets) — the generator gitignores them; verify.
- Reusing a `prefix`/`slug` already on the shared `proxy` — router names collide and you break a sibling project.
- Creating the sync with `mutagen sync create` instead of `mutagen project start` — reintroduces the 0600 bug.
- Assuming CI3 reads a `.env` file — it doesn't; there is no dotenv loader. Values reach PHP only as real environment variables via compose `env_file`, and only where config calls `getenv()`.
- Treating this like Laravel: no `artisan`, no migrations, no `key:generate`, no config cache to clear. Don't invent those steps.
- Applying this skill to a CodeIgniter 4 app (`public/`, `app/`, `spark`) — different framework layout, different skill.
