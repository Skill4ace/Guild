# Guild

Guild is a web studio for designing and running governed multi-agent workflows.

## What You Build

- `Board`: define agents, connect channels, and set step order.
- `Vault`: upload context files and mount them to agents/channels/runs.
- `Runs`: compile board -> execute turns -> replay timeline -> inspect final output.
- `Templates`: launch Debate, Org, Game, or Build scaffold quickly.

## Quick Start

1. Install dependencies and env file:

```bash
npm install
cp .env.example .env.local
```

2. Start Postgres and apply schema:

```bash
npm run db:up
npm run db:migrate:deploy
npm run db:seed
```

3. Start the app:

```bash
npm run dev
```

4. Open:

- `http://localhost:3000/login`
- sign in
- create a workspace
- open Board/Vault/Runs/Templates from the workspace shell

## Core Workflow

1. Board
- set one mission
- add agents with role + task
- connect channels and set message types
- set channel step order for execution sequence

2. Vault (optional)
- upload files
- create mounts so only relevant agents/channels/runs can read context

3. Runs
- create a draft run
- execute scheduler
- use Timeline Replay to inspect each turn
- read Final Output (prefers final `decision` turn when present)

4. Templates
- launch a template to replace board scaffold and create a ready draft run

## Required Env Vars

- `DATABASE_URL`: Postgres connection string
- `GEMINI_API_KEY`: Gemini API key for live model calls

Optional:

- `GEMINI_MODEL_FLASH` (default: `gemini-3-flash-preview`)
- `GEMINI_MODEL_PRO` (default: `gemini-3-pro-preview`)
- `GEMINI_FLASH_ONLY` (`true`/`false`)
- `VAULT_STORAGE_DIR` (default local storage path for Vault files)

## Useful Scripts

```bash
npm run db:up
npm run db:down
npm run db:logs
npm run db:migrate:deploy
npm run db:seed
npm run test
npm run lint
npm run build
```

## Troubleshooting

- `unknown shorthand flag: 'd' in -d`
  - Docker Compose is not available yet. Install/launch Docker Desktop, then re-run `npm run db:up`.

- `P1001: Can't reach database server`
  - Postgres is not running. Run `npm run db:up`, then check `npm run db:logs`.

- Next.js lock error (`.next/dev/lock`)
  - Another dev server is running. Stop it and restart `npm run dev`.
