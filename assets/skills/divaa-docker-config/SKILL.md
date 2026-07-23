---
name: divaa-docker-config
description: Use to capture or change the GLOBAL divaa-docker host/server settings that are the same for every project - the host IP, SSH identity, apps root, proxy network, where secrets live, domain suffix - and to register shared services (Redis, MySQL, Mailpit, queue, ...) on demand. Persists them once to a harness-neutral store at ~/.divaa-docker/config.json that the setup-divaa-docker-lv-vite/-webpack generators read as host-fact defaults, so a value confirmed here stops being re-typed per project. Triggers: "set up my divaa-docker host config", "/divaa-docker-config", "change the divaa-docker host IP / ssh user / apps root", "add Redis to divaa-docker", "register a shared service on divaa-docker", "where is my divaa-docker config". NOT for onboarding a single Laravel project onto the host - that is per-project work owned by setup-divaa-docker-lv-vite (Vite) or setup-divaa-docker-lv-webpack (Laravel Mix/webpack); use those to dockerise an app, and this skill only to record the host-wide facts they consume.
---

# divaa-docker-config

## Overview
This skill captures the settings that are the SAME for every project onboarded
onto the shared **divaa-docker** host - its IP, SSH identity, apps root, proxy
network, where secrets live, the dev domain suffix - and persists them ONCE to a
global, harness-neutral store at `~/.divaa-docker/config.json`. The
`setup-divaa-docker-lv-vite` and `setup-divaa-docker-lv-webpack` generators read
that store as their host-fact **defaults**, so a value confirmed here is no
longer re-typed for each project.

It is **progressive**: start with the host facts, then register shared services
(Redis, MySQL, Mailpit, queue, ...) on demand as a project needs them. The
headline use case is exactly that - a project later needs Redis, so you ask the
user how they want it and record it here once.

The single writer is `config.mjs` (zero-dep Node, non-interactive, flag-driven).
You gather answers with **AskUserQuestion**, **show** the resolved values, then
persist them deterministically through `config.mjs` - the same pattern the setup
skills use with `generate.mjs plan`/`generate`.

**This is NOT per-project onboarding.** To dockerise a specific Laravel app, use
`setup-divaa-docker-lv-vite` (Vite) or `setup-divaa-docker-lv-webpack` (Laravel
Mix/webpack). This skill only records the host-wide facts those skills consume.

## The store
Location resolves via `os.homedir()`, so it is correct cross-platform:
- Windows: `C:\Users\<you>\.divaa-docker\config.json`
- POSIX: `/home/<you>/.divaa-docker/config.json`

Run `node config.mjs path` to print the exact resolved path (it creates
nothing). Versioned JSON, LF endings, trailing newline. Schema:

```json
{
  "version": 1,
  "host": {
    "mode": "remote",
    "ip": "192.168.1.21",
    "ssh": { "alias": "divaa-docker", "user": "chintan" },
    "appsRoot": "/home/chintan/apps",
    "proxyNetwork": "proxy",
    "secretsEnv": "~/data/.env",
    "domainSuffix": "app.test"
  },
  "services": {
    "mysql":   { "shared": true, "host": "mysql", "port": 3306 },
    "mailpit": { "host": "mailpit", "httpPort": 8025, "smtpPort": 1025 }
  }
}
```

`host.mode` is `remote` (the shared host over SSH) or `local` (running on the
PC). `services` is progressive - it starts with whatever you register and grows
on demand; the Redis example below is added, not assumed.

## NEVER store secrets
The store holds **pointers, not passwords**. A service records
`"passwordSource": "host-env"` - meaning the real value is injected on the host
from `host.secretsEnv` (e.g. `~/data/.env`), mirroring the existing
`__INJECT_ON_HOST__` ethos in the setup skills.

`config.mjs` **enforces** this: any flag or key whose name ends in
`password`/`secret`/`token` is rejected with a non-zero exit. So
`--password-source host-env` is fine; a raw `--password`, `--secret`, or
`--token` (or `set services.redis.password ...`) is refused. Never try to route a
real credential through this store or print one.

## The intake flow (host facts)
Gather the host facts with **AskUserQuestion**, offering sensible defaults as
one-click options but keeping each overridable. Never infer them silently.

Ask for, in one batch:

| Question | Store path | Notes |
|----------|-----------|-------|
| Local or remote? | `host.mode` | `remote` = shared host over SSH; `local` = on the PC |
| Host IP | `host.ip` | The shared host's LAN IP, e.g. `192.168.1.21` |
| SSH alias | `host.ssh.alias` | The `~/.ssh/config` Host entry, e.g. `divaa-docker` |
| SSH user | `host.ssh.user` | Login user; drives `appsRoot` and the host app dir |
| Apps root | `host.appsRoot` | Where projects live, e.g. `/home/<user>/apps` |
| Proxy network | `host.proxyNetwork` | Shared Docker network, e.g. `proxy` |
| Secrets env file | `host.secretsEnv` | Host path secrets are injected from, e.g. `~/data/.env` |
| Domain suffix | `host.domainSuffix` | Dev domain suffix, e.g. `app.test` |

Then **show** the resolved values back to the user, and only after confirmation
persist them in one deterministic call:

```bash
node config.mjs init \
  --mode remote --ip 192.168.1.21 \
  --ssh-alias divaa-docker --ssh-user chintan \
  --apps-root /home/chintan/apps --proxy proxy \
  --secrets-env ~/data/.env --domain-suffix app.test
```

`init` merges only the flags you pass, so `init --ip 192.168.1.22` updates the IP
and leaves everything else intact. Flag -> path mapping (verified against
`config.mjs`):

| Flag | Store path |
|------|-----------|
| `--mode` | `host.mode` |
| `--ip` | `host.ip` |
| `--ssh-alias` | `host.ssh.alias` |
| `--ssh-user` | `host.ssh.user` |
| `--apps-root` | `host.appsRoot` |
| `--proxy` | `host.proxyNetwork` |
| `--secrets-env` | `host.secretsEnv` |
| `--domain-suffix` | `host.domainSuffix` |

`init` rejects any unrecognised flag (a likely typo or a smuggled secret). To
change a single deep value outside `init`'s flag set, use
`set <dotpath> <value>` (e.g. `set host.ssh.user chintan`).

## Progressive service intake (the headline use case)
When a project later needs a shared service - Redis is the common one - ask the
user how they want it set up with **AskUserQuestion**, **show** the resolved
shape, then register it. Good questions to ask:

- **shared vs dedicated** - one shared instance for all projects, or a dedicated
  one? (record as `--mode shared` / `--mode dedicated`)
- **host** - the service's container/DNS name on the proxy network (e.g. `redis`)
- **port** - e.g. `6379`
- **DB index** - which logical database (e.g. `0`)
- **password source** - a POINTER only, e.g. `host-env` (never a real password)

### Redis worked example
```bash
node config.mjs add-service redis \
  --mode shared --host redis --port 6379 \
  --database 0 --password-source host-env
```

Result (merged under `services.redis`):
```json
"redis": {
  "mode": "shared",
  "host": "redis",
  "port": 6379,
  "database": 0,
  "passwordSource": "host-env"
}
```

`add-service` deep-merges, so re-running it to change one field (e.g.
`add-service redis --database 1`) keeps the other fields. Flags are kebab-case on
the CLI and stored camelCase (`--password-source` -> `passwordSource`); values are
coerced to their natural JSON type (`6379` -> number, `true`/`false` -> boolean).

The **same pattern** covers any shared service - `mysql`, `mailpit`, `queue`,
etc.:
```bash
node config.mjs add-service mysql   --shared true --host mysql --port 3306
node config.mjs add-service mailpit --host mailpit --http-port 8025 --smtp-port 1025
```
Drop one with `node config.mjs remove-service <name>`.

## How the setup skills consume this
The `setup-divaa-docker-lv-vite`/`-webpack` generators resolve each host fact by
this precedence:

```
explicit CLI flag  >  global config (~/.divaa-docker/config.json)  >  hardcoded fallback
```

So an explicit `--ip`/`--host-user`/etc. on the generator always wins; otherwise
the global config supplies the default; otherwise the generator's built-in
fallback (e.g. `192.168.1.21`, `chintan`) applies. **With no config file the
behavior is byte-identical to before - fully backward compatible.** The
generator's `plan` output labels a value's source, so `config` means it came from
this store.

To inspect what the generators will read:
```bash
node config.mjs show                 # whole store as pretty JSON
node config.mjs get host.ip          # one value (scalars raw, objects as JSON)
node config.mjs get host.ssh.user
node config.mjs path                 # locate the file
```

## Commands reference (verified against config.mjs)
| Command | Purpose |
|---------|---------|
| `path` | Print the absolute store path; creates nothing |
| `show` | Print the whole store as pretty JSON (an absent store reads as `{"version":1}`; nothing is written) |
| `get <dotpath>` | Read one value by dot-path; missing path = stderr note + non-zero exit |
| `set <dotpath> <value>` | Write one value by dot-path; deep-merges, never clobbers siblings; refuses a secret key |
| `init [--mode --ip --ssh-alias --ssh-user --apps-root --proxy --secrets-env --domain-suffix]` | Merge the host.* facts from the named flags |
| `add-service <name> [--k v ...]` | Merge a service under `services.<name>`; use `--password-source`, never `--password` |
| `remove-service <name>` | Drop `services.<name>` |

Run `node config.mjs` with no command (or `--help`) for the built-in usage.
Value coercion applies to `set` and every flag: `true`/`false` -> boolean, a bare
integer -> number, JSON-looking text -> parsed, everything else -> string (force a
string by quoting the JSON, e.g. `'"6379"'`).

## Common mistakes
- Routing a real password/secret/token through the store - it is rejected by
  design; store only a `--password-source` pointer.
- Using this skill to onboard a single project - that is
  `setup-divaa-docker-lv-vite` / `-webpack`; this skill only records host-wide
  facts.
- Editing `~/.divaa-docker/config.json` by hand and corrupting it - `config.mjs`
  refuses to overwrite an unparseable file rather than destroy state. Fix or
  remove it, then re-run.
- Assuming a service exists - `services` is progressive; register it with
  `add-service` before a generator can read it.
