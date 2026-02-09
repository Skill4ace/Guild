import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildLocalAutoWorkspaceDraft,
  generateAutoWorkspaceDraft,
} from "./workspace-autobuilder";

describe("workspace-autobuilder", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("infers debate template from argument-oriented goals", () => {
    const draft = buildLocalAutoWorkspaceDraft({
      intent:
        "Run a side vs side debate with a mediator to decide whether we ship the feature.",
      workspaceDescription: null,
    });

    expect(draft.templateKey).toBe("debate");
    expect(draft.boardObjective.length).toBeGreaterThan(0);
  });

  it("infers debate template from compare-style questions", () => {
    const draft = buildLocalAutoWorkspaceDraft({
      intent: "Decide whether UCLA or USC is better overall.",
      workspaceDescription: null,
    });

    expect(draft.templateKey).toBe("debate");
  });

  it("builds a hub-and-spoke board when intent asks for one lead with many workers", () => {
    const draft = buildLocalAutoWorkspaceDraft({
      intent:
        "Make a mediator named Eric who links to multiple ABG workers generating marketing ideas.",
      workspaceDescription: null,
    });

    expect(draft.templateKey).toBe("build");
    expect(draft.topology.kind).toBe("hub_spoke");
    expect(draft.boardDocument).not.toBeNull();
    expect(draft.boardDocument?.nodes.length).toBeGreaterThanOrEqual(4);
    expect(draft.boardDocument?.edges.length).toBeGreaterThanOrEqual(7);
    expect(
      draft.boardDocument?.nodes.some((node) =>
        node.data.label.toLowerCase().includes("eric"),
      ),
    ).toBe(true);
  });

  it("uses description as auto intent fallback when goal is empty", async () => {
    const result = await generateAutoWorkspaceDraft({
      workspaceName: "Arguments",
      workspaceDescription: "Agents argue with each other to come to a decision.",
      intent: null,
      apiKey: "",
    });

    expect(result.draft.templateKey).toBe("debate");
    expect(result.telemetry.source).toBe("local");
  });

  it("skips Gemini refinement for simple goals", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const result = await generateAutoWorkspaceDraft({
      workspaceName: "Simple Workspace",
      workspaceDescription: null,
      intent: "Plan next sprint.",
      apiKey: "test-key",
    });

    expect(result.telemetry.source).toBe("local");
    expect(result.telemetry.reason).toBe("goal-not-complex");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses Gemini refinement for complex goals when API is available", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      templateKey: "org",
                      boardObjective:
                        "Coordinate incident response across engineering, QA, and operations, then finalize rollback or release.",
                      runMission:
                        "Triage incident signals, generate candidate mitigations, and produce a governed go/no-go decision.",
                      workspaceDescription:
                        "Cross-functional incident response workspace.",
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await generateAutoWorkspaceDraft({
      workspaceName: "Incident Lab",
      workspaceDescription: null,
      intent:
        "Coordinate engineering incident triage across platform, QA, release, and support teams with governance checks and clear decision criteria.",
      apiKey: "test-key",
    });

    expect(result.telemetry.source).toBe("gemini-live");
    expect(result.draft.source).toBe("gemini");
    expect(result.draft.templateKey).toBe("org");
    expect(result.draft.runMission.length).toBeGreaterThan(0);
  });

  it("still calls Gemini for short hub-and-spoke goals", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      templateKey: "build",
                      boardObjective:
                        "Create a lead-centered marketing workflow with coordinated workers.",
                      runMission:
                        "Lead agent routes marketing tasks to worker agents and synthesizes outputs.",
                      workspaceDescription:
                        "Lead + workers marketing workflow.",
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await generateAutoWorkspaceDraft({
      workspaceName: "Pyramid",
      workspaceDescription: null,
      intent:
        "Make a mediator named Eric who links to multiple ABG workers generating marketing ideas.",
      apiKey: "test-key",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.telemetry.source).toBe("gemini-live");
  });
});
