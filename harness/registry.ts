import { readConfig, writeActiveHarness } from "./config.js";
import { createCodexHarness } from "./codex/index.js";
import { createCursorHarness } from "./cursor/index.js";
import {
  HARNESS_IDS,
  isHarnessId,
  type AgentHarness,
  type HarnessConnection,
  type HarnessId,
} from "./types.js";

export function getHarness(id: HarnessId, workspace: string): AgentHarness {
  switch (id) {
    case "cursor":
      return createCursorHarness(workspace);
    case "codex":
      return createCodexHarness(workspace);
    default: {
      const _exhaustive: never = id;
      throw new Error(`Unknown harness: ${_exhaustive}`);
    }
  }
}

export async function getActiveHarnessId(
  workspace: string,
): Promise<HarnessId> {
  const config = await readConfig(workspace);
  return config.activeHarness;
}

export async function getActiveHarness(
  workspace: string,
): Promise<AgentHarness> {
  const id = await getActiveHarnessId(workspace);
  return getHarness(id, workspace);
}

export async function listHarnessStatuses(
  workspace: string,
): Promise<HarnessConnection[]> {
  const results: HarnessConnection[] = [];
  for (const id of HARNESS_IDS) {
    results.push(await getHarness(id, workspace).status());
  }
  return results;
}

export async function setActiveHarness(
  workspace: string,
  id: HarnessId,
): Promise<void> {
  if (!isHarnessId(id)) {
    throw new Error(`Invalid harness id: ${id}`);
  }
  const status = await getHarness(id, workspace).status();
  if (!status.binaryOk) {
    throw new Error(
      status.error ??
        `${status.label} CLI not found. Connect/install it before making it active.`,
    );
  }
  await writeActiveHarness(workspace, id);
}

export type { AgentHarness, HarnessConnection, HarnessId };
export { DEFAULT_MODELS, HARNESS_LABELS, isHarnessId } from "./types.js";
