# divaa-docker (`divaa-docker`)

A small npm CLI that installs the **divaa-docker Agent Skills** into your AI coding
assistant. Each skill teaches the assistant to onboard a **Laravel** app onto the shared
**divaa-docker** homelab host in one command — generating the Docker/nginx/PHP stack,
Mutagen file-sync with the correct `0644/0755` permissions block, the Traefik HTTPS routes,
and a gated one-command deploy.

Two skills ship today, one per front-end build tool:

| Skill | For |
|---|---|
| `setup-divaa-docker-lv-vite` | Laravel + **Vite/Vue** projects (Herd/Valet → divaa-docker) |
| `setup-divaa-docker-lv-webpack` | Laravel + **Laravel Mix/webpack** (Vue 2 era, node-16 HMR) |

Install method mirrors [`buddyx`](https://github.com/cbagdawala/buddyx): a small CLI
(`divaa-docker`) copies the bundled skill folders into each assistant's skills directory.
More skills will be added over time — the CLI discovers whatever is bundled, so new skills
need no code change.

## Install

```bash
npm install -g divaa-docker
```

Then add the skills to your assistant (run inside a project for project scope, or add
`--global` for all projects):

```bash
divaa-docker init --ai claude                                    # both skills → .claude/skills/
divaa-docker init --ai claude --skill setup-divaa-docker-lv-vite # just the Vite skill
divaa-docker init --ai opencode                                  # → .opencode/skills/
divaa-docker init --ai claude --global                           # → ~/.claude/skills/ (all projects)
divaa-docker init --ai all                                       # every supported assistant
divaa-docker init                                                # auto-detect + interactive picker
```

Or without a global install:

```bash
npx divaa-docker init --ai claude
```

Restart the assistant, then invoke it by typing `/setup-divaa-docker-lv-vite` (or
`/setup-divaa-docker-lv-webpack`), or just asking — e.g. *"set up this Laravel project on
divaa-docker"*. Each skill's `description` also lets the model trigger it automatically on
matching requests.

## Supported assistants

`claude` (Claude Code) · `opencode` · `cursor` · `windsurf` · `codex` · `gemini` ·
`antigravity` · `factory` (Factory Droid) — or `all`.

Each install is self-contained: `SKILL.md` plus its `templates/` and generator scripts are
copied into `<assistant-dir>/skills/<skill-name>/`.

## What the skills do

Given a Laravel project, the skill walks the assistant through onboarding it onto the shared
divaa-docker host:

- **Docker stack** — PHP-FPM + nginx containers from the bundled `Dockerfile` / `default.conf`
  / `php.ini` templates, plus `docker-compose` files for local and divaa environments.
- **Front-end HMR** — the Vite dev-server block (Vite skill) or the node-16
  webpack-dev-server HMR container (webpack skill), wired behind Traefik.
- **Mutagen file-sync** — `mutagen.yml` with the `0644/0755` permissions block so file
  modes stay correct across the sync.
- **Traefik HTTPS routes** — labels/host rules for the shared reverse proxy, plus a
  `hosts-divaa.ps1` helper for local host entries.
- **Gated deploy** — a `deploy-divaa.sh` one-command deploy behind a confirmation gate.

## Commands (in the assistant)

Invoke a skill and it drives the onboarding end-to-end. See each skill's `SKILL.md` for the
full step-by-step workflow.

## Update

```bash
npm install -g divaa-docker@latest
divaa-docker update --ai claude       # re-copy the latest bundled skills over existing installs
```

## Uninstall

```bash
divaa-docker uninstall --ai claude
divaa-docker uninstall --global
divaa-docker uninstall                # detect installs in the current project and confirm
```

## CLI reference

| Command | Description |
|---|---|
| `divaa-docker init [--ai <type>] [--skill <names>] [--global] [--force]` | Install the skill(s) |
| `divaa-docker update [--ai <type>] [--skill <names>] [--global]` | Re-copy the bundled skill(s) over an existing install |
| `divaa-docker uninstall [--ai <type>] [--skill <names>] [--global]` | Remove the skill(s) |
| `divaa-docker skills` | List the skills bundled in this CLI |
| `divaa-docker versions` | Print the CLI version |

`--skill` accepts a comma-separated list; omit it to act on every bundled skill.

## License

MIT © Chintan Bagdawala
