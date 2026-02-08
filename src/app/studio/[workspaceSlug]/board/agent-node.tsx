"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

import {
  AGENT_ROLE_META,
  AGENT_THINKING_PROFILE_META,
  type AgentNodeData,
  type AgentRole,
} from "@/lib/board-state";

const ROLE_THEME: Record<
  AgentRole,
  { card: string; badge: string; tone: string; glow: string }
> = {
  executive: {
    card: "border-[#7c3aed] bg-gradient-to-b from-[#f5f3ff] to-white",
    badge: "bg-[#ede9fe] text-[#5b21b6] border-[#c4b5fd]",
    tone: "text-[#4c1d95]",
    glow: "shadow-[0_10px_20px_-14px_rgba(124,58,237,0.75)]",
  },
  director: {
    card: "border-[#2563eb] bg-gradient-to-b from-[#eff6ff] to-white",
    badge: "bg-[#dbeafe] text-[#1d4ed8] border-[#93c5fd]",
    tone: "text-[#1e3a8a]",
    glow: "shadow-[0_10px_20px_-14px_rgba(37,99,235,0.6)]",
  },
  manager: {
    card: "border-[#0f766e] bg-gradient-to-b from-[#ecfeff] to-white",
    badge: "bg-[#ccfbf1] text-[#0f766e] border-[#5eead4]",
    tone: "text-[#134e4a]",
    glow: "shadow-[0_10px_20px_-14px_rgba(15,118,110,0.55)]",
  },
  specialist: {
    card: "border-[#0f766e] bg-gradient-to-b from-[#f0fdfa] to-white",
    badge: "bg-[#ccfbf1] text-[#115e59] border-[#5eead4]",
    tone: "text-[#134e4a]",
    glow: "shadow-[0_10px_20px_-14px_rgba(17,94,89,0.55)]",
  },
  operator: {
    card: "border-[#64748b] bg-gradient-to-b from-[#f8fafc] to-white",
    badge: "bg-[#e2e8f0] text-[#334155] border-[#cbd5e1]",
    tone: "text-[#334155]",
    glow: "shadow-[0_10px_20px_-14px_rgba(51,65,85,0.45)]",
  },
};

export function AgentNode({ data, selected }: NodeProps<Node<AgentNodeData>>) {
  const role = data.role;
  const theme = ROLE_THEME[role];
  const meta = AGENT_ROLE_META[role];
  const thinking = AGENT_THINKING_PROFILE_META[data.thinkingProfile];
  const roleBadgeLabel = meta.label.includes(" - ")
    ? meta.label.split(" - ")[1]
    : meta.label;
  const handleClass = "!h-2.5 !w-2.5 !border !border-slate-700 !bg-white";

  return (
    <div
      className={`relative w-[230px] rounded-xl border-2 px-4 py-3 ${theme.card} ${theme.glow} ${
        selected ? "ring-2 ring-orange-400 ring-offset-2" : ""
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        id="target-top"
        isConnectable
        className={handleClass}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="source-bottom"
        isConnectable
        className={handleClass}
      />

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`truncate text-sm font-bold ${theme.tone}`}>{data.label}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">Level {meta.level}</p>
        </div>
        <span
          className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${theme.badge}`}
        >
          {roleBadgeLabel}
        </span>
      </div>

      <div className="mt-3 rounded-lg border border-slate-200/80 bg-white/80 px-2.5 py-2">
        <div className="mb-1 flex flex-wrap gap-1">
          <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600">
            Authority {data.authorityWeight}/10
          </span>
          <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600">
            Thinking {thinking.label}
          </span>
          {data.privateMemoryEnabled ? (
            <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700">
              Private memory on
            </span>
          ) : null}
        </div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          Task
        </p>
        <p className="mt-1 text-[11px] leading-4 text-slate-700">
          {data.objective.trim() || meta.summary}
        </p>
      </div>
    </div>
  );
}
