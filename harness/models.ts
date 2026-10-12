import spawn from "cross-spawn";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { resolveAgentCommand } from "../resolve-agent.js";
import { resolveCodexCommand } from "../resolve-codex.js";
import type { HarnessId, HarnessModel, HarnessSelection } from "./types.js";
import { consumeJsonLines, killProcessTree, runCommand } from "./util.js";

export function parseCursorModels(output: string): HarnessModel[] {
  const models: HarnessModel[] = [];
  const clean = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  for (const line of clean.split(/\r?\n/)) {
    const match = line.match(/^\s*([\w.-]+(?:\[[^\]]+\])?)\s+-\s+(.+?)\s*$/);
    if (!match || models.some((model) => model.id === match[1])) continue;
    models.push({
      id: match[1],
      label: match[2].replace(/\s*\(default\)\s*$/i, ""),
      description: "",
      isDefault: /\(default\)\s*$/i.test(match[2]),
      reasoningEfforts: [],
      defaultReasoningEffort: "",
      contextWindow: null,
      maxContextWindow: null,
    });
  }
  if (!models.length) throw new Error("Cursor returned no models. Check CLI sign-in or update the CLI.");
  return models;
}

type CodexModel = {
  model: string;
  displayName: string;
  description?: string;
  hidden?: boolean;
  isDefault?: boolean;
  supportedReasoningEfforts?: { reasoningEffort: string; description: string }[];
  defaultReasoningEffort?: string;
  contextWindow?: number;
  maxContextWindow?: number;
};

async function codexModelList(command: string, cwd?: string): Promise<CodexModel[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ["app-server"], {
      cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    });
    const buffer = { value: "" };
    const models: CodexModel[] = [];
    const cursors = new Set<string>();
    let settled = false;
    let requestId = 1;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin?.end();
      killProcessTree(child);
      if (error) reject(error);
      else resolve(models);
    };
    const timer = setTimeout(() => finish(new Error("Codex model discovery timed out.")), 20_000);
    const send = (message: object) => child.stdin?.write(`${JSON.stringify(message)}\n`);
    const list = (cursor?: string) => {
      requestId += 1;
      send({ id: requestId, method: "model/list", params: { limit: 100, includeHidden: false, cursor } });
    };
    child.stdin?.on("error", (error) => finish(error));
    child.on("error", (error) => finish(error));
    child.on("close", (code) => finish(new Error(`Codex model discovery exited before responding (exit ${code}).`)));
    child.stderr?.resume();
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => consumeJsonLines(chunk, buffer, (line) => {
      if (settled) return;
      try {
        const message = JSON.parse(line);
        if (message.id !== requestId) return;
        if (message.error) {
          finish(new Error(message.error.message || "Codex model discovery failed."));
          return;
        }
        if (requestId === 1) {
          send({ method: "initialized" });
          list();
          return;
        }
        if (!Array.isArray(message.result?.data)) {
          finish(new Error("Invalid Codex model catalog."));
          return;
        }
        models.push(...message.result.data);
        const cursor = message.result.nextCursor;
        if (cursor) {
          if (typeof cursor !== "string" || cursors.has(cursor) || cursors.size >= 100) {
            finish(new Error("Invalid Codex model catalog pagination."));
            return;
          }
          cursors.add(cursor);
          list(cursor);
        } else finish();
      } catch {
        finish(new Error("Invalid JSON from Codex model discovery."));
      }
    }));
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "auto_rob", version: "0.1.0" } } });
  });
}

export async function listModels(id: HarnessId, workspace?: string): Promise<HarnessModel[]> {
  if (id === "cursor") {
    const result = await runCommand(await resolveAgentCommand(), ["--list-models"], workspace, 20_000);
    if (result.code !== 0) throw new Error(result.stderr.trim() || "Cursor model discovery failed. Check CLI sign-in.");
    return parseCursorModels(result.stdout);
  }
  const catalog = await codexModelList(await resolveCodexCommand(), workspace);
  let cached: { slug: string; context_window?: number; max_context_window?: number }[] = [];
  try {
    const home = process.env.CODEX_HOME?.trim() || path.join(homedir(), ".codex");
    const cache = JSON.parse(await readFile(path.join(home, "models_cache.json"), "utf8"));
    if (Array.isArray(cache.models)) cached = cache.models.filter((entry: unknown) =>
      entry !== null && typeof entry === "object" && "slug" in entry && typeof entry.slug === "string",
    );
  } catch {}
  const models = catalog.filter((model) => typeof model.model === "string" && !model.hidden).map((model) => {
    const metadata = cached.find((entry) => entry.slug === model.model);
    const contextWindow = positiveInteger(model.contextWindow ?? metadata?.context_window);
    const maxContextWindow = positiveInteger(model.maxContextWindow ?? metadata?.max_context_window) ?? contextWindow;
    return {
      id: model.model,
      label: model.displayName || model.model,
      description: model.description || "",
      isDefault: model.isDefault === true,
      reasoningEfforts: (model.supportedReasoningEfforts ?? []).map((effort) => ({
        value: effort.reasoningEffort, description: effort.description,
      })),
      defaultReasoningEffort: model.defaultReasoningEffort || "",
      contextWindow,
      maxContextWindow,
    };
  });
  if (!models.length) throw new Error("Codex returned no models. Check CLI sign-in or update the CLI.");
  return models;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export async function validateSelection(id: HarnessId, selection: HarnessSelection, workspace?: string): Promise<void> {
  if (typeof selection.model !== "string" || typeof selection.reasoningEffort !== "string") {
    throw new Error("Invalid model selection.");
  }
  if (selection.contextWindow !== null && positiveInteger(selection.contextWindow) === null) {
    throw new Error("Context must be a positive integer number of tokens.");
  }
  if (!selection.reasoningEffort && selection.contextWindow === null) return;
  const models = await listModels(id, workspace);
  const model = models.find((entry) => entry.id === selection.model);
  if (!model) throw new Error("Select a listed model before setting thinking or context.");
  if (selection.reasoningEffort && !model.reasoningEfforts.some((effort) => effort.value === selection.reasoningEffort)) {
    throw new Error(`Thinking level is not supported by ${model.label}. For Cursor, choose a listed thinking variant.`);
  }
  if (selection.contextWindow !== null && (!model.maxContextWindow || selection.contextWindow > model.maxContextWindow)) {
    throw new Error(`Context is not supported or exceeds the limit for ${model.label}.`);
  }
}
