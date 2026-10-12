import type { ChildProcess } from "node:child_process";

export type HarnessId = "cursor" | "codex";

export type ModelSettings = {
  reasoningEffort: string;
  contextWindow: number | null;
};

export type HarnessSelection = ModelSettings & { model: string };

export type HarnessModel = {
  id: string;
  label: string;
  description: string;
  isDefault: boolean;
  reasoningEfforts: { value: string; description: string }[];
  defaultReasoningEffort: string;
  contextWindow: number | null;
  maxContextWindow: number | null;
};

export type ModelCatalog = {
  models: HarnessModel[];
  error: string | null;
};

export type HarnessConnection = {
  id: HarnessId;
  binaryPath: string | null;
  binaryOk: boolean;
  agentAuthenticated?: boolean;
  mcpConfigured: boolean;
  mcpAuthenticated: boolean;
  label: string;
  model: string;
  error: string | null;
};

export type HarnessRunInput = {
  workspace: string;
  kickoff: string;
  promptPath: string;
  signal?: AbortSignal;
  onSpawn?: (child: ChildProcess) => void;
  selection?: HarnessSelection;
};

export type ConnectOptions = {
  login?: boolean;
};

export interface AgentHarness {
  id: HarnessId;
  label: string;
  resolve(): Promise<string>;
  status(): Promise<HarnessConnection>;
  connect(opts?: ConnectOptions): Promise<HarnessConnection>;
  run(input: HarnessRunInput): Promise<number>;
}

export const MCP_NAME = "robinhood-trading";

export function isHarnessReady(h: HarnessConnection): boolean {
  return h.binaryOk && h.mcpConfigured && h.mcpAuthenticated &&
    (h.id !== "codex" || h.agentAuthenticated === true);
}
export const MCP_URL = "https://agent.robinhood.com/mcp/trading";

export const HARNESS_LABELS: Record<HarnessId, string> = {
  cursor: "Cursor",
  codex: "ChatGPT (Codex)",
};

export const DEFAULT_MODELS: Record<HarnessId, string> = {
  cursor: "cursor-grok-4.5-high-fast",
  codex: "",
};

export const HARNESS_IDS: HarnessId[] = ["cursor", "codex"];

export function isHarnessId(value: string): value is HarnessId {
  return value === "cursor" || value === "codex";
}
