---
name: setup-divaa-docker-lv-webpack
description: Use when onboarding a Laravel + Laravel Mix/webpack project (Vue 2 era) onto the shared "divaa-docker" homelab host, or moving one off WAMP/Herd onto it. Sets up the node-16 webpack-dev-server HMR container behind Traefik, Mutagen file-sync with the 0644/0755 permissions block, and a gated one-command deploy. Triggers: "set up this webpack project on divaa-docker", "/setup-divaa-docker-lv-webpack", "dockerise this Laravel Mix app on the shared host". For a Vite project use setup-divaa-docker-lv-vite instead.
---

# setup-divaa-docker-lv-webpack

## Overview
Onboards a Laravel + **Laravel Mix / webpack** project onto the shared **divaa-docker**
host. A deterministic generator (`generate.mjs`) stamps the Docker/Mutagen fileset from
templates; a generated, gated `docker/deploy-divaa.sh` then sequences the host work
(DB → secrets → sync → compose → first-run → verify).

**REQUIRED BACKGROUND:** Use the **divaa-infra** skill — it holds the host facts
(IP `192.168.1.21`, `ssh divaa-docker`, the `proxy` network, Mailpit, and where
secrets live: `~/data/.env` on the host). This skill never embeds credentials.

## Am I the right skill?
Check the project **before** doing anything:

| Project has | Use |
|-------------|-----|
| `webpack.mix.js` + `laravel-mix` in package.json | **this skill** |
| `vite.config.*` + `vite` in package.json | **`setup-divaa-docker-lv-vite`** — stop, switch |
| Both | Ask the user which one actually builds the app |

They are not renames of each other. The dev server, node version, port, HMR wiring,
`/public` sync policy, and health probe all differ — see "Webpack vs Vite" below.

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
Verify: `ssh divaa-docker 'echo ok'` works; the target dir is Laravel (`artisan` +
`composer.json`); it is a Mix project (see "Am I the right skill?").

**Detect the PHP version** from `composer.lock` — don't assume. **Detect the node
version** from the `laravel-mix` major; the generator does this for you, but confirm
it (a wrong node tag = a container that crash-loops, see gotchas).

**Check `.env`:** it is synced to the host and should hold a non-empty `APP_KEY`
(and `JWT_SECRET` if `php-open-source-saver/jwt-auth` is a dependency). The deploy
script generates them in-container if absent — but a surprise `key:generate`
invalidates existing encrypted data, so flag it rather than letting it happen.

**Install Mutagen** if missing: `scoop install mutagen` / `winget install Mutagen.Mutagen`.

**Run `plan` first** — it resolves every default and writes nothing:
```bash
node ~/.claude/skills/setup-divaa-docker-lv-webpack/generate.mjs plan --slug <slug> --target .
```
It marks each value `given` / `detected` / `FALLBACK ... CONFIRM`. Anything that says
FALLBACK is a guess — confirm it before writing.

| Param | Default | Why it gets confirmed, not assumed |
|-------|---------|-------------------------------------|
| **primary dev domain** | `<slug>.app.test` | The name they'll type; must be unique on the shared Traefik |
| **hot domain** | `<slug>-hot.app.test` | Second hosts entry — a wrong one = blank SPA |
| **MySQL database** | `<prefix>_db` | Lands on the **shared** MySQL; they may already have one |
| **topology** | ask A/B/C | A = host + Mutagen dev; B = local PC + shared MySQL; C = host + edit-on-host |
| **mode** | ask dev/prod | dev = webpack HMR overlay; prod = built assets, base only |
| **slug** | dir name, cleaned | Drives both domains and the host dir |
| **prefix** | slug w/o non-alnum | Container/router/Mutagen-session names — **collides on the shared `proxy`** if reused |
| **php** | detected from `composer.lock` | A wrong guess fails the build |
| **node** | detected from `laravel-mix` major | Mix 5 ⇒ `16-bullseye`. Wrong = instant crash-loop |
| **hot-port** | `443` | Traefik's TLS port — the dev server listens on it directly. Not a 5xxx port |
| **hot-probe** | detected from `mix.js()` output | The asset the deploy script curls to prove HMR is alive |
| **host-user** | `chintan` | SSH user → host dir `/home/<user>/apps/<projectDir>` |

> **Global host config.** Three of the host facts above — IP (`192.168.1.21`),
> host-user (`chintan`), and apps root (`/home/<user>/apps`) — are now sourced from
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
node ~/.claude/skills/setup-divaa-docker-lv-webpack/generate.mjs \
  --slug <slug> --domain <domain> --prefix <prefix> --php <php> --db <db> \
  --topology <a|b|c> --target .
```
Writes the Docker fileset, `.env.divaa`, **`mutagen.yml`**, **`docker/hosts-divaa.ps1`**,
and **`docker/deploy-divaa.sh`** (topology A). It also **auto-patches**:
- **`.gitignore`** — appends `.env.divaa` (or `.env.local`). Append-only, idempotent.
- **`webpack.mix.js`** — inserts the env-gated `MIX_HMR` block above the first
  `mix.js()` call. Skipped (reported under "NEEDS A HAND-MERGE") if the config
  already sets `devServer`/`hmrOptions` — then read `mix-hmr-block.js` in this skill
  dir and merge by hand. Read the generator's output; don't assume it patched.

The block is inert without `MIX_HMR_HOST`, so a patched config behaves **exactly as
before** on the PC (`npm run hot`/`watch` keep their localhost:8080 defaults).

`--force` overwrites existing files; `--no-patch` skips both patches.
`mutagen.yml` is meant to be **committed** (project config, not a secret).

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
project on the PC *and* with unrelated blocks like `0.0.0.0` ad/licence blackholes.
The script only ever appends, and asserts afterwards that the prior content is
still an exact prefix of the new content.

> `docker/hosts-divaa.ps1` is **ASCII-only and emitted with a UTF-8 BOM** on purpose.
> Windows PowerShell 5.1 reads a BOM-less `.ps1` as cp1252, where a UTF-8 em-dash
> decodes to a smart quote (U+201D) that silently terminates a string and produces a
> cascade of unrelated syntax errors. The generator refuses to emit the file if a
> non-ASCII character creeps in. Don't "tidy" the punctuation.

## Step 4 — Deploy (topology A — the common path)
```bash
node ~/.claude/skills/setup-divaa-docker-lv-webpack/generate.mjs deploy --target . --mode dev
# equivalently, from the project root:  ./docker/deploy-divaa.sh dev
```
Idempotent and gated. It sequences:
1. **Preflight** — ssh, mutagen, config, read-only hosts check; **prefix collision check**.
2. **DB** — checks `information_schema`; only creates after a y/N confirm.
3. **Secrets** — `scp .env.divaa`, inject both passwords via awk's `ENVIRON[]` (no
   escape processing, so `| / & \ $` in a password survive byte-for-byte), `chmod 600`,
   then assert no `__INJECT_ON_HOST__` remains.
4. **Sync** — `mutagen project start`, wait for *Watching for changes*, then **assert
   `artisan` is 0644 on the host** (see the 0600 gotcha below).
5. **Prod-only asset checks** — remove a stale `public/hot` (gated), warn if
   `public/mix-manifest.json` is missing. Both are Mix-specific; see "Who builds".
6. **Compose up** — base + dev overlay (or base alone for prod).
7. **First-run** — `composer install`, `chown www-data`, conditional `key:generate` /
   `jwt:secret`, `config:clear` (dev) or `config:cache` (prod), `migrate`.
8. **Verify** — curls the app, curls the hot probe, confirms `public/hot` exists.

**Topology B**: `docker compose -f docker-compose.local.yml up -d --build` on the PC;
fill `DB_PASSWORD` in `.env.local`; no hosts entry, no Mutagen, no deploy script. The
dev server uses `--hot-port-local` (8081) — the page is plain http, so 443/TLS is not
involved. **Topology C**: as A but no Mutagen — edit on the host via VS Code
Remote-SSH; run the numbered steps in `docker/README.divaa.md` by hand.

## Who builds the assets? (the thing people get wrong)
This differs between dev and prod, and the failure mode is a **blank page with no
server error**, so be explicit with the user about which mode they're in:

| | dev overlay | prod (base only) |
|---|---|---|
| Builder | `<prefix>-hot` on the **host** | the user, on the **PC** (`npm run prod`) |
| Bundle served from | webpack-dev-server **memory** | `public/` **on disk**, via nginx |
| `public/hot` | present (written by the hot container) | **must be absent** |
| `npm run watch` on the PC | **no** — the container is the builder | n/a (`npm run prod` once) |

`/public` is deliberately **synced** by Mutagen — unlike the Vite skill, which ignores
`/public/build`. Mix compiles to `/public/adminapp`, which is gitignored but must
reach the host, because in prod **nothing on the host builds it**. `/public/hot` is
the one exception: ignored, because the hot container writes it on the host.

## Mutagen: use the project file, never `sync create`
`mutagen.yml` is the single source of truth for both the ignore list **and** the
`permissions` block. Lifecycle, from the project root:
```bash
mutagen project start          # create + start the "<prefix>" session
mutagen project stop           # tear it down
mutagen sync list <prefix>     # status; add -l for the full config incl. permissions
```
A `mutagen sync create --ignore ...` session silently loses the permissions block and
every synced file lands 0600. If you ever DO call raw `mutagen sync` from Git Bash
with path-like arguments, prefix it with `MSYS2_ARG_CONV_EXCL='*'` — MSYS rewrites
`/vendor` into a Windows path and the ignore silently never matches.

Mode is **`two-way-resolved`** (alpha/PC wins) here, vs `two-way-safe` in the Vite
skill. Deliberate: a Mix project syncs its compiled bundle, so the host routinely
holds build output older than the PC's, and under `two-way-safe` every stale asset
becomes a conflict to clear by hand.

## Step 5 — Verify (don't claim success without this)
The deploy script does this, but to re-check by hand:
```bash
ssh divaa-docker 'curl -sk --resolve <slug>.app.test:443:127.0.0.1 -o /dev/null -w "%{http_code}\n" https://<slug>.app.test/'
ssh divaa-docker 'curl -sk --resolve <slug>-hot.app.test:443:127.0.0.1 -o /dev/null -w "%{http_code}\n" https://<slug>-hot.app.test/adminapp/js/app.js'
ssh divaa-docker 'docker logs --tail 5 <prefix>-hot'   # want: "DONE  Compiled successfully"
```
There is **no generic webpack-dev-server health route** — `/webpack-dev-server`
answers 502 through Traefik on this stack. Probe a real emitted asset (the
`--hot-probe` path). Then load `https://<slug>.app.test` and confirm the SPA mounts.

## Webpack vs Vite — what actually differs
Read this before porting anything between the two skills.

| | `-lv-vite` | `-lv-webpack` (this) |
|---|---|---|
| Container | `<prefix>-vite`, `node:22-bookworm-slim` | `<prefix>-hot`, `node:16-bullseye` |
| Command | `npm run dev -- --host 0.0.0.0` | `npm run hot` |
| Domain / LB port | `<slug>-vite.app.test` / 5281 | `<slug>-hot.app.test` / **443** |
| Config block | `vite.config` `server` block | `webpack.mix.js` `MIX_HMR` block |
| Marker → asset URLs | `public/hot` read by `@vite` | `public/hot` read by `mix()` |
| Health probe | `/@vite/client` | an emitted asset (`--hot-probe`) |
| Mutagen mode | `two-way-safe` | `two-way-resolved` |
| `/public` | ignored (`/public/build`) | **synced** (bundle is gitignored) |
| Polling escape hatch | `VITE_USE_POLLING=1` | none — webpack watches natively |

## Gotchas (these bit us for real — bake them in)
| Symptom | Cause / fix |
|---------|-------------|
| `<prefix>-hot` crash-loops; logs show `error:0308010C:digital envelope routines::unsupported` (`ERR_OSSL_EVP_UNSUPPORTED`) | **Node too new for the Mix major.** Mix 5 pins webpack 4, which hashes with a MD4 digest OpenSSL 3 (node ≥ 17) removed. Use `node:16-*`; the generator detects this — don't override it upward. |
| `include(...): Failed to open stream: **Permission denied**` on every request | **The 0600 gotcha.** Windows alpha has no POSIX modes, so Mutagen's default *Portable* mode writes host files 0600; php-fpm is www-data, not the owner. The `permissions:` block in `mutagen.yml` (0644/0755) fixes it — but only on a session created by `mutagen project start`. Check with `mutagen sync list <prefix> -l`. |
| `public/hot` contains `http://<host>:443/` and it looks wrong | **It's correct.** Laravel's `mix()` strips the scheme and returns a protocol-relative URL, so the HTTPS page loads assets over HTTPS. Don't "fix" the scheme. |
| App works, but lazy-loaded routes die with `ChunkLoadError` | `output.publicPath` isn't protocol-relative, so the webpack runtime requests async chunks over `http://` and the browser blocks them as mixed content. Only shows up on navigation, so it survives a smoke test. See `mix-hmr-block.js`. |
| Dev server 500s / "Invalid Host header" | webpack-dev-server 3 rejects Traefik's forwarded Host — needs `disableHostCheck: true`. That is **wds 3** syntax (what Mix 5 pins); on Mix 6+ it's `allowedHosts`. |
| Prod deploy: page loads with **no JS/CSS and no error** | A stale `public/hot` on the host from a previous dev deploy — `mix()` keeps pointing at a dead dev server. It's Mutagen-ignored, so deleting it on the PC does nothing: `rm -f public/hot` **on the host**. `deploy-divaa.sh prod` gates this for you. |
| Prod deploy: every asset 404s | Nothing on the host builds in prod. `npm run prod` on the PC (correct node!) and let Mutagen carry `public/` up. |
| Dev overlay up but the app still acts like production (no debug page) | Cached **prod config** — `bootstrap/cache/config.php` wins over env. `php artisan config:clear`. |
| Blank SPA in dev (shell loads, no mount) | Missing the **`<slug>-hot.app.test`** hosts entry — add BOTH domains |
| Traefik "404 page not found" | Nothing deployed / `web` not on `proxy` — check `docker ps`, labels |
| MySQL/Redis `NOAUTH`/auth fail | `.env.divaa` has CRLF — must be **LF**; generator writes LF, keep it |
| App 500s on first load | `storage`/`bootstrap/cache` not writable — `chown www-data` |
| Mutagen conflict every sync | `package-lock.json` — excluded in `mutagen.yml` (the container's npm rewrites it) |
| First boot: "my change didn't apply" | `<prefix>-hot` is still running `npm install` (minutes). `docker logs -f <prefix>-hot`. |

## Common mistakes
- Using this skill on a **Vite** project (or vice versa) — check `webpack.mix.js` vs `vite.config.*` first.
- Committing `.env.divaa`/`.env.local` (they hold injected secrets) — the generator gitignores them; verify.
- Reusing a `prefix`/`slug` already on the shared `proxy` — router names collide and you break a sibling project.
- Creating the sync with `mutagen sync create` instead of `mutagen project start` — reintroduces the 0600 bug.
- Bumping the hot container to a newer node "to modernise" — it crash-loops until Mix is upgraded too.
- Running `npm run watch` on the PC in dev mode — the hot container is the builder; you'd just fight it.
- Forgetting `rm -f public/hot` **on the host** when switching a dev deploy back to production.
