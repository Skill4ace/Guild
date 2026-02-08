#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const DEFAULT_FLASH_MODEL = "gemini-3-flash-preview";
const DEFAULT_PRO_MODEL = "gemini-3-pro-preview";

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, "utf8");
  const entries = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }

    entries[key] = value;
  }

  return entries;
}

function mergeEnv(...sources) {
  const merged = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      merged[key] = value;
    }
  }
  return merged;
}

function resolveConfig() {
  const cwd = process.cwd();
  const fromDotenv = mergeEnv(
    parseEnvFile(path.join(cwd, ".env")),
    parseEnvFile(path.join(cwd, ".env.local")),
  );

  const env = mergeEnv(fromDotenv, process.env);
  const apiKey = env.GEMINI_API_KEY?.trim() ?? "";

  return {
    apiKey,
    flashModel: env.GEMINI_MODEL_FLASH?.trim() || DEFAULT_FLASH_MODEL,
    proModel: env.GEMINI_MODEL_PRO?.trim() || DEFAULT_PRO_MODEL,
  };
}

async function probeModel({ model, apiKey, thinkingLevel }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: "Return JSON only: {\"probe\":\"ok\"}",
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 1.0,
        thinkingConfig: {
          thinkingLevel,
        },
      },
    }),
  });

  const text = await response.text();
  let summary = "";
  try {
    const parsed = JSON.parse(text);
    summary =
      parsed?.candidates?.[0]?.content?.parts?.[0]?.text?.slice(0, 120) ?? "";
  } catch {
    summary = text.slice(0, 200);
  }

  return {
    ok: response.ok,
    status: response.status,
    model,
    summary: summary.replace(/\s+/g, " ").trim(),
  };
}

async function main() {
  const config = resolveConfig();
  if (!config.apiKey) {
    console.error("GEMINI_API_KEY is not set in environment or .env.local.");
    process.exit(1);
  }

  const probes = [
    { model: config.proModel, thinkingLevel: "high" },
    { model: config.flashModel, thinkingLevel: "medium" },
  ];

  const results = [];
  for (const probe of probes) {
    try {
      const result = await probeModel({
        model: probe.model,
        apiKey: config.apiKey,
        thinkingLevel: probe.thinkingLevel,
      });
      results.push(result);
    } catch (error) {
      results.push({
        ok: false,
        status: 0,
        model: probe.model,
        summary:
          error instanceof Error ? error.message : "Unknown Gemini probe error",
      });
    }
  }

  for (const result of results) {
    console.log(`${result.model}: status ${result.status}`);
    if (result.summary) {
      console.log(`  ${result.summary}`);
    }
  }

  const pro = results.find((result) => result.model === config.proModel);
  const flash = results.find((result) => result.model === config.flashModel);

  if (pro?.ok) {
    console.log("Pro access: available");
  } else {
    console.log("Pro access: unavailable (runtime will use flash fallback)");
  }

  if (!flash?.ok) {
    process.exit(1);
  }
}

void main();
