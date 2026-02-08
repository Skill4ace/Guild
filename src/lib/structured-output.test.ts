import { describe, expect, it } from "vitest";

import {
  AGENT_ACT_SCHEMA_ID,
  TOOL_CALL_SCHEMA_ID,
  validateAgentActOutput,
  validateAndRepairAgentActOutput,
  validateToolCallOutput,
} from "./structured-output";

describe("structured-output", () => {
  it("validates strict agent act payload", () => {
    const validation = validateAgentActOutput(
      {
        schema: AGENT_ACT_SCHEMA_ID,
        messageType: "proposal",
        summary: "Propose launch checklist.",
        rationale: "Sequence risk first, then execution.",
        confidence: 0.82,
        payload: {
          title: "Launch Checklist",
          plan: ["Confirm requirements", "Run QA", "Approve release"],
          risks: ["Late regression"],
        },
      },
      ["proposal", "critique"],
    );

    expect(validation.ok).toBe(true);
  });

  it("repairs malformed response into valid output", () => {
    const repaired = validateAndRepairAgentActOutput({
      rawResponseText: "This is not JSON",
      allowedMessageTypes: ["proposal", "decision"],
      isLastQueuedTurn: false,
      fallbackSummary: "Fallback summary text.",
    });

    expect(repaired.status).toBe("fallback");
    expect(repaired.output.schema).toBe(AGENT_ACT_SCHEMA_ID);
    expect(repaired.output.messageType).toBe("proposal");
    expect(repaired.output.summary.length).toBeGreaterThan(0);
  });

  it("coerces invalid parsed object via repair loop", () => {
    const repaired = validateAndRepairAgentActOutput({
      rawResponseText: JSON.stringify({
        schema: "bad",
        messageType: "decision",
        summary: "",
        rationale: "",
        confidence: 3,
        payload: {},
      }),
      allowedMessageTypes: ["decision"],
      isLastQueuedTurn: true,
      fallbackSummary: "Decide and move forward.",
    });

    expect(repaired.status).toBe("repaired");
    expect(repaired.output.schema).toBe(AGENT_ACT_SCHEMA_ID);
    expect(repaired.output.messageType).toBe("decision");
  });

  it("validates tool call output contract", () => {
    const validTool = validateToolCallOutput({
      schema: TOOL_CALL_SCHEMA_ID,
      tool: "set_status",
      arguments: {
        status: "running",
      },
    });

    expect(validTool.ok).toBe(true);
  });

  it("rejects tool call with unknown tool", () => {
    const invalidTool = validateToolCallOutput({
      schema: TOOL_CALL_SCHEMA_ID,
      tool: "delete_database",
      arguments: {},
    });

    expect(invalidTool.ok).toBe(false);
    if (!invalidTool.ok) {
      expect(invalidTool.issues.some((issue) => issue.path === "$.tool")).toBe(
        true,
      );
    }
  });
});
