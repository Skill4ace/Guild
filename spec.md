# Guild Spec

Last updated: February 6, 2026  
Target event deadline: February 9, 2026 at 5:00 PM PT

## 1) Gemini 3 Hackathon Analysis (What They Want)

### Confirmed requirements
- Build an application using the Gemini API with Gemini 3 models available in Google AI Studio.
- Submission deadline is **February 9, 2026, 5:00 PM Pacific Time**.
- Team size up to 4 members.
- Submission must include:
  - Live app URL
  - Public code repository
  - Short video (up to 3 minutes)
  - Written explanation of how Gemini API is used
- Judging is weighted evenly across:
  - Usability and UX (20%)
  - Potential impact (20%)
  - Quality of idea (20%)
  - Quality of implementation (20%)
  - Gemini API integration quality (20%)

### Strategic interpretation
- The event materials explicitly discourage thin wrappers around generic chat.
- Judges are likely to reward systems that:
  - Have clear product behavior, not just prompts
  - Use Gemini API as core runtime infrastructure
  - Demonstrate repeatable workflows and measurable outcomes
  - Show strong execution quality in a constrained demo window

### What this means for Guild
- Guild is a strong fit if built as:
  - A **multi-agent runtime**, not a single-agent chat shell
  - A system with explicit governance, memory boundaries, and replayability
  - A product with clear task outcomes (decision made, artifact produced, conflict resolved)
- The fastest path to score well is:
  - Tight UX around 3 high-signal templates (`Debate`, `Org`, `Game`)
  - Strong observability (run timeline, replay, rationale chain)
  - Explicit Gemini features: structured output, function calling, tool continuity, thinking configuration

## 2) Product Vision Summary

Guild is a web studio for configuring and executing governed multi-agent systems:
- **Board**: graph editor for agents and channels.
- **Vault**: context store with explicit mounts to agents/channels.
- **Runs**: orchestrated execution with turns, rules, consensus, and replay.

Core claim: If one prompt can do it, it is not Guild territory.

## 3) Technical Architecture (Hackathon-viable)

### Recommended stack
- Frontend: Next.js + TypeScript + Tailwind + React Flow
- Backend: Next.js route handlers (or Fastify) + TypeScript
- Data: PostgreSQL + Prisma
- Queue/runtime: Redis + BullMQ (or in-process queue for MVP)
- Storage: local/S3-compatible object store for Vault files
- AI: Google Gemini API (`gemini-3-flash-preview` for runtime, `gemini-3-pro-preview` for high-stakes turns)

### Runtime model
- Persist graph, rules, memory, and mounts in DB.
- Compiler converts board config to executable run plan.
- Scheduler executes turns with policy checks before and after each turn.
- Gemini responses must conform to strict JSON contracts per message/tool type.

## 4) Module Plan (18 small modules, sequential execution)

Each module is scoped to be implemented and validated independently.

## M01 - Project Bootstrap
- Goal: initialize app skeleton, env config, lint/test baseline.
- Deliverables:
  - Monorepo or single app setup
  - `.env.example` with Gemini, DB, Redis keys
  - Base CI checks
- Acceptance:
  - Local app boots with health endpoint.

## M02 - Domain Data Model
- Goal: define schema for workspace, agent, channel, vault item, mount, run, turn, vote, policy.
- Deliverables:
  - Prisma schema + initial migration
  - Seed script with demo workspace
- Acceptance:
  - CRUD for core entities works via DB client tests.

## M03 - Auth and Workspace Shell
- Goal: basic user session + workspace switcher + project shell layout.
- Deliverables:
  - Login stub (hackathon-safe auth)
  - Workspace home with navigation: Board / Vault / Runs / Templates
- Acceptance:
  - User can create and load workspace.

## M04 - Board Canvas
- Goal: visual graph editor for agents and channels.
- Deliverables:
  - Node creation/edit/delete
  - Edge creation with type badges
  - Auto-save board state
- Acceptance:
  - User can build a graph and reload it without data loss.

## M05 - Agent Identity and Role Config
- Goal: configure each agent with role, objectives, authority level, thinking profile.
- Deliverables:
  - Agent config panel
  - Role presets (`executive`, `director`, `manager`, `specialist`, `operator`)
  - Persona + constraints + private memory toggle
- Acceptance:
  - Agent config persists and appears in run compiler.

## M06 - Channel Governance and ACL
- Goal: define read/write permissions and message types per channel.
- Deliverables:
  - Channel policy editor
  - Public/private channel mode
  - Allowed message schemas (`proposal`, `critique`, `vote_call`, `decision`)
- Acceptance:
  - Unauthorized message attempts are blocked in runtime.

## M07 - Vault Ingestion
- Goal: upload and index workspace files with metadata.
- Deliverables:
  - File upload UI
  - Metadata tags (`rules`, `examples`, `assets`, `data`)
  - Size/type validation
- Acceptance:
  - Files can be uploaded, listed, and retrieved.

## M08 - Mount Manager
- Goal: explicitly mount vault assets to agents/channels/runs.
- Deliverables:
  - Mount UI with scope selector
  - Runtime mount resolver
  - Mount audit log
- Acceptance:
  - Run context includes only selected mounts.

## M09 - Run Compiler
- Goal: convert board + rules + mounts into executable plan.
- Deliverables:
  - Plan graph with turn candidates and stop conditions
  - Validation errors before run start
- Acceptance:
  - Invalid graph configurations fail fast with actionable messages.

## M10 - Scheduler and Turn Engine
- Goal: run turns deterministically with queueing and state checkpoints.
- Deliverables:
  - Turn loop with status states (`queued`, `running`, `blocked`, `done`)
  - Retry policy and timeout handling
- Acceptance:
  - Long runs recover from transient failure and continue.

## M11 - Gemini Client Layer
- Goal: centralized Gemini API wrapper with model routing and telemetry.
- Deliverables:
  - Support `gemini-3-flash-preview` + `gemini-3-pro-preview`
  - Request/response logging
  - Thinking profile control by role
- Acceptance:
  - Each turn stores prompt, model, latency, tokens, and normalized output.

## M12 - Structured Output Contracts
- Goal: enforce machine-readable outputs for all agent acts.
- Deliverables:
  - JSON schemas for all message/tool payloads
  - Validation and repair loop for malformed outputs
- Acceptance:
  - Runtime never applies unvalidated model output.

## M13 - Tool/Function Calling Gateway
- Goal: expose controlled platform actions to agents.
- Deliverables:
  - Tools: `post_message`, `request_vote`, `fetch_mount`, `checkpoint_state`, `set_status`
  - Argument validation + permission guard
- Acceptance:
  - Tool calls are logged and blocked if policy-incompatible.

## M14 - Governance Engine
- Goal: enforce approval/veto/escalation policies with weighted authority.
- Deliverables:
  - Policy DSL for thresholds and blockers
  - Evaluation after each proposal step
- Acceptance:
  - Decision cannot finalize if required approver has not approved.

## M15 - Consensus and Voting
- Goal: support formal decision flows.
- Deliverables:
  - Vote creation, weighted tally, quorum checks
  - Explainable result object
- Acceptance:
  - Identical vote inputs always produce deterministic output.

## M16 - Deadlock Mediation
- Goal: detect stalled debates and invoke mediator protocol.
- Deliverables:
  - Deadlock signals (repeated objections, timeout, no majority)
  - Mediator action set (`summarize`, `request_evidence`, `force_vote`)
- Acceptance:
  - Deadlocked run transitions to resolved/terminated state.

## M17 - Run Timeline, Replay, and Fork
- Goal: inspect, replay, and branch historical runs.
- Deliverables:
  - Event timeline UI
  - Replay controls
  - Fork run from checkpoint
- Acceptance:
  - Forked runs preserve provenance and diverge cleanly.

## M18 - Templates and Demo Packaging
- Goal: ship ready-to-run templates plus submission assets.
- Deliverables:
  - `Debate`, `Org`, `Game`, and `Build Your Own` template seeds
  - Demo script with one strong end-to-end scenario
  - Submission checklist artifact
- Acceptance:
  - New user can launch template and reach meaningful outcome in under 5 minutes.

## 5) Module-by-Module Build Order

1. M01 Project Bootstrap  
2. M02 Domain Data Model  
3. M03 Auth and Workspace Shell  
4. M04 Board Canvas  
5. M05 Agent Identity and Role Config  
6. M06 Channel Governance and ACL  
7. M07 Vault Ingestion  
8. M08 Mount Manager  
9. M09 Run Compiler  
10. M10 Scheduler and Turn Engine  
11. M11 Gemini Client Layer  
12. M12 Structured Output Contracts  
13. M13 Tool/Function Calling Gateway  
14. M14 Governance Engine  
15. M15 Consensus and Voting  
16. M16 Deadlock Mediation  
17. M17 Run Timeline, Replay, and Fork  
18. M18 Templates and Demo Packaging

## 6) Non-Negotiable MVP Slice (to hit deadline)

- Must have for judging:
  - Board creation/edit
  - Vault upload + mounting
  - Executable run with at least one governance loop
  - Replayable timeline
  - One polished template flow with clear outcome
- Can defer if time is tight:
  - Full RBAC system
  - Complex multiplayer live editing
  - Large-scale vector retrieval

## 7) Gemini API Integration Requirements

- Use Gemini as core turn engine, not just assistant chat.
- Every turn must:
  - Include scoped context (agent state + mounts + channel constraints)
  - Request structured JSON output with schema tag
  - Optionally issue tool calls through controlled gateway
- Model routing policy:
  - `gemini-3-flash-preview`: routine turns, routing, summarization
  - `gemini-3-pro-preview`: mediator turns, conflict resolution, high-stakes decisions
- Persist observability:
  - model id, latency, token usage, tool calls, validation status

## 8) Quality Gates per Module

For each module before moving to next:
- Unit tests for core logic
- Happy path integration test
- At least one failure-path test
- Demoable UI/CLI checkpoint
- Short changelog entry

## 9) Hackathon Scoring Mapping

- Usability/UX (20%):
  - M03, M04, M17, M18
- Potential impact (20%):
  - M14, M15, M16 with repeatable decision outcomes
- Quality of idea (20%):
  - Multi-agent governance + template strategy
- Quality of implementation (20%):
  - M09-M13 runtime reliability and contracts
- Gemini integration (20%):
  - M11-M13 + model routing + structured outputs + tool-calling

## 10) Security and Operational Notes

- API key hygiene:
  - Never commit keys.
  - Rotate any key pasted into chat or docs before production submission.
- PII/data controls:
  - Mark vault files by sensitivity.
  - Block unsafe file types.
- Failure controls:
  - Timeout + retry + circuit-breaker around model calls.

## 11) Immediate Next Execution Block (first 6 hours)

1. Ship M01 + M02 skeleton.
2. Implement M04 minimal board + M05 agent form.
3. Implement M11 raw Gemini wrapper and M12 schema validation.
4. Demo one end-to-end run (2 agents + 1 mediator) with M10 turn loop.
5. Record a dry-run demo clip for submission prep.

## 12) Open Decisions Needed From You

- Preferred stack confirmation:
  - Next.js full-stack or split frontend/backend.
- Visual direction:
  - enterprise control room vs. playful strategy-board.
- First demo scenario:
  - product decision council, policy arbitration, or game adjudication.
