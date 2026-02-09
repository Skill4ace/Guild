# Guild

Guild is a web studio for building governed multi-agent workflows.
Instead of one long prompt, you define agents, channels, rules, and run execution with replay.

## Use Cases

- Product decisions: run side-vs-side arguments and finalize a governed ship/no-ship call.
- Incident response: coordinate triage, risk analysis, and release decisions across role tiers.
- Marketing strategy: route campaign planning across specialist agents and synthesize final output.
- Research and policy review: combine multiple agent positions, critiques, and evidence into one draft.

## Key Features

- `Board`: visual graph of agents + channels with step order, ACL, and message-type constraints.
- `Vault`: upload files and mount them by scope (`AGENT`, `CHANNEL`, `RUN`).
- `Runs`: compile board into turn candidates, execute scheduler, replay turns, inspect final draft.
- `Governance`: approval/veto/escalation policies, vote calls, and deadlock mediation.
- `Templates`: quick launch of `Debate`, `Org`, `Game`, and `Build`.
- `Auto workspace setup`: infer a starter board from your goal (template or custom hub-and-spoke).

## Architecture (Short Version)

- **Frontend**: Next.js App Router + React + React Flow.
- **API**: Next route handlers under `src/app/api/...`.
- **Domain engine** (`src/lib`):
  - board schema + sanitization
  - board -> runtime projection (agents/channels)
  - run compiler
  - run scheduler
  - governance + voting + tool gateway
  - Gemini client (turn execution + final draft synthesis + image artifacts)
- **Data**: PostgreSQL via Prisma (`Workspace`, `BoardState`, `Agent`, `Channel`, `Run`, `Turn`, `Vote`, `Policy`, `VaultItem`, `Mount`).
- **File storage**: local filesystem by default (`data/vault`), configurable via `VAULT_STORAGE_DIR`.

## Quick Start

```bash
npm install
cp .env.example .env.local

npm run db:up
npm run db:migrate:deploy
npm run db:seed

npm run dev
```

Open `http://localhost:3000/login`, sign in, create a workspace, then use `Board`, `Vault`, and `Runs`.

## Core Run Flow

1. Build graph on `Board` (mission, agents, channels, step order).
2. Optionally mount context files in `Vault`.
3. Create run in `Runs`.
4. Execute run.
5. Review turn timeline + final draft.

## Environment Variables

Required:

- `DATABASE_URL`
- `GEMINI_API_KEY`

Common optional:

- `GEMINI_MODEL_FLASH` (default: `gemini-3-flash-preview`)
- `GEMINI_MODEL_PRO` (default: `gemini-3-pro-preview`)
- `GEMINI_MODEL_IMAGE` (default: `gemini-3-pro-image-preview`)
- `GEMINI_FLASH_ONLY`
- `GEMINI_MODEL_ROUTING`
- `VAULT_STORAGE_DIR`

## Useful Commands

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
