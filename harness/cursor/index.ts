import spawn from "cross-spawn";
import { resolveAgentCommand } from "../../resolve-agent.js";
import { getHarnessModel } from "../config.js";
import {
  DEFAULT_MODELS,
  HARNESS_LABELS,
  type AgentHarness,
  type ConnectOptions,
  type HarnessConnection,
  type HarnessRunInput,
} from "../types.js";
import { bold, consumeJsonLines, dim } from "../util.js";
import {
  enableCursorMcp,
  ensureGlobalMcpJson,
  loginCursorMcp,
  readGlobalMcpConfigured,
  versionOk,
} from "./mcp.js";

type StreamEvent = {
  type?: string;
  subtype?: string;
  model?: string;
  duration_ms?: number;
  timestamp_ms?: number;
  model_call_id?: string;
  message?: { content?: Array<{ text?: string }> };
  tool_call?: Record<string, { args?: unknown; result?: unknown }>;
};

function toolLabel(event: StreamEvent): string {
  const name = Object.keys(event.tool_call ?? {})[0] ?? "tool";
  const args = event.tool_call?.[name]?.args;
  if (!args || typeof args !== "object") return name;
  const values = Object.values(args as Record<string, unknown>)
    .filter((v) => typeof v === "string" || typeof v === "number")
    .slice(0, 2);
  return values.length ? `${name}(${values.join(", ")})` : name;
}

function handleEvent(
  event: StreamEvent,
  state: { started: boolean; tools: number; modelLabel: string },
) {
  switch (event.type) {
    case "system":
      if (event.subtype === "init") {
        console.log(
          dim(`${bold(event.model ?? state.modelLabel)} - streaming\n`),
        );
      }
      break;

    case "assistant": {
      const isDelta =
        event.timestamp_ms !== undefined && event.model_call_id === undefined;
      if (!isDelta) break;
      const content = event.message?.content?.[0]?.text ?? "";
      if (!content) break;
      if (!state.started) {
        state.started = true;
        process.stdout.write("\n");
      }
      process.stdout.write(content);
      break;
    }

    case "tool_call":
      if (event.subtype === "started") {
        state.tools += 1;
        console.log(dim(`\n-> ${toolLabel(event)}`));
      }
      break;

    case "result": {
      const sec = ((event.duration_ms ?? 0) / 1000).toFixed(1);
      console.log(dim(`\n\nok - done - ${sec}s - ${state.tools} tools`));
      break;
    }
  }
}

export function createCursorHarness(workspace: string): AgentHarness {
  const label = HARNESS_LABELS.cursor;

  return {
    id: "cursor",
    label,

    resolve() {
      return resolveAgentCommand();
    },

    async status(): Promise<HarnessConnection> {
      const model = await getHarnessModel(workspace, "cursor");
      try {
        const binaryPath = await resolveAgentCommand();
        const ver = await versionOk(binaryPath, workspace);
        if (!ver.ok) {
          return {
            id: "cursor",
            label,
            binaryPath,
            binaryOk: false,
            mcpConfigured: false,
            mcpAuthenticated: false,
            model,
            error: "agent --version failed",
          };
        }
        const mcpConfigured = await readGlobalMcpConfigured();
        return {
          id: "cursor",
          label,
          binaryPath,
          binaryOk: true,
          mcpConfigured,
          mcpAuthenticated: mcpConfigured,
          model,
          error: null,
        };
      } catch (err) {
        return {
          id: "cursor",
          label,
          binaryPath: null,
          binaryOk: false,
          mcpConfigured: false,
          mcpAuthenticated: false,
          model,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async connect(opts: ConnectOptions = {}): Promise<HarnessConnection> {
      const login = opts.login !== false;
      const binaryPath = await resolveAgentCommand();
      await ensureGlobalMcpJson();
      console.log(dim("approving Robinhood MCP for Cursor CLI…"));
      const enabled = await enableCursorMcp(binaryPath, workspace);
      if (enabled.output) console.log(enabled.output);
      const enableText = enabled.output.toLowerCase();
      const enableOk =
        enabled.code === 0 ||
        enableText.includes("already") ||
        enableText.includes("enabled");
      if (!enableOk) {
        throw new Error(
          enabled.output || `agent mcp enable failed (exit ${enabled.code})`,
        );
      }
      if (login) {
        console.log(dim("starting Robinhood OAuth via Cursor CLI…"));
        const result = await loginCursorMcp(binaryPath, workspace);
        if (result.output) console.log(result.output);
        const loginText = result.output.toLowerCase();
        const loginOk =
          result.code === 0 ||
          loginText.includes("already") ||
          loginText.includes("authenticated");
        if (!loginOk) {
          throw new Error(
            result.output || `agent mcp login failed (exit ${result.code})`,
          );
        }
      }
      return this.status();
    },

    async run(input: HarnessRunInput): Promise<number> {
      const agent = await resolveAgentCommand();
      const model =
        (await getHarnessModel(workspace, "cursor")) ||
        DEFAULT_MODELS.cursor;
      console.log(dim(`harness: cursor`));
      console.log(dim(`agent: ${agent}`));
      console.log(dim(`model: ${model}`));

      const argv = [
        "-p",
        "--approve-mcps",
        "--trust",
        "--sandbox",
        "disabled",
        "--workspace",
        input.workspace,
        "--model",
        model,
        "--output-format",
        "stream-json",
        "--stream-partial-output",
        input.kickoff,
      ];

      const child = spawn(agent, argv, {
        cwd: input.workspace,
        env: process.env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      if (!child) {
        throw new Error("Failed to spawn cursor agent");
      }
      input.onSpawn?.(child);

      const state = { started: false, tools: 0, modelLabel: model };
      const buffer = { value: "" };

      const consume = (chunk: string) => {
        consumeJsonLines(chunk, buffer, (line) => {
          try {
            handleEvent(JSON.parse(line) as StreamEvent, state);
          } catch {
            // ignore non-json noise
          }
        });
      };

      if (!child.stdout || !child.stderr) {
        throw new Error("Failed to capture agent stdout/stderr");
      }
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", consume);
      child.stderr.on("data", (chunk: string) => {
        const text = chunk.trim();
        if (text) console.error(dim(text));
      });

      return new Promise<number>((resolve, reject) => {
        const onAbort = () => {
          child.kill();
        };
        if (input.signal) {
          if (input.signal.aborted) {
            onAbort();
          } else {
            input.signal.addEventListener("abort", onAbort, { once: true });
          }
        }
        child.on("error", (err) => {
          input.signal?.removeEventListener("abort", onAbort);
          reject(err);
        });
        child.on("close", (exitCode) => {
          input.signal?.removeEventListener("abort", onAbort);
          if (buffer.value.trim()) {
            try {
              handleEvent(JSON.parse(buffer.value) as StreamEvent, state);
            } catch {
              // ignore
            }
          }
          resolve(exitCode ?? 1);
        });
      });
    },
  };
}
