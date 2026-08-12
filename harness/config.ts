import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_MODELS,
  HARNESS_IDS,
  isHarnessId,
  type HarnessId,
} from "./types.js";

export type AutoRobConfig = {
  activeHarness: HarnessId;
  models: Record<HarnessId, string>;
};

const CONFIG_FILE = "auto-rob.config.json";
const DEFAULT_HARNESS: HarnessId = "cursor";

const LEGACY_MODEL_IDS: Record<string, string> = {
  "grok-4.5[effort=high,fast=true]": "cursor-grok-4.5-high-fast",
  "grok-4.5[effort=high]": "cursor-grok-4.5-high",
  "grok-4.5[effort=medium,fast=true]": "cursor-grok-4.5-medium-fast",
  "grok-4.5[effort=medium]": "cursor-grok-4.5-medium",
  "grok-4.5[effort=low,fast=true]": "cursor-grok-4.5-low-fast",
  "grok-4.5[effort=low]": "cursor-grok-4.5-low",
  "grok-4.5-high-fast": "cursor-grok-4.5-high-fast",
  "grok-4.5-high": "cursor-grok-4.5-high",
  "grok-4.5-medium-fast": "cursor-grok-4.5-medium-fast",
  "grok-4.5-medium": "cursor-grok-4.5-medium",
  "grok-4.5-low-fast": "cursor-grok-4.5-low-fast",
  "grok-4.5-low": "cursor-grok-4.5-low",
};

export function configPath(workspace: string): string {
  return path.join(workspace, CONFIG_FILE);
}

function defaultModels(): Record<HarnessId, string> {
  return { ...DEFAULT_MODELS };
}

export function migrateModelId(model: string): string {
  const trimmed = model.trim();
  return LEGACY_MODEL_IDS[trimmed] ?? trimmed;
}

function normalizeModels(
  raw: Partial<Record<HarnessId, string>> | undefined,
): Record<HarnessId, string> {
  const models = defaultModels();
  if (!raw || typeof raw !== "object") return models;
  for (const id of HARNESS_IDS) {
    if (typeof raw[id] === "string") {
      models[id] = migrateModelId(raw[id]!);
    }
  }
  return models;
}

function needsModelMigration(
  raw: Partial<Record<HarnessId, string>> | undefined,
): boolean {
  if (!raw || typeof raw !== "object") return false;
  return HARNESS_IDS.some((id) => {
    const value = raw[id];
    return typeof value === "string" && migrateModelId(value) !== value.trim();
  });
}

async function readRawConfig(
  workspace: string,
): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(configPath(workspace), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      return { ...(parsed as Record<string, unknown>) };
    }
  } catch {
    // missing or invalid
  }
  return {};
}

export async function readConfig(workspace: string): Promise<AutoRobConfig> {
  let activeHarness = DEFAULT_HARNESS;
  let models = defaultModels();
  let rawModels: Partial<Record<HarnessId, string>> | undefined;

  try {
    const file = await readRawConfig(workspace);
    if (file.activeHarness && isHarnessId(String(file.activeHarness))) {
      activeHarness = file.activeHarness as HarnessId;
    }
    if (file.models && typeof file.models === "object") {
      rawModels = file.models as Partial<Record<HarnessId, string>>;
      models = normalizeModels(rawModels);
    }
  } catch {
    // missing or invalid — defaults
  }

  const envOverride = process.env.AUTO_ROB_HARNESS?.trim();
  if (envOverride && isHarnessId(envOverride)) {
    activeHarness = envOverride;
  }

  if (needsModelMigration(rawModels)) {
    await writeConfig(workspace, { activeHarness, models });
  }

  return { activeHarness, models };
}

export async function writeConfig(
  workspace: string,
  next: AutoRobConfig,
): Promise<void> {
  const raw = await readRawConfig(workspace);
  raw.activeHarness = next.activeHarness;
  raw.models = next.models;
  await writeFile(
    configPath(workspace),
    `${JSON.stringify(raw, null, 2)}\n`,
    "utf8",
  );
}

export async function writeActiveHarness(
  workspace: string,
  id: HarnessId,
): Promise<void> {
  const current = await readConfig(workspace);
  await writeConfig(workspace, { ...current, activeHarness: id });
}

export async function getHarnessModel(
  workspace: string,
  id: HarnessId,
): Promise<string> {
  const config = await readConfig(workspace);
  return config.models[id] ?? DEFAULT_MODELS[id];
}

export async function getHarnessModels(
  workspace: string,
): Promise<Record<HarnessId, string>> {
  const config = await readConfig(workspace);
  return { ...config.models };
}

export async function setHarnessModel(
  workspace: string,
  id: HarnessId,
  model: string,
): Promise<Record<HarnessId, string>> {
  if (!isHarnessId(id)) {
    throw new Error(`Invalid harness id: ${id}`);
  }
  const current = await readConfig(workspace);
  const models = { ...current.models, [id]: migrateModelId(model) };
  await writeConfig(workspace, { ...current, models });
  return models;
}
