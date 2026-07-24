import type { ChildProcess } from "node:child_process";

export type HarnessId = "cursor" | "codex";

export type HarnessConnection = {
  id: HarnessId;
  binaryPath: string | null;
  binaryOk: boolean;
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
export const MCP_URL = "https://agent.robinhood.com/mcp/trading";

export const HARNESS_LABELS: Record<HarnessId, string> = {
  cursor: "Cursor",
  codex: "ChatGPT (Codex)",
};

export const DEFAULT_MODELS: Record<HarnessId, string> = {
  cursor: "grok-4.5[effort=high,fast=true]",
  codex: "",
};

export const HARNESS_IDS: HarnessId[] = ["cursor", "codex"];

export function isHarnessId(value: string): value is HarnessId {
  return value === "cursor" || value === "codex";
}
