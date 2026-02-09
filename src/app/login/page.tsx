import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth-server";

import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const user = await getSessionUser();

  if (user) {
    redirect("/studio");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl items-center px-6 py-10">
      <section className="grid w-full gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="guild-card rounded-3xl p-8 sm:p-10">
          <p className="text-xs font-semibold tracking-[0.2em] text-orange-700">
            GUILD ACCESS
          </p>
          <h1 className="mt-3 text-4xl font-bold leading-tight text-slate-950">
            Build governable multi-agent systems with real runtime controls.
          </h1>
          <p className="guild-muted mt-4 max-w-2xl text-base">
            This is a hackathon-safe auth stub for development speed. Sign in
            with a display name, create a workspace, and start the Board/Vault/
            Runs flow.
          </p>
          <div className="mt-8 flex flex-wrap gap-2 text-xs font-medium">
            <span className="guild-chip rounded-full px-3 py-1">Role-aware</span>
            <span className="rounded-full border border-slate-300 bg-white px-3 py-1 text-slate-700">
              Policy-first
            </span>
            <span className="rounded-full border border-slate-300 bg-white px-3 py-1 text-slate-700">
              Replayable runs
            </span>
          </div>
        </div>

        <div className="guild-card rounded-3xl p-8">
          <h2 className="text-2xl font-bold text-slate-950">Sign In</h2>
          <p className="guild-muted mt-2 text-sm">
            Development session only. No password required.
          </p>

          <LoginForm />
        </div>
      </section>
    </main>
  );
}
