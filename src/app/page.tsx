import Link from "next/link";

import { GuildLogoBadge } from "@/components/guild-logo-badge";

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden px-5 py-8 sm:px-8 sm:py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="guild-card rounded-2xl px-5 py-4 sm:px-7 sm:py-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <GuildLogoBadge priority />
              <div>
                <p className="text-xl font-bold tracking-tight text-slate-950">
                  Guild
                </p>
                <p className="guild-muted text-sm">
                  Multi-agent studio for governed collaboration
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-medium">
              <span className="guild-chip rounded-full px-3 py-1">Action Era</span>
              <span className="rounded-full border border-slate-300 bg-white px-3 py-1 text-slate-700">
                Gemini Runtime
              </span>
              <span className="rounded-full border border-slate-300 bg-white px-3 py-1 text-slate-700">
                Studio Ready
              </span>
            </div>
          </div>
        </header>

        <main className="grid gap-6 lg:grid-cols-[1.3fr_0.9fr]">
          <section className="guild-card rounded-3xl p-6 sm:p-8">
            <p className="text-xs font-semibold tracking-[0.2em] text-orange-700">
              BUILD RUNTIME, NOT CHAT
            </p>
            <h1 className="mt-3 text-3xl font-bold leading-tight text-slate-950 sm:text-5xl">
              Orchestrate agent teams with explicit rules, memory, and command.
            </h1>
            <p className="guild-muted mt-4 max-w-2xl text-base sm:text-lg">
              Guild converts agent behavior into real product surface: Board for
              topology, Vault for mounted context, and Runs for governed
              execution.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              <article className="rounded-2xl border border-slate-200 bg-white/90 p-4">
                <p className="text-sm font-semibold text-slate-900">Board</p>
                <p className="guild-muted mt-2 text-sm">
                  Agents and channels with role-bound communication boundaries.
                </p>
              </article>
              <article className="rounded-2xl border border-slate-200 bg-white/90 p-4">
                <p className="text-sm font-semibold text-slate-900">Vault</p>
                <p className="guild-muted mt-2 text-sm">
                  Explicitly mounted files and rules, scoped by policy.
                </p>
              </article>
              <article className="rounded-2xl border border-slate-200 bg-white/90 p-4">
                <p className="text-sm font-semibold text-slate-900">Runs</p>
                <p className="guild-muted mt-2 text-sm">
                  Stateful turns, votes, mediation, and replayable outcomes.
                </p>
              </article>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/login"
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Open login
              </Link>
              <Link
                href="/studio"
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Go to studio
              </Link>
            </div>
          </section>

          <aside className="guild-card rounded-3xl p-6 sm:p-8">
            <h2 className="text-lg font-semibold text-slate-950">Quick Verify</h2>
            <p className="guild-muted mt-2 text-sm">
              Confirm API health and database readiness before running the studio.
            </p>

            <div className="mt-5 rounded-2xl bg-slate-950 p-4 text-sm text-slate-100">
              <p className="font-mono">curl http://localhost:3000/api/health</p>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold tracking-wide text-slate-500">
                EXPECTED RESPONSE
              </p>
              <pre className="mt-2 overflow-x-auto font-mono text-xs text-slate-800">{`{"status":"ok","service":"guild-web","timestamp":"..."}`}</pre>
            </div>

            <div className="mt-4 rounded-2xl border border-orange-200 bg-orange-50 p-4">
              <p className="text-sm font-semibold text-orange-900">Infra Rule</p>
              <p className="mt-1 text-sm text-orange-800">
                Run Postgres via Docker Compose before `npm run test:db`.
              </p>
            </div>
          </aside>
        </main>

        <footer className="guild-muted px-1 text-xs">
          Guild prototype. Current focus: infrastructure quality, deterministic
          runtime, and hackathon-grade execution.
        </footer>
      </div>
    </div>
  );
}
