import { resolveCodexCommand } from "../../resolve-codex.js";
import { getHarnessModel } from "../config.js";
import {
  HARNESS_LABELS,
  MCP_NAME,
  MCP_URL,
  type ConnectOptions,
  type HarnessConnection,
} from "../types.js";
import { dim, runCommand } from "../util.js";

export async function codexVersion(
  codex: string,
  workspace: string,
): Promise<{ ok: boolean; version: string | null }> {
  const result = await runCommand(codex, ["--version"], workspace);
  const version =
    `${result.stdout}\n${result.stderr}`.trim().split(/\r?\n/)[0] ?? "";
  return {
    ok: result.code === 0 && Boolean(version),
    version: version || null,
  };
}

export async function listCodexMcp(
  codex: string,
  workspace: string,
): Promise<{ code: number; text: string; configured: boolean; authenticated: boolean }> {
  const listed = await runCommand(codex, ["mcp", "list", "--json"], workspace);
  const text = `${listed.stdout}\n${listed.stderr}`.trim();
  let configured = false;
  let authenticated = false;
  if (listed.code === 0) {
    try {
      const servers = JSON.parse(listed.stdout) as Array<{
        name: string;
        enabled: boolean;
        auth_status: string;
        transport: { type: string; url?: string };
      }>;
      const server = servers.find((entry) => entry.name === MCP_NAME);
      configured = Boolean(server?.enabled === true &&
        server.transport?.type === "streamable_http" && server.transport.url === MCP_URL);
      const auth = server?.auth_status?.replaceAll("_", "").toLowerCase();
      authenticated = configured && (auth === "oauth" || auth === "bearertoken");
    } catch {
      // Unrecognized output must not advertise a ready trading connection.
    }
  }
  return {
    code: listed.code,
    text,
    configured,
    authenticated,
  };
}

export async function codexLoginStatus(codex: string, workspace: string): Promise<boolean> {
  const result = await runCommand(codex, ["login", "status"], workspace);
  return result.code === 0;
}

export async function ensureCodexMcp(
  codex: string,
  workspace: string,
): Promise<void> {
  const listed = await listCodexMcp(codex, workspace);
  if (listed.configured) return;

  console.log(dim(`adding ${MCP_NAME}…`));
  const added = await runCommand(
    codex,
    ["mcp", "add", MCP_NAME, "--url", MCP_URL],
    workspace,
  );
  const addText = `${added.stdout}\n${added.stderr}`.trim();
  if (addText) console.log(addText);
  if (added.code !== 0) {
    throw new Error(addText || `codex mcp add failed (exit ${added.code})`);
  }
}

export async function loginCodexMcp(
  codex: string,
  workspace: string,
): Promise<{ code: number; output: string }> {
  console.log(
    dim(`starting OAuth for ${MCP_NAME} (finish in browser + Robinhood app)…`),
  );
  const login = await runCommand(codex, ["mcp", "login", MCP_NAME], workspace);
  return {
    code: login.code,
    output: `${login.stdout}\n${login.stderr}`.trim(),
  };
}

export async function codexStatusForWorkspace(
  workspace: string,
): Promise<HarnessConnection> {
  const label = HARNESS_LABELS.codex;
  const model = await getHarnessModel(workspace, "codex");
  try {
    const binaryPath = await resolveCodexCommand();
    const ver = await codexVersion(binaryPath, workspace);
    if (!ver.ok) {
      return {
        id: "codex",
        label,
        binaryPath,
        binaryOk: false,
        agentAuthenticated: false,
        mcpConfigured: false,
        mcpAuthenticated: false,
        model,
        error: "codex --version failed",
      };
    }
    const [listed, agentAuthenticated] = await Promise.all([
      listCodexMcp(binaryPath, workspace),
      codexLoginStatus(binaryPath, workspace),
    ]);
    if (listed.code !== 0) {
      return {
        id: "codex",
        label,
        binaryPath,
        binaryOk: true,
        agentAuthenticated,
        mcpConfigured: false,
        mcpAuthenticated: false,
        model,
        error: listed.text || `codex mcp list failed (exit ${listed.code})`,
      };
    }
    return {
      id: "codex",
      label,
      binaryPath,
      binaryOk: true,
      agentAuthenticated,
      mcpConfigured: listed.configured,
      mcpAuthenticated: listed.authenticated,
      model,
      error: !agentAuthenticated
        ? "Sign in to ChatGPT using Connect before running auto-rob."
        : listed.authenticated ? null : "Connect Robinhood before running auto-rob.",
    };
  } catch (err) {
    return {
      id: "codex",
      label,
      binaryPath: null,
      binaryOk: false,
      agentAuthenticated: false,
      mcpConfigured: false,
      mcpAuthenticated: false,
      model,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function codexConnectForWorkspace(
  workspace: string,
  opts: ConnectOptions = {},
): Promise<HarnessConnection> {
  const login = opts.login !== false;
  const codex = await resolveCodexCommand();
  if (login && !(await codexLoginStatus(codex, workspace))) {
    console.log(dim("starting ChatGPT sign-in (finish in browser)…"));
    const result = await runCommand(codex, ["login"], workspace);
    if (result.code !== 0 || !(await codexLoginStatus(codex, workspace))) {
      throw new Error("ChatGPT sign-in failed. Try Connect again.");
    }
  }
  await ensureCodexMcp(codex, workspace);
  if (login) {
    const result = await loginCodexMcp(codex, workspace);
    if (result.output) console.log(result.output);
    if (result.code !== 0) {
      throw new Error(
        result.output || `codex mcp login failed (exit ${result.code})`,
      );
    }
  }
  return codexStatusForWorkspace(workspace);
}
