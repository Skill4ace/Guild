import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GeminiApiError,
  executeGeminiTurn,
  normalizeGeminiTurnOutput,
  pickDefaultMessageType,
  selectGeminiModel,
} from "./gemini-client";

describe("gemini-client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GEMINI_MODEL_ROUTING;
    delete process.env.GEMINI_HTTP_MAX_ATTEMPTS;
    delete process.env.GEMINI_HTTP_BACKOFF_BASE_MS;
    delete process.env.GEMINI_HTTP_BACKOFF_MAX_MS;
  });

  it("routes all agents to pro model in pro-first mode", () => {
    expect(
      selectGeminiModel({
        role: "specialist",
        thinkingProfile: "deep",
      }).model,
    ).toBe("gemini-3-pro-preview");

    expect(
      selectGeminiModel({
        role: "executive",
        thinkingProfile: "standard",
      }).model,
    ).toBe("gemini-3-pro-preview");

    expect(
      selectGeminiModel({
        role: "operator",
        thinkingProfile: "fast",
      }).model,
    ).toBe("gemini-3-pro-preview");
  });

  it("supports balanced routing when configured", () => {
    process.env.GEMINI_MODEL_ROUTING = "balanced";

    expect(
      selectGeminiModel({
        role: "operator",
        thinkingProfile: "fast",
      }).model,
    ).toBe("gemini-3-flash-preview");

    expect(
      selectGeminiModel({
        role: "executive",
        thinkingProfile: "standard",
      }).model,
    ).toBe("gemini-3-pro-preview");
  });

  it("normalizes model output and enforces allowed message types", () => {
    const normalized = normalizeGeminiTurnOutput({
      rawResponseText: JSON.stringify({
        messageType: "decision",
        summary: "Finalize and approve.",
        rationale: "All constraints passed.",
        confidence: 0.91,
      }),
      allowedMessageTypes: ["proposal", "critique"],
      isLastQueuedTurn: false,
      fallbackSummary: "Fallback summary.",
    });

    expect(normalized.messageType).toBe("proposal");
    expect(normalized.summary).toBe("Finalize and approve.");
    expect(normalized.rationale).toBe("All constraints passed.");
    expect(normalized.confidence).toBe(0.91);
  });

  it("prefers decision on last turn when decision is allowed", () => {
    expect(pickDefaultMessageType(["proposal", "decision"], true)).toBe(
      "decision",
    );
    expect(pickDefaultMessageType(["proposal", "decision"], false)).toBe(
      "proposal",
    );
  });

  it("returns fallback telemetry when API key is absent", async () => {
    const result = await executeGeminiTurn({
      runId: "run-1",
      runObjective: "Decide whether to approve launch.",
      sequence: 1,
      role: "manager",
      thinkingProfile: "standard",
      isLastQueuedTurn: false,
      apiKey: "",
      candidate: {
        id: "candidate-1",
        sourceAgentName: "Avery Exec",
        sourceAgentObjective: "Make a final recommendation.",
        targetAgentName: "Quinn QA",
        targetAgentObjective: "Challenge quality and evidence gaps.",
        allowedMessageTypes: ["proposal", "decision"],
        mountItemCount: 1,
      },
      context: {
        globalRecent: [
          {
            sequence: 1,
            sourceAgentName: "Avery Exec",
            targetAgentName: "Quinn QA",
            messageType: "proposal",
            summary: "Initial proposal shared.",
            confidence: 0.82,
          },
        ],
        channelRecent: [],
        involvementRecent: [],
      },
    });

    expect(result.telemetry.source).toBe("fallback");
    expect(result.telemetry.model).toBe("gemini-3-pro-preview");
    expect(result.telemetry.thinkingLevel).toBe("high");
    expect(result.prompt).toContain("Run id: run-1");
    expect(result.prompt).toContain("Run objective: Decide whether to approve launch.");
    expect(result.prompt).toContain("Recent conversation context:");
    expect(result.prompt).toContain("T1 Avery Exec -> Quinn QA [proposal]");
    expect(result.normalized.summary.length).toBeGreaterThan(0);
    expect(result.structured.schema).toBe("guild.agent_act.v1");
    expect(result.validation.status).toBe("fallback");
  });

  it("forces flash model when flash-only mode is enabled", () => {
    const previous = process.env.GEMINI_FLASH_ONLY;
    process.env.GEMINI_FLASH_ONLY = "true";

    try {
      expect(
        selectGeminiModel({
          role: "executive",
          thinkingProfile: "deep",
        }).model,
      ).toBe("gemini-3-flash-preview");
    } finally {
      if (previous === undefined) {
        delete process.env.GEMINI_FLASH_ONLY;
      } else {
        process.env.GEMINI_FLASH_ONLY = previous;
      }
    }
  });

  it("retries transient Gemini HTTP failures before succeeding", async () => {
    process.env.GEMINI_HTTP_MAX_ATTEMPTS = "3";
    process.env.GEMINI_HTTP_BACKOFF_BASE_MS = "1";
    process.env.GEMINI_HTTP_BACKOFF_MAX_MS = "5";

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 503,
              status: "UNAVAILABLE",
              message: "Service unavailable",
            },
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        schema: "guild.agent_act.v1",
                        messageType: "proposal",
                        summary: "Recovered after retry.",
                        rationale: "Retry succeeded.",
                        confidence: 0.74,
                        payload: {
                          title: "Recovered",
                          plan: ["Continue run"],
                          risks: [],
                        },
                      }),
                    },
                  ],
                },
              },
            ],
            usageMetadata: {
              promptTokenCount: 100,
              candidatesTokenCount: 40,
              totalTokenCount: 140,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    const result = await executeGeminiTurn({
      runId: "run-retry",
      runObjective: "Test retry behavior.",
      sequence: 2,
      role: "manager",
      thinkingProfile: "standard",
      isLastQueuedTurn: false,
      apiKey: "test-key",
      candidate: {
        id: "candidate-retry",
        sourceAgentName: "Avery Exec",
        sourceAgentObjective: "Request follow-up analysis.",
        targetAgentName: "Quinn QA",
        targetAgentObjective: "Review and respond.",
        allowedMessageTypes: ["proposal", "critique"],
        mountItemCount: 0,
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.telemetry.source).toBe("live");
    expect(result.telemetry.statusCode).toBe(200);
    expect(result.normalized.summary).toContain("Recovered after retry");
  });

  it("throws when Gemini returns non-ok after retries", async () => {
    process.env.GEMINI_HTTP_MAX_ATTEMPTS = "1";
    process.env.GEMINI_HTTP_BACKOFF_BASE_MS = "1";
    process.env.GEMINI_HTTP_BACKOFF_MAX_MS = "1";

    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 429,
            status: "RESOURCE_EXHAUSTED",
            message: "Quota exceeded. Please retry in 10s.",
          },
        }),
        { status: 429, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      executeGeminiTurn({
        runId: "run-fail",
        runObjective: "Test failure path.",
        sequence: 1,
        role: "manager",
        thinkingProfile: "standard",
        isLastQueuedTurn: false,
        apiKey: "test-key",
        candidate: {
          id: "candidate-fail",
          sourceAgentName: "Avery Exec",
          sourceAgentObjective: "Request follow-up analysis.",
          targetAgentName: "Quinn QA",
          targetAgentObjective: "Review and respond.",
          allowedMessageTypes: ["proposal", "critique"],
          mountItemCount: 0,
        },
      }),
    ).rejects.toBeInstanceOf(GeminiApiError);
  });

  it("fails fast on hard free-tier daily quota exhaustion", async () => {
    process.env.GEMINI_HTTP_MAX_ATTEMPTS = "3";
    process.env.GEMINI_HTTP_BACKOFF_BASE_MS = "1";
    process.env.GEMINI_HTTP_BACKOFF_MAX_MS = "5";

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 429,
            status: "RESOURCE_EXHAUSTED",
            message:
              "Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests. quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier",
          },
        }),
        { status: 429, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      executeGeminiTurn({
        runId: "run-hard-quota",
        runObjective: "Test hard quota detection.",
        sequence: 1,
        role: "manager",
        thinkingProfile: "standard",
        isLastQueuedTurn: false,
        apiKey: "test-key",
        candidate: {
          id: "candidate-hard-quota",
          sourceAgentName: "Avery Exec",
          sourceAgentObjective: "Request analysis.",
          targetAgentName: "Quinn QA",
          targetAgentObjective: "Respond with review.",
          allowedMessageTypes: ["proposal", "critique"],
          mountItemCount: 0,
        },
      }),
    ).rejects.toBeInstanceOf(GeminiApiError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
