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

export function configPath(workspace: string): string {
  return path.join(workspace, CONFIG_FILE);
}

function defaultModels(): Record<HarnessId, string> {
  return { ...DEFAULT_MODELS };
}

function normalizeModels(
  raw: Partial<Record<HarnessId, string>> | undefined,
): Record<HarnessId, string> {
  const models = defaultModels();
  if (!raw || typeof raw !== "object") return models;
  for (const id of HARNESS_IDS) {
    if (typeof raw[id] === "string") {
      models[id] = raw[id]!.trim();
    }
  }
  return models;
}

export async function readConfig(workspace: string): Promise<AutoRobConfig> {
  let activeHarness = DEFAULT_HARNESS;
  let models = defaultModels();

  try {
    const raw = await readFile(configPath(workspace), "utf8");
    const parsed = JSON.parse(raw) as {
      activeHarness?: string;
      models?: Partial<Record<HarnessId, string>>;
    };
    if (parsed.activeHarness && isHarnessId(parsed.activeHarness)) {
      activeHarness = parsed.activeHarness;
    }
    models = normalizeModels(parsed.models);
  } catch {
    // missing or invalid — defaults
  }

  const envOverride = process.env.AUTO_ROB_HARNESS?.trim();
  if (envOverride && isHarnessId(envOverride)) {
    activeHarness = envOverride;
  }

  return { activeHarness, models };
}

export async function writeConfig(
  workspace: string,
  next: AutoRobConfig,
): Promise<void> {
  await writeFile(
    configPath(workspace),
    `${JSON.stringify(next, null, 2)}\n`,
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
  const models = { ...current.models, [id]: model.trim() };
  await writeConfig(workspace, { ...current, models });
  return models;
}
