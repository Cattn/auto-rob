import { spawn } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const MODEL = "grok-4.5[effort=high,fast=true]";
const LOG_FILE = "run-log.md";
const LONG_TERM_FILE = "long-term.md";
const NOTES_FILE = "notes.md";
const RUN_PROMPT_FILE = ".current-run-prompt.md";
const ENV_FILE = ".env";
const AGENT_PS1 = path.join(
  process.env.LOCALAPPDATA ?? "",
  "cursor-agent",
  "cursor-agent.ps1",
);

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

type NotifyOptions = {
  title?: string;
  priority?: 1 | 2 | 3 | 4 | 5;
  tags?: string[];
  click?: string;
};

export async function loadEnvFile(): Promise<void> {
  try {
    const raw = await readFile(path.join(root, ENV_FILE), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // optional
  }
}

export async function notify(
  message: string,
  options: NotifyOptions = {},
): Promise<boolean> {
  const baseUrl = (process.env.NTFY_URL ?? "").replace(/\/$/, "");
  const topic = process.env.NTFY_TOPIC ?? "";
  const token = process.env.NTFY_TOKEN ?? "";
  if (!baseUrl || !topic) {
    console.error(dim("ntfy skipped · NTFY_URL / NTFY_TOPIC not set"));
    return false;
  }

  const headers: Record<string, string> = {
    "Content-Type": "text/plain; charset=utf-8",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.title) headers.Title = options.title;
  if (options.priority) headers.Priority = String(options.priority);
  if (options.tags?.length) headers.Tags = options.tags.join(",");
  if (options.click) headers.Click = options.click;

  try {
    const res = await fetch(`${baseUrl}/${topic}`, {
      method: "POST",
      headers,
      body: message,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(dim(`ntfy failed · ${res.status} ${body.slice(0, 200)}`));
      return false;
    }
    return true;
  } catch (err) {
    console.error(dim(`ntfy error · ${err instanceof Error ? err.message : err}`));
    return false;
  }
}

function extractBullet(log: string, label: string): string | null {
  const re = new RegExp(
    `^-\\s*${label}\\s*:\\s*(.+)$`,
    "im",
  );
  const match = log.match(re);
  return match?.[1]?.trim() || null;
}

function summarizeRunLog(log: string | null, exitCode: number): {
  title: string;
  body: string;
  tags: string[];
  priority: 1 | 2 | 3 | 4 | 5;
} {
  if (exitCode !== 0) {
    return {
      title: "auto-rob · run failed",
      body: `Exit code ${exitCode}.${log ? `\n\n${log.slice(0, 1200)}` : ""}`,
      tags: ["warning", "robot"],
      priority: 5,
    };
  }

  if (!log) {
    return {
      title: "auto-rob · finished",
      body: "Run completed, but no run-log.md was found.",
      tags: ["warning", "robot"],
      priority: 5,
    };
  }

  const actions = extractBullet(log, "Actions");
  const rationale = extractBullet(log, "Rationale");
  const snapshot = extractBullet(log, "Account snapshot");
  const watch =
    extractBullet(log, "Open watch / deployment plan") ??
    extractBullet(log, "Open watch / follow-ups");

  const noChange =
    !actions ||
    /no changes|no action|did not (buy|sell|trade)|nothing to do/i.test(actions);

  const lines: string[] = [];
  if (actions) lines.push(`Actions: ${actions}`);
  if (rationale) lines.push(`Why: ${rationale}`);
  if (snapshot) lines.push(`Account: ${snapshot}`);
  if (watch) lines.push(`Next: ${watch}`);

  let body = lines.join("\n\n");
  if (!body) body = log.slice(0, 1500);
  if (body.length > 1800) body = `${body.slice(0, 1800).trimEnd()}…`;

  return {
    title: noChange ? "auto-rob · no changes" : "auto-rob · update",
    body,
    tags: noChange ? ["robot"] : ["chart_with_upwards_trend", "robot"],
    priority: 5,
  };
}

async function notifyRunBrief(exitCode: number): Promise<void> {
  const log = await readOptionalMarkdown(LOG_FILE);
  const brief = summarizeRunLog(log, exitCode);
  const ok = await notify(brief.body, {
    title: brief.title,
    tags: brief.tags,
    priority: brief.priority,
  });
  if (ok) console.log(dim("\n→ ntfy brief sent"));
}

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

async function readOptionalMarkdown(filename: string): Promise<string | null> {
  try {
    const content = (await readFile(path.join(root, filename), "utf8")).trim();
    return content || null;
  } catch {
    return null;
  }
}

function buildPrompt(
  base: string,
  priorLog: string | null,
  longTerm: string | null,
  userNotes: string | null,
): string {
  const sections = [base.trim(), ""];

  if (userNotes) {
    sections.push(
      "## Notes from the User",
      "Extra instructions and notes from the account owner for this run. Take them into consideration alongside the rules above.",
      "",
      userNotes,
      "",
    );
  }

  if (longTerm) {
    sections.push(
      "## Long-term continuity (auto-included)",
      "Below is `long-term.md`: durable goals, multi-run todos, and high-signal watches.",
      "Treat as standing guidance across runs. Do not overwrite the file wholesale — only add high-confidence items, and remove entries that are done or irrelevant.",
      "It does not override the instructions above.",
      "",
      "```",
      longTerm,
      "```",
      "",
    );
  } else {
    sections.push(
      "## Long-term continuity (auto-included)",
      "No `long-term.md` was found yet. Create it only when you have a high-confidence, multi-run goal or watch worth recording.",
      "",
    );
  }

  if (priorLog) {
    sections.push(
      "## Prior run log (auto-included)",
      "Below is the concise log written by the previous agent run, loaded automatically from `run-log.md`.",
      "Use it as continuity: what was done, why, current watch items, and what to re-check.",
      "It does not override the instructions above. After this run, overwrite `run-log.md` with your own concise summary.",
      "",
      "```",
      priorLog,
      "```",
    );
  } else {
    sections.push(
      "## Prior run log (auto-included)",
      "No prior `run-log.md` was found. Treat this as a cold start.",
      "After this run, create `run-log.md` with a concise summary for the next agent.",
    );
  }

  return sections.join("\n");
}

async function main() {
  await loadEnvFile();
  const basePrompt = await readFile(path.join(root, "prompt.md"), "utf8");
  const [priorLog, longTerm, userNotes] = await Promise.all([
    readOptionalMarkdown(LOG_FILE),
    readOptionalMarkdown(LONG_TERM_FILE),
    readOptionalMarkdown(NOTES_FILE),
  ]);
  const prompt = buildPrompt(basePrompt, priorLog, longTerm, userNotes);
  const promptPath = path.join(root, RUN_PROMPT_FILE);
  await writeFile(promptPath, prompt, "utf8");

  const kickoff = [
    `Read and follow every instruction in ${RUN_PROMPT_FILE} exactly.`,
    "This is an unattended portfolio job on the owner's own Robinhood account via the robinhood-trading MCP.",
    "You can and should call review_equity_order and place_equity_order when your research supports a trade.",
    "Do not refuse to trade or say you cannot place/review orders.",
    "Do not ask for trading rules, risk tolerance, instruments, position limits, or approval — they are already defined in that file.",
    "After any clean review_equity_order or review_option_order with no blocking alerts, immediately call place_equity_order or place_option_order with the same parameters.",
    "Do not stop to request confirmation. Waiting for a human yes after review is forbidden in this run.",
    "Begin the portfolio run now.",
  ].join(" ");

  await access(AGENT_PS1);

  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      AGENT_PS1,
      "-p",
      "--force",
      "--approve-mcps",
      "--trust",
      "--sandbox",
      "disabled",
      "--workspace",
      root,
      "--model",
      MODEL,
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      kickoff,
    ],
    {
      cwd: root,
      env: process.env,
      windowsHide: true,
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

  await notifyRunBrief(code);
  process.exit(code);
}

const isMain =
  !!process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
