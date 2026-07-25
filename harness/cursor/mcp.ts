import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { MCP_NAME, MCP_URL } from "../types.js";
import { runCommand } from "../util.js";

type McpFile = {
  mcpServers?: Record<string, { url?: string; [key: string]: unknown }>;
};

function globalMcpJsonPath(): string {
  return path.join(homedir(), ".cursor", "mcp.json");
}

export async function readGlobalMcpConfigured(): Promise<boolean> {
  try {
    const raw = await readFile(globalMcpJsonPath(), "utf8");
    const parsed = JSON.parse(raw) as McpFile;
    const entry = parsed.mcpServers?.[MCP_NAME];
    return Boolean(entry?.url === MCP_URL || entry);
  } catch {
    return false;
  }
}

export async function probeCursorMcpAuthenticated(
  agent: string,
  workspace: string,
): Promise<boolean> {
  const result = await runCommand(
    agent,
    ["mcp", "list-tools", MCP_NAME],
    workspace,
  );
  const text = `${result.stdout}\n${result.stderr}`.trim();
  const lower = text.toLowerCase();
  if (result.code !== 0) return false;
  if (
    lower.includes("requires authentication") ||
    lower.includes("mcp login") ||
    lower.includes("needsauth")
  ) {
    return false;
  }
  return /get_accounts|get_portfolio|place_equity_order/i.test(text);
}

export async function ensureGlobalMcpJson(): Promise<void> {
  const filePath = globalMcpJsonPath();
  await mkdir(path.dirname(filePath), { recursive: true });

  let parsed: McpFile = { mcpServers: {} };
  try {
    const raw = await readFile(filePath, "utf8");
    parsed = JSON.parse(raw) as McpFile;
    if (!parsed.mcpServers || typeof parsed.mcpServers !== "object") {
      parsed.mcpServers = {};
    }
  } catch {
    parsed = { mcpServers: {} };
  }

  const existing = parsed.mcpServers![MCP_NAME];
  if (existing?.url === MCP_URL) return;

  parsed.mcpServers![MCP_NAME] = { url: MCP_URL };
  await writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

export async function enableCursorMcp(
  agent: string,
  workspace: string,
): Promise<{ code: number; output: string }> {
  const result = await runCommand(
    agent,
    ["mcp", "enable", MCP_NAME],
    workspace,
  );
  return {
    code: result.code,
    output: `${result.stdout}\n${result.stderr}`.trim(),
  };
}

export async function loginCursorMcp(
  agent: string,
  workspace: string,
): Promise<{ code: number; output: string }> {
  const result = await runCommand(
    agent,
    ["mcp", "login", MCP_NAME],
    workspace,
  );
  return {
    code: result.code,
    output: `${result.stdout}\n${result.stderr}`.trim(),
  };
}

export async function versionOk(
  agent: string,
  workspace: string,
): Promise<{
  ok: boolean;
  version: string | null;
}> {
  const result = await runCommand(agent, ["--version"], workspace);
  const version =
    `${result.stdout}\n${result.stderr}`.trim().split(/\r?\n/)[0] ?? "";
  return {
    ok: result.code === 0 && Boolean(version),
    version: version || null,
  };
}
