import { describe, expect, it } from "vitest";

import {
  buildDeterministicFinalDraft,
  normalizeFinalDraftFromModel,
  type FinalDraftInput,
} from "./final-draft";

function createInput(): FinalDraftInput {
  return {
    runName: "Campaign Run",
    runObjective: "Create a launch campaign with messaging, channels, KPIs, and creative assets.",
    runStatus: "COMPLETED",
    updatedAt: "2026-02-09T00:00:00.000Z",
    turns: [
      {
        sequence: 1,
        status: "COMPLETED",
        actorName: "Lead Architect",
        channelName: "Lead to Planner",
        messageType: "proposal",
        summary: "Define campaign narrative and audience segments.",
        rationale: "Need clear positioning before channel planning.",
        payload: {
          nextSteps: ["Finalize top 3 personas", "Draft core message pillars"],
        },
        artifacts: [],
        endedAt: "2026-02-09T00:00:01.000Z",
        startedAt: "2026-02-09T00:00:00.000Z",
      },
      {
        sequence: 2,
        status: "COMPLETED",
        actorName: "Planner",
        channelName: "Planner to Operator",
        messageType: "decision",
        summary: "Approve 6-week rollout with KPI gates and creative sprint milestones.",
        rationale: "All checkpoints are actionable and measurable.",
        payload: {
          nextSteps: ["Assign owners", "Publish weekly KPI dashboard"],
        },
        artifacts: [
          {
            kind: "image",
            vaultItemId: "vault-1",
            name: "Concept Hero",
            fileName: "hero.png",
            mimeType: "image/png",
            byteSize: 100,
            model: "gemini-3-pro-image-preview",
          },
        ],
        endedAt: "2026-02-09T00:00:05.000Z",
        startedAt: "2026-02-09T00:00:03.000Z",
      },
    ],
    vote: {
      status: "CLOSED",
      outcome: "passed",
      winner: "approve",
      explanation: "Consensus reached.",
      openCount: 0,
    },
    deadlock: null,
  };
}

describe("final-draft", () => {
  it("builds deterministic draft with sections and markdown", () => {
    const draft = buildDeterministicFinalDraft(createInput());

    expect(draft.version).toBe(1);
    expect(draft.synthesisSource).toBe("deterministic");
    expect(draft.recommendation).toContain("Approve 6-week rollout");
    expect(draft.sections.length).toBeGreaterThanOrEqual(5);
    expect(draft.markdown).toContain("## Recommendation");
    expect(draft.markdown).toContain("## Agent Positions");
  });

  it("uses model JSON when valid and falls back sections when empty", () => {
    const fallback = buildDeterministicFinalDraft(createInput());

    const normalized = normalizeFinalDraftFromModel({
      rawResponseText: JSON.stringify({
        recommendation: "Ship the campaign with weekly KPI reviews.",
        summary: "Structured plan with staged rollout and creative checkpoints.",
        statusLabel: "Final synthesis ready",
        sections: [
          {
            id: "strategy",
            title: "Strategy",
            lines: [
              "Position Guild as governed multi-agent infrastructure for operator teams.",
              "Anchor launch narrative on control, auditability, and speed.",
            ],
            sourceSequences: [1, 2],
          },
        ],
        markdown: "# Final Draft\n\n## Strategy\n- Keep execution measurable.",
      }),
      fallback,
    });

    expect(normalized.synthesisSource).toBe("model");
    expect(normalized.recommendation).toContain("Ship the campaign");
    expect(normalized.sections[0]?.title).toBe("Strategy");
    expect(normalized.markdown).toContain("# Final Draft");
  });
});
