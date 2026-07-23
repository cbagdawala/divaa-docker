---
name: setup-divaa-docker-lv-vite
description: Use when onboarding a Laravel (+ Vite/Vue) project onto the shared "divaa-docker" homelab host, or moving a Laravel app off Herd/Valet onto it. Sets up Mutagen file-sync with the 0644/0755 permissions block, the Traefik HTTPS routes, and a gated one-command deploy. Triggers: "set up this project on divaa-docker", "/setup-divaa-docker-lv-vite", "dockerise this Laravel app on the shared host".
---

# setup-divaa-docker-lv-vite

## Overview
Onboards a Laravel + Vite project onto the shared **divaa-docker** host. A
deterministic generator (`generate.mjs`) stamps the Docker/Mutagen fileset from
templates; a generated, gated `docker/deploy-divaa.sh` then sequences the host
work (DB → secrets → sync → compose → first-run → verify).

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

## Step 1 — Preflight & gather parameters (prompt the user)
Verify: `ssh divaa-docker 'echo ok'` works; the target dir is Laravel (`artisan`
+ `composer.json`); note whether it has a Vite frontend (`package.json` + a
`vite.config.*`). **Detect the PHP version** from `composer.lock` — grep the
`symfony/console` platform requirement; Symfony 8 needs PHP ≥ 8.4. Don't assume 8.3.

**Check `.env`:** the app's `.env` is synced to the host and should hold a
non-empty `APP_KEY` (and `JWT_SECRET` if `php-open-source-saver/jwt-auth` is a
dependency). The deploy script generates them in-container if absent, so this is
informational — but a surprise `key:generate` invalidates existing encrypted data,
so flag it to the user rather than letting it happen silently.

**Install Mutagen** if missing: `scoop install mutagen` / `winget install Mutagen.Mutagen`.

### The intake gate — REQUIRED, do not skip
Never infer these silently. Resolve them, **show** them, have the user confirm.

**First** run `plan` — it resolves every value (including derived defaults) and
writes nothing:
```bash
node ~/.claude/skills/setup-divaa-docker-lv-vite/generate.mjs plan --slug <slug> --target .
```
It prints each parameter with its value and whether it was **given** or **derived**,
plus the exact hosts entries that will be needed.

**Then** put those values to the user with **AskUserQuestion** before generating.
Ask in one batch, offering the plan's value as the default option so confirming is
one click — but every one of these must be overridable:

| Param | Default | Why it gets confirmed, not assumed |
|-------|---------|-------------------------------------|
| **primary dev domain** | `<slug>.app.test` | The name they'll actually type in the browser; must be unique on the shared Traefik |
| **vite domain** | `<slug>-vite.app.test` | Second hosts entry — a wrong one = blank SPA |
| **MySQL database** | `<prefix>_db` | Lands on the **shared** MySQL; they may already have one, or want a specific name |
| **topology** | ask A/B/C | A = host + Mutagen dev; B = local PC + shared MySQL; C = host + edit-on-host |
| **mode** | ask dev/prod | dev = Vite HMR overlay; prod = built assets, base only |
| **slug** | dir name, cleaned | Drives both domains and the host dir |
| **prefix** | slug w/o non-alnum | Container/router/Mutagen-session names — **collides on the shared `proxy`** if reused |
| **php** | detected from `composer.lock` | A wrong guess fails the build — detect, then confirm |
| **vite-port** | `5281` | House convention, NOT Vite's 5173 default |
| **host-user** | `chintan` | SSH user → host dir `/home/<user>/apps/<projectDir>` |

Pass the confirmed values as explicit flags in Step 2 — including `--domain` and
`--db` even when they match the default — so the generated files record what was
agreed rather than what happened to be inferred.

## Step 2 — Generate files
```bash
node ~/.claude/skills/setup-divaa-docker-lv-vite/generate.mjs \
  --slug <slug> --domain <domain> --prefix <prefix> --php <php> --db <db> \
  --topology <a|b|c> --target .
```
Writes the Docker fileset, `.env.divaa`, **`mutagen.yml`**,
**`docker/hosts-divaa.ps1`**, and **`docker/deploy-divaa.sh`** (topology A). It
also **auto-patches**:
- **`.gitignore`** — appends `.env.divaa` (or `.env.local`). Append-only, idempotent.
- **`vite.config.*`** — injects the env-gated `server` block, but ONLY for a plain
  `defineConfig({...})` with no existing `server:` key. Anything else it reports
  under "NEEDS A HAND-MERGE" — read `vite-server-block.js` in this skill dir and
  merge by hand (notably: merge `usePolling` INTO an existing `server.watch`,
  don't replace it). Read the generator's output; don't assume it patched.

`--force` overwrites existing files; `--no-patch` skips both patches.

`mutagen.yml` is meant to be **committed** (it's project config, not a secret).

## Step 3 — Hosts entries (append-only; needs Administrator)
**BOTH domains**, or the SPA loads blank in dev. Use the generated script — it is
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
| **3** | **Conflict** — a domain already points at a different IP | Do NOT auto-resolve. Show the user; let them decide. |
| **1** | Wrote but verification failed, or backup failed | Stop. Do not claim success. |

Never claim the entries were added on the strength of an exit code alone — the
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
192.168.1.21  <slug>-vite.app.test
# <<< divaa-docker: <slug> <<<
```

> `docker/hosts-divaa.ps1` is **ASCII-only and emitted with a UTF-8 BOM** on
> purpose. Windows PowerShell 5.1 reads a BOM-less `.ps1` as cp1252, where a UTF-8
> em-dash decodes to a smart quote (U+201D) that silently terminates a string and
> produces a cascade of unrelated syntax errors. The generator refuses to emit the
> file if a non-ASCII character creeps in. Don't "tidy" the punctuation.

## Step 4 — Deploy (topology A — the common path)
```bash
node ~/.claude/skills/setup-divaa-docker-lv-vite/generate.mjs deploy --target . --mode dev
# equivalently, from the project root:  ./docker/deploy-divaa.sh dev
```
Idempotent and gated. It sequences:
1. **Preflight** — ssh, mutagen, config present; **prefix collision check** on the shared daemon.
2. **DB** — checks `information_schema`; only creates after a y/N confirm.
3. **Secrets** — `scp .env.divaa`, inject both passwords via awk's `ENVIRON[]` (no
   escape processing, so `| / & \ $` in a password survive byte-for-byte), `chmod 600`,
   then assert no `__INJECT_ON_HOST__` remains.
4. **Sync** — `mutagen project start`, wait for *Watching for changes*, then **assert
   `artisan` is 0644 on the host** (see the 0600 gotcha below).
5. **Compose up** — base + dev overlay (or base alone for prod).
6. **First-run** — `composer install`, `chown www-data`, conditional `key:generate` /
   `jwt:secret`, `config:clear` (dev) or `config:cache` (prod), `migrate`.
7. **Verify** — curls both domains through Traefik from the host.

**Topology B**: `docker compose -f docker-compose.local.yml up -d --build` on the PC;
fill `DB_PASSWORD` in `.env.local`; no hosts entry, no Mutagen, no deploy script.
**Topology C**: as A but no Mutagen — edit on the host via VS Code Remote-SSH; run
the numbered steps in `docker/README.divaa.md` by hand.

## Mutagen: use the project file, never `sync create`
`mutagen.yml` is the single source of truth for both the ignore list **and** the
`permissions` block. Lifecycle, run from the project root:
```bash
mutagen project start          # create + start the "<prefix>" session
mutagen project stop           # tear it down
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
ssh divaa-docker 'curl -sk --resolve <slug>-vite.app.test:443:127.0.0.1 -o /dev/null -w "%{http_code}\n" https://<slug>-vite.app.test/@vite/client'
```
Then load `https://<slug>.app.test` in the browser and confirm the SPA mounts (not
a blank page). If blank, check the browser can resolve the **vite** domain.

## Gotchas (these bit us for real — bake them in)
| Symptom | Cause / fix |
|---------|-------------|
| `include(...): Failed to open stream: **Permission denied**` on every request | **The 0600 gotcha.** Windows alpha has no POSIX modes, so Mutagen's default *Portable* mode writes host files 0600; php-fpm is www-data, not the owner. The `permissions:` block in `mutagen.yml` (0644/0755) fixes it — but only on a session created by `mutagen project start`. Check with `mutagen sync list <prefix> -l`. |
| Dev overlay up but the app still acts like production (no debug page) | Cached **prod config** — `bootstrap/cache/config.php` wins over env. `php artisan config:clear`. |
| Blank SPA in dev (shell loads, no mount) | Missing the **`<slug>-vite.app.test`** hosts entry — add BOTH domains |
| HMR dead — edits reach the host but no reload | inotify events from the bind mount don't reach the container. Set `VITE_USE_POLLING=1` in the dev overlay. |
| Traefik "404 page not found" | Nothing deployed / `web` not on `proxy` — check `docker ps`, labels |
| MySQL/Redis `NOAUTH`/auth fail | `.env.divaa` has CRLF — must be **LF**; generator writes LF, keep it |
| App 500s on first load | `storage`/`bootstrap/cache` not writable — `chown www-data` |
| Mutagen conflict every sync | `package-lock.json` — excluded in `mutagen.yml` (the container's npm rewrites it) |
| A `/vendor`-style ignore never matches (raw CLI only) | MSYS path conversion — `MSYS2_ARG_CONV_EXCL='*'`, or just use `mutagen.yml` |
| Wrong PHP / build fails | PHP < required — detect from `composer.lock`, don't assume 8.3 |

## Common mistakes
- Committing `.env.divaa`/`.env.local` (they hold injected secrets) — the generator gitignores them; verify.
- Reusing a `prefix`/`slug` already on the shared `proxy` — router names collide and you break a sibling project.
- Creating the sync with `mutagen sync create` instead of `mutagen project start` — reintroduces the 0600 bug.
- Forgetting `rm -f public/hot` when switching a dev deploy back to production.
- Running `npm run build` in dev mode — the Vite dev server is authoritative.
