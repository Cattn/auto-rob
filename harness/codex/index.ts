import spawn from "cross-spawn";
import { resolveCodexCommand } from "../../resolve-codex.js";
import { getHarnessModel } from "../config.js";
import {
  HARNESS_LABELS,
  type AgentHarness,
  type ConnectOptions,
  type HarnessConnection,
  type HarnessRunInput,
} from "../types.js";
import { consumeJsonLines, dim } from "../util.js";
import {
  codexConnectForWorkspace,
  codexStatusForWorkspace,
} from "./mcp.js";

type CodexEvent = {
  type?: string;
  item?: {
    type?: string;
    text?: string;
    command?: string;
    server?: string;
    tool?: string;
  };
  message?: string;
  error?: { message?: string };
};

function handleCodexEvent(
  event: CodexEvent,
  state: { started: boolean; tools: number; modelLabel: string },
) {
  switch (event.type) {
    case "thread.started":
    case "turn.started":
      if (!state.started) {
        state.started = true;
        const label = state.modelLabel || "codex";
        console.log(dim(`${label} - streaming\n`));
      }
      break;

    case "item.started": {
      const item = event.item;
      if (!item) break;
      if (item.type === "command_execution" && item.command) {
        state.tools += 1;
        console.log(dim(`\n-> shell(${item.command})`));
      } else if (item.type === "mcp_tool_call") {
        state.tools += 1;
        const label = item.tool ?? item.server ?? "mcp";
        console.log(dim(`\n-> ${label}`));
      }
      break;
    }

    case "item.completed": {
      const text = event.item?.text;
      if (text) {
        if (!state.started) {
          state.started = true;
          process.stdout.write("\n");
        }
        process.stdout.write(text);
        if (!text.endsWith("\n")) process.stdout.write("\n");
      }
      break;
    }

    case "turn.completed":
      console.log(dim(`\n\nok - done - ${state.tools} tools`));
      break;

    case "turn.failed":
    case "error": {
      const msg =
        event.error?.message ?? event.message ?? event.item?.text ?? "failed";
      console.error(dim(`\nerror - ${msg}`));
      break;
    }

    default:
      break;
  }
}

export function createCodexHarness(workspace: string): AgentHarness {
  return {
    id: "codex",
    label: HARNESS_LABELS.codex,

    resolve() {
      return resolveCodexCommand();
    },

    status(): Promise<HarnessConnection> {
      return codexStatusForWorkspace(workspace);
    },

    connect(opts?: ConnectOptions): Promise<HarnessConnection> {
      return codexConnectForWorkspace(workspace, opts);
    },

    async run(input: HarnessRunInput): Promise<number> {
      const codex = await resolveCodexCommand();
      const model = await getHarnessModel(workspace, "codex");
      console.log(dim(`harness: codex`));
      console.log(dim(`codex: ${codex}`));
      console.log(dim(`model: ${model || "(default)"}`));

      const argv = [
        "exec",
        "--json",
        "--sandbox",
        "danger-full-access",
        "-c",
        "approval_policy=never",
      ];
      if (model) {
        argv.push("-m", model);
      }
      argv.push(input.kickoff);

      const child = spawn(codex, argv, {
        cwd: input.workspace,
        env: process.env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      if (!child) {
        throw new Error("Failed to spawn codex");
      }
      input.onSpawn?.(child);

      const state = { started: false, tools: 0, modelLabel: model };
      const buffer = { value: "" };

      const consume = (chunk: string) => {
        consumeJsonLines(chunk, buffer, (line) => {
          try {
            handleCodexEvent(JSON.parse(line) as CodexEvent, state);
          } catch {
            // ignore non-json noise
          }
        });
      };

      if (!child.stdout || !child.stderr) {
        throw new Error("Failed to capture codex stdout/stderr");
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
              handleCodexEvent(JSON.parse(buffer.value) as CodexEvent, state);
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
