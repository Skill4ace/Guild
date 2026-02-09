import type { ChannelMessageType } from "./board-state";
import type { AgentToolingConfig } from "./board-state";
import type { AgentThinkingProfile } from "./board-state";
import type { AgentRole } from "./board-state";
import {
  buildDeterministicFinalDraft,
  normalizeFinalDraftFromModel,
  type FinalDraftInput,
  type RunFinalDraftDocument,
} from "./final-draft";
import {
  AGENT_ACT_SCHEMA_ID,
  buildFallbackAgentActOutput,
  pickDefaultMessageType,
  validateAndRepairAgentActOutput,
  type AgentActOutput,
  type StructuredValidationIssue,
} from "./structured-output";

export { pickDefaultMessageType } from "./structured-output";

export const DEFAULT_GEMINI_FLASH_MODEL = "gemini-3-flash-preview";
export const DEFAULT_GEMINI_PRO_MODEL = "gemini-3-pro-preview";
export const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-3-pro-image-preview";

export type GeminiModelSelection = {
  model: string;
  routeReason: string;
  thinkingLevel: GeminiThinkingLevel;
};

export type GeminiThinkingLevel = "minimal" | "low" | "medium" | "high";

export type GeminiTokenUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type GeminiTurnTelemetry = {
  provider: "google-gemini";
  source: "live" | "fallback";
  model: string;
  routeReason: string;
  thinkingLevel: GeminiThinkingLevel;
  latencyMs: number;
  requestId: string | null;
  statusCode: number | null;
  tokenUsage: GeminiTokenUsage;
};

export type GeminiNormalizedTurnOutput = {
  messageType: ChannelMessageType;
  summary: string;
  rationale: string;
  confidence: number;
};

export type GeminiPromptConversationEntry = {
  sequence: number;
  sourceAgentName: string;
  targetAgentName: string;
  messageType: ChannelMessageType;
  summary: string;
  confidence: number | null;
};

export type GeminiPromptContextWindow = {
  globalRecent: GeminiPromptConversationEntry[];
  channelRecent: GeminiPromptConversationEntry[];
  involvementRecent: GeminiPromptConversationEntry[];
};

export type GeminiTurnExecutionResult = {
  prompt: string;
  normalized: GeminiNormalizedTurnOutput;
  structured: AgentActOutput;
  validation: {
    schema: typeof AGENT_ACT_SCHEMA_ID;
    status: "valid" | "repaired" | "fallback";
    issues: StructuredValidationIssue[];
    repairSteps: string[];
  };
  telemetry: GeminiTurnTelemetry;
  rawResponseText: string;
  rawResponse: unknown;
};

export type GeminiFinalDraftSynthesisResult = {
  draft: RunFinalDraftDocument;
  telemetry: GeminiTurnTelemetry;
  rawResponseText: string;
  rawResponse: unknown;
};

export class GeminiApiError extends Error {
  retryable: boolean;
  statusCode: number | null;

  constructor(message: string, retryable: boolean, statusCode: number | null) {
    super(message);
    this.name = "GeminiApiError";
    this.retryable = retryable;
    this.statusCode = statusCode;
  }
}

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: {
          mimeType?: string;
          data?: string;
        };
        inline_data?: {
          mime_type?: string;
          data?: string;
        };
      }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

type ExecuteGeminiTurnInput = {
  runId: string;
  runObjective: string;
  sequence: number;
  candidate: {
    id: string;
    sourceAgentName: string;
    sourceAgentObjective: string;
    sourceAgentTools: AgentToolingConfig;
    targetAgentName: string;
    targetAgentObjective: string;
    stepOrder?: number | null;
    allowedMessageTypes: ChannelMessageType[];
    mountItemCount: number;
  };
  context?: GeminiPromptContextWindow;
  role: AgentRole;
  thinkingProfile: AgentThinkingProfile;
  isLastQueuedTurn: boolean;
  apiKey?: string | null;
};

type GeminiRequestResult = {
  response: Response;
  textBody: string;
  parsedBody: GeminiGenerateContentResponse;
  latencyMs: number;
};

export type GeminiImageArtifactResult = {
  model: string;
  prompt: string;
  mimeType: string;
  bytes: Uint8Array;
  latencyMs: number;
  requestId: string | null;
  statusCode: number | null;
};

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
let nextGeminiRequestAtMs = 0;
let lastGeminiRequestAtMs = 0;

function configuredFlashModel(): string {
  const configured = process.env.GEMINI_MODEL_FLASH?.trim();
  return configured && configured.length > 0
    ? configured
    : DEFAULT_GEMINI_FLASH_MODEL;
}

function configuredProModel(): string {
  const configured = process.env.GEMINI_MODEL_PRO?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_GEMINI_PRO_MODEL;
}

function configuredImageModel(): string {
  const configured = process.env.GEMINI_MODEL_IMAGE?.trim();
  return configured && configured.length > 0
    ? configured
    : DEFAULT_GEMINI_IMAGE_MODEL;
}

function configuredHttpMaxAttempts(): number {
  const raw = Number(process.env.GEMINI_HTTP_MAX_ATTEMPTS ?? "3");
  if (!Number.isFinite(raw)) {
    return 3;
  }

  return Math.max(1, Math.min(8, Math.round(raw)));
}

function configuredBackoffBaseMs(): number {
  const raw = Number(process.env.GEMINI_HTTP_BACKOFF_BASE_MS ?? "1200");
  if (!Number.isFinite(raw)) {
    return 1200;
  }

  return Math.max(100, Math.min(10_000, Math.round(raw)));
}

function configuredBackoffMaxMs(): number {
  const raw = Number(process.env.GEMINI_HTTP_BACKOFF_MAX_MS ?? "30_000");
  if (!Number.isFinite(raw)) {
    return 30_000;
  }

  return Math.max(500, Math.min(120_000, Math.round(raw)));
}

function configuredMinRequestIntervalMs(): number {
  const raw = Number(process.env.GEMINI_REQUEST_MIN_INTERVAL_MS ?? "0");
  if (!Number.isFinite(raw)) {
    return 0;
  }

  return Math.max(0, Math.min(120_000, Math.round(raw)));
}

function isFlashOnlyModeEnabled(): boolean {
  const raw = process.env.GEMINI_FLASH_ONLY?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function configuredRoutingMode(): "pro-first" | "balanced" {
  const raw = process.env.GEMINI_MODEL_ROUTING?.trim().toLowerCase();
  if (raw === "balanced" || raw === "mixed") {
    return "balanced";
  }

  return "pro-first";
}

function resolveThinkingLevel(
  model: string,
  thinkingProfile: AgentThinkingProfile,
): GeminiThinkingLevel {
  const normalized = model.toLowerCase();
  const isFlash = normalized.includes("flash");

  if (isFlash) {
    if (thinkingProfile === "fast") {
      return "minimal";
    }
    if (thinkingProfile === "standard") {
      return "medium";
    }

    return "high";
  }

  if (thinkingProfile === "fast") {
    return "low";
  }

  return "high";
}

export function selectGeminiModel(input: {
  role: AgentRole;
  thinkingProfile: AgentThinkingProfile;
}): GeminiModelSelection {
  const flashModel = configuredFlashModel();
  const proModel = configuredProModel();

  if (isFlashOnlyModeEnabled()) {
    return {
      model: flashModel,
      routeReason: "flash-only-mode",
      thinkingLevel: resolveThinkingLevel(flashModel, input.thinkingProfile),
    };
  }

  if (configuredRoutingMode() === "pro-first") {
    return {
      model: proModel,
      routeReason: "pro-first-routing",
      thinkingLevel: resolveThinkingLevel(proModel, input.thinkingProfile),
    };
  }

  if (input.thinkingProfile === "deep") {
    return {
      model: proModel,
      routeReason: "deep-thinking-profile",
      thinkingLevel: resolveThinkingLevel(proModel, input.thinkingProfile),
    };
  }

  if (input.role === "executive" || input.role === "director") {
    return {
      model: proModel,
      routeReason: "high-authority-role",
      thinkingLevel: resolveThinkingLevel(proModel, input.thinkingProfile),
    };
  }

  return {
    model: flashModel,
    routeReason: "balanced-routing",
    thinkingLevel: resolveThinkingLevel(flashModel, input.thinkingProfile),
  };
}

export function normalizeGeminiTurnOutput(input: {
  rawResponseText: string;
  allowedMessageTypes: ChannelMessageType[];
  isLastQueuedTurn: boolean;
  fallbackSummary: string;
}): GeminiNormalizedTurnOutput {
  const repaired = validateAndRepairAgentActOutput({
    rawResponseText: input.rawResponseText,
    allowedMessageTypes: input.allowedMessageTypes,
    isLastQueuedTurn: input.isLastQueuedTurn,
    fallbackSummary: input.fallbackSummary,
  });

  return {
    messageType: repaired.output.messageType,
    summary: repaired.output.summary,
    rationale: repaired.output.rationale,
    confidence: repaired.output.confidence,
  };
}

function buildGeminiPrompt(input: ExecuteGeminiTurnInput): string {
  const allowedMessageTypes = input.candidate.allowedMessageTypes.join(", ");
  const runObjective = input.runObjective.trim() || "No run objective provided.";
  const sourceObjective =
    input.candidate.sourceAgentObjective.trim() || "No specific source-agent task.";
  const targetObjective =
    input.candidate.targetAgentObjective.trim() || "No specific target-agent task.";
  const stepOrderNote =
    typeof input.candidate.stepOrder === "number" && Number.isFinite(input.candidate.stepOrder)
      ? String(Math.max(1, Math.round(input.candidate.stepOrder)))
      : "auto";
  const context = input.context ?? {
    globalRecent: [],
    channelRecent: [],
    involvementRecent: [],
  };
  const formatEntry = (entry: GeminiPromptConversationEntry) => {
    const confidenceNote =
      typeof entry.confidence === "number"
        ? ` (confidence ${entry.confidence.toFixed(2)})`
        : "";

    return `T${entry.sequence} ${entry.sourceAgentName} -> ${entry.targetAgentName} [${entry.messageType}] ${entry.summary}${confidenceNote}`;
  };
  const globalLines =
    context.globalRecent.length > 0
      ? context.globalRecent.map(formatEntry)
      : ["(none)"];
  const channelLines =
    context.channelRecent.length > 0
      ? context.channelRecent.map(formatEntry)
      : ["(none)"];
  const involvementLines =
    context.involvementRecent.length > 0
      ? context.involvementRecent.map(formatEntry)
      : ["(none)"];
  const enabledTools = [
    input.candidate.sourceAgentTools.googleSearchEnabled ? "google_search" : null,
    input.candidate.sourceAgentTools.codeExecutionEnabled ? "code_execution" : null,
  ].filter((entry): entry is string => entry !== null);
  const enabledToolsLabel =
    enabledTools.length > 0 ? enabledTools.join(", ") : "none";

  return [
    "You are a Guild multi-agent runtime worker.",
    `Run id: ${input.runId}`,
    `Run objective: ${runObjective}`,
    `Turn sequence: ${input.sequence}`,
    `Source agent: ${input.candidate.sourceAgentName}`,
    `Source agent task: ${sourceObjective}`,
    `Target agent: ${input.candidate.targetAgentName}`,
    `Target agent task: ${targetObjective}`,
    `Channel step order: ${stepOrderNote}`,
    `Allowed message types: ${allowedMessageTypes}`,
    `Enabled Gemini built-in tools: ${enabledToolsLabel}`,
    `Mounted context item count: ${input.candidate.mountItemCount}`,
    "Recent conversation context:",
    "Global recent turns:",
    ...globalLines,
    "Current channel recent turns:",
    ...channelLines,
    "Turns involving source/target agents:",
    ...involvementLines,
    "Return JSON only with this shape:",
    '{"messageType":"proposal|critique|vote_call|decision","summary":"string","rationale":"string","confidence":0.0}',
    "Do not include markdown fences.",
  ].join("\n");
}

function buildGeminiBuiltInTools(
  tooling: AgentToolingConfig,
): Array<Record<string, Record<string, never>>> {
  const tools: Array<Record<string, Record<string, never>>> = [];

  if (tooling.googleSearchEnabled) {
    tools.push({ google_search: {} });
  }

  if (tooling.codeExecutionEnabled) {
    tools.push({ code_execution: {} });
  }

  return tools;
}

function buildFallbackResult(input: {
  prompt: string;
  model: string;
  routeReason: string;
  thinkingLevel: GeminiThinkingLevel;
  allowedMessageTypes: ChannelMessageType[];
  isLastQueuedTurn: boolean;
  defaultSummary: string;
  rationale: string;
  statusCode: number | null;
  rawResponseText: string;
}): GeminiTurnExecutionResult {
  const structured = buildFallbackAgentActOutput({
    messageType: pickDefaultMessageType(
      input.allowedMessageTypes,
      input.isLastQueuedTurn,
    ),
    summary: `${input.defaultSummary} (fallback simulation)`,
    rationale: input.rationale,
    confidence: 0.3,
  });

  return {
    prompt: input.prompt,
    structured,
    normalized: {
      messageType: structured.messageType,
      summary: structured.summary,
      rationale: structured.rationale,
      confidence: structured.confidence,
    },
    validation: {
      schema: AGENT_ACT_SCHEMA_ID,
      status: "fallback",
      issues: [
        {
          path: "$",
          code: "FALLBACK",
          message: input.rationale,
        },
      ],
      repairSteps: ["fallback-output"],
    },
    telemetry: {
      provider: "google-gemini",
      source: "fallback",
      model: input.model,
      routeReason: input.routeReason,
      thinkingLevel: input.thinkingLevel,
      latencyMs: 0,
      requestId: null,
      statusCode: input.statusCode,
      tokenUsage: {
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      },
    },
    rawResponseText: input.rawResponseText,
    rawResponse: {
      fallback: true,
      statusCode: input.statusCode,
      reason: input.rationale,
    },
  };
}

function parsePrimaryText(payload: GeminiGenerateContentResponse): string {
  const candidate = payload.candidates?.[0];
  const part = candidate?.content?.parts?.find(
    (entry) => typeof entry.text === "string" && entry.text.trim().length > 0,
  );
  return part?.text?.trim() ?? "";
}

function parsePrimaryInlineImage(payload: GeminiGenerateContentResponse): {
  mimeType: string;
  data: string;
} | null {
  const candidate = payload.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];

  for (const part of parts) {
    const camel = part.inlineData;
    if (
      camel &&
      typeof camel.mimeType === "string" &&
      typeof camel.data === "string" &&
      camel.data.length > 0
    ) {
      return {
        mimeType: camel.mimeType,
        data: camel.data,
      };
    }

    const snake = part.inline_data;
    if (
      snake &&
      typeof snake.mime_type === "string" &&
      typeof snake.data === "string" &&
      snake.data.length > 0
    ) {
      return {
        mimeType: snake.mime_type,
        data: snake.data,
      };
    }
  }

  return null;
}

function isRetryableStatus(statusCode: number): boolean {
  return RETRYABLE_STATUS_CODES.has(statusCode);
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const dateMillis = Date.parse(value);
  if (Number.isFinite(dateMillis)) {
    const delta = dateMillis - Date.now();
    return delta > 0 ? delta : 0;
  }

  return null;
}

function parseRetryDelayFromBody(textBody: string): number | null {
  const match = textBody.match(/please retry in\s+([0-9]+(?:\.[0-9]+)?)s/i);
  if (!match) {
    return null;
  }

  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return null;
  }

  return Math.round(seconds * 1000);
}

function isHardQuotaExhausted(textBody: string): boolean {
  const normalized = textBody.toLowerCase();
  return (
    normalized.includes("generaterequestsperdayperprojectpermodel") ||
    normalized.includes("perdayperprojectpermodel") ||
    normalized.includes(
      "quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests",
    )
  );
}

function computeRetryDelayMs(input: {
  attempt: number;
  retryAfterMs: number | null;
}): number {
  if (input.retryAfterMs !== null) {
    return Math.max(100, Math.min(configuredBackoffMaxMs(), input.retryAfterMs));
  }

  const base = configuredBackoffBaseMs();
  const max = configuredBackoffMaxMs();
  const exponent = Math.max(0, input.attempt - 1);
  const deterministic = Math.min(max, base * 2 ** exponent);
  const jitter = Math.round(Math.random() * Math.min(750, Math.max(100, base / 2)));
  return Math.min(max, deterministic + jitter);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function reserveNextGeminiWindow(delayMs: number) {
  if (delayMs <= 0) {
    return;
  }

  nextGeminiRequestAtMs = Math.max(nextGeminiRequestAtMs, Date.now() + delayMs);
}

async function waitForGeminiWindow() {
  const waitMs = nextGeminiRequestAtMs - Date.now();
  if (waitMs > 0) {
    await sleep(waitMs);
  }
}

async function waitForMinRequestInterval() {
  const minIntervalMs = configuredMinRequestIntervalMs();
  if (minIntervalMs <= 0) {
    return;
  }

  const waitMs = lastGeminiRequestAtMs + minIntervalMs - Date.now();
  if (waitMs > 0) {
    await sleep(waitMs);
  }
}

async function requestGeminiGenerateContent(input: {
  model: string;
  apiKey: string;
  prompt: string;
  thinkingLevel: GeminiThinkingLevel;
  builtInTools: Array<Record<string, Record<string, never>>>;
}): Promise<GeminiRequestResult> {
  const startedAt = Date.now();
  let response: Response;

  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${input.model}:generateContent?key=${encodeURIComponent(input.apiKey)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: input.prompt }],
            },
          ],
          ...(input.builtInTools.length > 0
            ? {
                tools: input.builtInTools,
              }
            : {}),
          generationConfig: {
            temperature: 1.0,
            responseMimeType: "application/json",
            thinkingConfig: {
              thinkingLevel: input.thinkingLevel,
            },
          },
        }),
      },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Network error calling Gemini API.";
    throw new GeminiApiError(
      `Gemini network failure using ${input.model}: ${message}`,
      true,
      null,
    );
  }

  const textBody = await response.text();
  let parsedBody: GeminiGenerateContentResponse = {};
  try {
    parsedBody = JSON.parse(textBody) as GeminiGenerateContentResponse;
  } catch {
    parsedBody = {};
  }

  return {
    response,
    textBody,
    parsedBody,
    latencyMs: Date.now() - startedAt,
  };
}

async function requestGeminiGenerateContentWithRetry(input: {
  model: string;
  apiKey: string;
  prompt: string;
  thinkingLevel: GeminiThinkingLevel;
  builtInTools: Array<Record<string, Record<string, never>>>;
}): Promise<GeminiRequestResult> {
  const maxAttempts = configuredHttpMaxAttempts();
  let lastError: GeminiApiError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await waitForGeminiWindow();
    await waitForMinRequestInterval();

    try {
      const result = await requestGeminiGenerateContent(input);
      lastGeminiRequestAtMs = Date.now();
      const statusCode = result.response.status;
      const retryAfterMs =
        parseRetryAfterMs(result.response.headers.get("retry-after")) ??
        parseRetryDelayFromBody(result.textBody);
      const hardQuota = statusCode === 429 && isHardQuotaExhausted(result.textBody);
      const canRetry =
        !result.response.ok &&
        isRetryableStatus(statusCode) &&
        !hardQuota &&
        attempt < maxAttempts;

      if (canRetry) {
        const delayMs = computeRetryDelayMs({ attempt, retryAfterMs });
        reserveNextGeminiWindow(delayMs);
        await sleep(delayMs);
        continue;
      }

      return result;
    } catch (error) {
      if (
        error instanceof GeminiApiError &&
        error.retryable &&
        attempt < maxAttempts
      ) {
        lastError = error;
        const delayMs = computeRetryDelayMs({ attempt, retryAfterMs: null });
        reserveNextGeminiWindow(delayMs);
        await sleep(delayMs);
        continue;
      }

      throw error;
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new GeminiApiError("Gemini request exhausted retries.", true, null);
}

async function requestGeminiImageGenerateContent(input: {
  model: string;
  apiKey: string;
  prompt: string;
}): Promise<GeminiRequestResult> {
  const startedAt = Date.now();
  let response: Response;

  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${input.model}:generateContent?key=${encodeURIComponent(input.apiKey)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: input.prompt }],
            },
          ],
          generationConfig: {
            temperature: 1.0,
          },
        }),
      },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Network error calling Gemini API.";
    throw new GeminiApiError(
      `Gemini image network failure using ${input.model}: ${message}`,
      true,
      null,
    );
  }

  const textBody = await response.text();
  let parsedBody: GeminiGenerateContentResponse = {};
  try {
    parsedBody = JSON.parse(textBody) as GeminiGenerateContentResponse;
  } catch {
    parsedBody = {};
  }

  return {
    response,
    textBody,
    parsedBody,
    latencyMs: Date.now() - startedAt,
  };
}

async function requestGeminiImageGenerateContentWithRetry(input: {
  model: string;
  apiKey: string;
  prompt: string;
}): Promise<GeminiRequestResult> {
  const maxAttempts = configuredHttpMaxAttempts();
  let lastError: GeminiApiError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await waitForGeminiWindow();
    await waitForMinRequestInterval();

    try {
      const result = await requestGeminiImageGenerateContent(input);
      lastGeminiRequestAtMs = Date.now();
      const statusCode = result.response.status;
      const retryAfterMs =
        parseRetryAfterMs(result.response.headers.get("retry-after")) ??
        parseRetryDelayFromBody(result.textBody);
      const hardQuota = statusCode === 429 && isHardQuotaExhausted(result.textBody);
      const canRetry =
        !result.response.ok &&
        isRetryableStatus(statusCode) &&
        !hardQuota &&
        attempt < maxAttempts;

      if (canRetry) {
        const delayMs = computeRetryDelayMs({ attempt, retryAfterMs });
        reserveNextGeminiWindow(delayMs);
        await sleep(delayMs);
        continue;
      }

      return result;
    } catch (error) {
      if (
        error instanceof GeminiApiError &&
        error.retryable &&
        attempt < maxAttempts
      ) {
        lastError = error;
        const delayMs = computeRetryDelayMs({ attempt, retryAfterMs: null });
        reserveNextGeminiWindow(delayMs);
        await sleep(delayMs);
        continue;
      }

      throw error;
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new GeminiApiError("Gemini image request exhausted retries.", true, null);
}

export async function generateGeminiImageArtifact(input: {
  runId: string;
  sequence: number;
  runObjective: string;
  sourceAgentName: string;
  sourceAgentObjective: string;
  messageSummary: string;
  messageRationale: string;
  apiKey?: string | null;
}): Promise<GeminiImageArtifactResult | null> {
  const resolvedApiKey = (input.apiKey ?? process.env.GEMINI_API_KEY)?.trim() || "";
  if (!resolvedApiKey) {
    return null;
  }

  const model = configuredImageModel();
  const prompt = [
    "Create one clean image artifact summarizing this agent turn.",
    `Run id: ${input.runId}`,
    `Turn sequence: ${input.sequence}`,
    `Run objective: ${input.runObjective.trim() || "No run objective."}`,
    `Agent: ${input.sourceAgentName}`,
    `Agent task: ${input.sourceAgentObjective.trim() || "No task set."}`,
    `Turn summary: ${input.messageSummary}`,
    `Turn rationale: ${input.messageRationale}`,
    "Output image only.",
  ].join("\n");

  const result = await requestGeminiImageGenerateContentWithRetry({
    model,
    apiKey: resolvedApiKey,
    prompt,
  });

  if (!result.response.ok) {
    return null;
  }

  const inline = parsePrimaryInlineImage(result.parsedBody);
  if (!inline) {
    return null;
  }

  const bytes = Uint8Array.from(Buffer.from(inline.data, "base64"));
  if (bytes.byteLength === 0) {
    return null;
  }

  return {
    model,
    prompt,
    mimeType: inline.mimeType,
    bytes,
    latencyMs: result.latencyMs,
    requestId: result.response.headers.get("x-request-id"),
    statusCode: result.response.status,
  };
}

function buildGeminiFinalDraftPrompt(input: FinalDraftInput): string {
  const runName = input.runName?.trim() || "Untitled run";
  const runObjective = input.runObjective.trim() || "No mission was set.";
  const turnLines = input.turns
    .slice(0, 120)
    .map((turn) => {
      const summary = (turn.summary || "No summary")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 360);
      const rationale = (turn.rationale || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 260);
      const artifactNote =
        turn.artifacts.length > 0
          ? ` artifacts: ${turn.artifacts.map((artifact) => artifact.name).join(", ")}.`
          : "";
      const rationaleNote = rationale.length > 0 ? ` rationale: ${rationale}.` : "";
      return `T${turn.sequence} ${turn.status} ${turn.actorName} -> ${turn.channelName} [${turn.messageType ?? "event"}] ${summary}.${rationaleNote}${artifactNote}`;
    });
  const voteNote = input.vote
    ? [
        `status=${input.vote.status ?? "n/a"}`,
        `outcome=${input.vote.outcome ?? "n/a"}`,
        `winner=${input.vote.winner ?? "n/a"}`,
        `open=${input.vote.openCount}`,
        input.vote.explanation ? `explanation=${input.vote.explanation}` : null,
      ]
        .filter((entry): entry is string => entry !== null)
        .join(" | ")
    : "none";
  const deadlockNote =
    input.deadlock && input.deadlock.status !== "none"
      ? `status=${input.deadlock.status} action=${input.deadlock.action ?? "n/a"} note=${input.deadlock.note ?? "n/a"}`
      : "none";

  return [
    "You are the final drafting engine for Guild.",
    "Create a comprehensive final deliverable from the completed multi-agent run.",
    `Run: ${runName}`,
    `Run status: ${input.runStatus}`,
    `Mission: ${runObjective}`,
    `Votes: ${voteNote}`,
    `Deadlock: ${deadlockNote}`,
    "Turn transcript:",
    ...turnLines,
    "Return JSON only using this shape:",
    JSON.stringify(
      {
        recommendation: "string",
        summary: "string",
        statusLabel: "string",
        sections: [
          {
            id: "string",
            title: "string",
            lines: ["string"],
            sourceSequences: [1],
          },
        ],
        markdown: "string",
      },
      null,
      2,
    ),
    "Requirements:",
    "- Include concrete strategy, execution plan, risks, and success metrics.",
    "- Cite source turn numbers in sourceSequences for each section.",
    "- Keep lines specific and actionable; avoid generic filler.",
    "- Synthesize image/artifact outputs if present.",
    "- Do not include markdown fences.",
  ].join("\n");
}

export async function synthesizeGeminiFinalDraft(
  input: FinalDraftInput & {
    apiKey?: string | null;
  },
): Promise<GeminiFinalDraftSynthesisResult> {
  const fallbackDraft = buildDeterministicFinalDraft(input);
  const modelSelection = selectGeminiModel({
    role: "executive",
    thinkingProfile: "deep",
  });
  const prompt = buildGeminiFinalDraftPrompt(input);
  const resolvedApiKey = (input.apiKey ?? process.env.GEMINI_API_KEY)?.trim() || "";

  if (!resolvedApiKey) {
    return {
      draft: fallbackDraft,
      telemetry: {
        provider: "google-gemini",
        source: "fallback",
        model: modelSelection.model,
        routeReason: `${modelSelection.routeReason}:no-api-key`,
        thinkingLevel: modelSelection.thinkingLevel,
        latencyMs: 0,
        requestId: null,
        statusCode: null,
        tokenUsage: {
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
        },
      },
      rawResponseText: "",
      rawResponse: {
        fallback: true,
        reason: "No GEMINI_API_KEY configured.",
      },
    };
  }

  try {
    const result = await requestGeminiGenerateContentWithRetry({
      model: modelSelection.model,
      apiKey: resolvedApiKey,
      prompt,
      thinkingLevel: modelSelection.thinkingLevel,
      builtInTools: [],
    });

    if (!result.response.ok) {
      return {
        draft: fallbackDraft,
        telemetry: {
          provider: "google-gemini",
          source: "fallback",
          model: modelSelection.model,
          routeReason: `${modelSelection.routeReason}:non-ok`,
          thinkingLevel: modelSelection.thinkingLevel,
          latencyMs: result.latencyMs,
          requestId: result.response.headers.get("x-request-id"),
          statusCode: result.response.status,
          tokenUsage: {
            inputTokens: result.parsedBody.usageMetadata?.promptTokenCount ?? null,
            outputTokens: result.parsedBody.usageMetadata?.candidatesTokenCount ?? null,
            totalTokens: result.parsedBody.usageMetadata?.totalTokenCount ?? null,
          },
        },
        rawResponseText: result.textBody,
        rawResponse: result.parsedBody,
      };
    }

    const rawResponseText = parsePrimaryText(result.parsedBody) || result.textBody;
    const normalizedDraft = normalizeFinalDraftFromModel({
      rawResponseText,
      fallback: fallbackDraft,
    });

    return {
      draft: normalizedDraft,
      telemetry: {
        provider: "google-gemini",
        source: normalizedDraft.synthesisSource === "model" ? "live" : "fallback",
        model: modelSelection.model,
        routeReason: modelSelection.routeReason,
        thinkingLevel: modelSelection.thinkingLevel,
        latencyMs: result.latencyMs,
        requestId: result.response.headers.get("x-request-id"),
        statusCode: result.response.status,
        tokenUsage: {
          inputTokens: result.parsedBody.usageMetadata?.promptTokenCount ?? null,
          outputTokens: result.parsedBody.usageMetadata?.candidatesTokenCount ?? null,
          totalTokens: result.parsedBody.usageMetadata?.totalTokenCount ?? null,
        },
      },
      rawResponseText,
      rawResponse: result.parsedBody,
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message.slice(0, 220) : "Unknown synthesis failure.";
    return {
      draft: fallbackDraft,
      telemetry: {
        provider: "google-gemini",
        source: "fallback",
        model: modelSelection.model,
        routeReason: `${modelSelection.routeReason}:exception`,
        thinkingLevel: modelSelection.thinkingLevel,
        latencyMs: 0,
        requestId: null,
        statusCode: null,
        tokenUsage: {
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
        },
      },
      rawResponseText: "",
      rawResponse: {
        fallback: true,
        reason,
      },
    };
  }
}

export async function executeGeminiTurn(
  input: ExecuteGeminiTurnInput,
): Promise<GeminiTurnExecutionResult> {
  const modelSelection = selectGeminiModel({
    role: input.role,
    thinkingProfile: input.thinkingProfile,
  });
  const prompt = buildGeminiPrompt(input);
  const defaultSummary = `${input.candidate.sourceAgentName} responded to ${input.candidate.targetAgentName}.`;
  const resolvedApiKey = (input.apiKey ?? process.env.GEMINI_API_KEY)?.trim() || "";

  if (!resolvedApiKey) {
    return buildFallbackResult({
      prompt,
      model: modelSelection.model,
      routeReason: modelSelection.routeReason,
      thinkingLevel: modelSelection.thinkingLevel,
      allowedMessageTypes: input.candidate.allowedMessageTypes,
      isLastQueuedTurn: input.isLastQueuedTurn,
      defaultSummary,
      rationale:
        "No GEMINI_API_KEY configured; used deterministic fallback output.",
      statusCode: null,
      rawResponseText: "",
    });
  }

  const primaryResult = await requestGeminiGenerateContentWithRetry({
    model: modelSelection.model,
    apiKey: resolvedApiKey,
    prompt,
    thinkingLevel: modelSelection.thinkingLevel,
    builtInTools: buildGeminiBuiltInTools(input.candidate.sourceAgentTools),
  });

  let effectiveModel = modelSelection.model;
  let effectiveRouteReason = modelSelection.routeReason;
  let effectiveThinkingLevel = modelSelection.thinkingLevel;
  let effectiveResult = primaryResult;
  const primaryHardQuota =
    primaryResult.response.status === 429 &&
    isHardQuotaExhausted(primaryResult.textBody);

  const shouldFallbackToFlash =
    !primaryResult.response.ok &&
    modelSelection.model !== configuredFlashModel() &&
    [403, 404, 429].includes(primaryResult.response.status) &&
    !primaryHardQuota;

  if (shouldFallbackToFlash) {
    const flashModel = configuredFlashModel();
    const flashThinkingLevel = resolveThinkingLevel(
      flashModel,
      input.thinkingProfile,
    );
    const flashResult = await requestGeminiGenerateContentWithRetry({
      model: flashModel,
      apiKey: resolvedApiKey,
      prompt,
      thinkingLevel: flashThinkingLevel,
      builtInTools: buildGeminiBuiltInTools(input.candidate.sourceAgentTools),
    });
    effectiveModel = flashModel;
    effectiveRouteReason = `${modelSelection.routeReason}->flash-fallback`;
    effectiveThinkingLevel = flashThinkingLevel;
    effectiveResult = flashResult;
  }

  if (!effectiveResult.response.ok) {
    const errorText = effectiveResult.textBody.slice(0, 500);
    const hardQuota =
      effectiveResult.response.status === 429 &&
      isHardQuotaExhausted(effectiveResult.textBody);
    throw new GeminiApiError(
      `Gemini request failed (${effectiveResult.response.status}) for model ${effectiveModel}: ${errorText}`,
      isRetryableStatus(effectiveResult.response.status) && !hardQuota,
      effectiveResult.response.status,
    );
  }

  const rawResponseText = parsePrimaryText(effectiveResult.parsedBody);
  const validation = validateAndRepairAgentActOutput({
    rawResponseText: rawResponseText || effectiveResult.textBody,
    allowedMessageTypes: input.candidate.allowedMessageTypes,
    isLastQueuedTurn: input.isLastQueuedTurn,
    fallbackSummary: defaultSummary,
  });
  const normalized = {
    messageType: validation.output.messageType,
    summary: validation.output.summary,
    rationale: validation.output.rationale,
    confidence: validation.output.confidence,
  };

  return {
    prompt,
    structured: validation.output,
    normalized,
    validation: {
      schema: AGENT_ACT_SCHEMA_ID,
      status: validation.status,
      issues: validation.issues,
      repairSteps: validation.repairSteps,
    },
    telemetry: {
      provider: "google-gemini",
      source: "live",
      model: effectiveModel,
      routeReason: effectiveRouteReason,
      thinkingLevel: effectiveThinkingLevel,
      latencyMs: effectiveResult.latencyMs,
      requestId: effectiveResult.response.headers.get("x-request-id"),
      statusCode: effectiveResult.response.status,
      tokenUsage: {
        inputTokens: effectiveResult.parsedBody.usageMetadata?.promptTokenCount ?? null,
        outputTokens:
          effectiveResult.parsedBody.usageMetadata?.candidatesTokenCount ?? null,
        totalTokens: effectiveResult.parsedBody.usageMetadata?.totalTokenCount ?? null,
      },
    },
    rawResponseText: rawResponseText || effectiveResult.textBody,
    rawResponse: effectiveResult.parsedBody,
  };
}
