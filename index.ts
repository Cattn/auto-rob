//todo: setup automations to automatically generate reports of the portfolio, & suggest changes.

// https://cursor.com/docs/cli/headless#real-time-progress-tracking

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const MODEL = "composer-2.5";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

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
  state: { started: boolean; tools: number },
) {
  switch (event.type) {
    case "system":
      if (event.subtype === "init") {
        console.log(dim(`${bold(event.model ?? MODEL)} · streaming\n`));
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
        console.log(dim(`\n→ ${toolLabel(event)}`));
      }
      break;

    case "result": {
      const sec = ((event.duration_ms ?? 0) / 1000).toFixed(1);
      console.log(dim(`\n\n✓ done · ${sec}s · ${state.tools} tools`));
      break;
    }
  }
}

async function main() {
  const prompt = (await readFile(path.join(root, "prompt.md"), "utf8")).trim();

  const child = spawn(
    "agent",
    [
      "-p",
      "--force",
      "--model",
      MODEL,
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      prompt,
    ],
    {
      cwd: root,
      env: process.env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const state = { started: false, tools: 0 };
  let buffer = "";

  const consume = (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        handleEvent(JSON.parse(line) as StreamEvent, state);
      } catch {
        // ignore non-json noise
      }
    }
  };

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", consume);
  child.stderr.on("data", (chunk: string) => {
    const text = chunk.trim();
    if (text) console.error(dim(text));
  });

  const code = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (buffer.trim()) {
        try {
          handleEvent(JSON.parse(buffer) as StreamEvent, state);
        } catch {
          // ignore
        }
      }
      resolve(exitCode ?? 1);
    });
  });

  process.exit(code);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
