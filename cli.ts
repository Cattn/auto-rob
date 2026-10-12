import path from "node:path";
import { access } from "node:fs/promises";
import { getActiveHarness, getHarnessSelection, isHarnessId, isHarnessReady, listModels, validateSelection } from "./harness/index.js";
import { loadEnvFile } from "./notify.js";
import { runPortfolio } from "./run.js";
import { resolveDefaultWorkspace } from "./workspace.js";

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const flags = new Map<string, string>();
  let list = false;
  let check = false;
  let json = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help") continue;
    if (arg === "list" || arg === "--list-models") {
      list = true;
      if (isHarnessId(args[i + 1] ?? "")) flags.set("--harness", args[++i]);
    } else if (arg === "--check") check = true;
    else if (arg === "--json") json = true;
    else if (["--harness", "--model", "--thinking", "--context"].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}.`);
      flags.set(arg, value);
    } else throw new Error(`Unknown argument: ${arg}. Use --help for usage.`);
  }
  if (args.includes("--help")) {
    console.log("Run one portfolio job using the desktop app's workspace and active harness.");
    console.log("--check checks setup without running the agent or trading.");
    console.log("list [cursor|codex] lists models, thinking levels, and known context limits. --json outputs JSON.");
    console.log("--harness cursor|codex selects the harness for this command.");
    console.log("--model ID --thinking LEVEL --context TOKENS override model settings for one run (or --check).");
    console.log("AUTO_ROB_WORKSPACE overrides the default OS user-data workspace.");
    return 0;
  }
  const workspace = path.resolve(
    process.env.AUTO_ROB_WORKSPACE?.trim() || resolveDefaultWorkspace(),
  );
  const id = flags.get("--harness");
  if (id && !isHarnessId(id)) throw new Error("Harness must be cursor or codex.");
  if (id) process.env.AUTO_ROB_HARNESS = id;
  if (list) {
    if (check || ["--model", "--thinking", "--context"].some((flag) => flags.has(flag))) {
      throw new Error("Model listing cannot be combined with run or check options.");
    }
    const harness = await getActiveHarness(workspace);
    const models = await listModels(harness.id);
    if (json) console.log(JSON.stringify({ harness: harness.id, models }, null, 2));
    else {
      console.log(`Models for ${harness.label}:`);
      for (const model of models) {
        console.log(`${model.id} - ${model.label}${model.isDefault ? " (default)" : ""}`);
        if (model.reasoningEfforts.length) console.log(`  thinking: ${model.reasoningEfforts.map((effort) => effort.value).join(", ")}`);
        if (model.contextWindow) console.log(`  context: ${model.contextWindow} tokens (maximum ${model.maxContextWindow})`);
      }
      if (harness.id === "cursor") console.log("Thinking and context variants are selected by their listed model IDs.");
    }
    return 0;
  }
  if (json) throw new Error("--json requires list or --list-models.");
  await access(path.join(workspace, "prompt.md")).catch(() => {
    throw new Error(`No strategy prompt in ${workspace}. Set up the desktop workspace before running headlessly.`);
  });
  await loadEnvFile(workspace);
  const harness = await getActiveHarness(workspace);
  const saved = await getHarnessSelection(workspace, harness.id);
  const selection = {
    model: flags.get("--model") ?? saved.model,
    reasoningEffort: flags.get("--thinking") ?? (flags.has("--model") ? "" : saved.reasoningEffort),
    contextWindow: flags.has("--context") ? Number(flags.get("--context")) : (flags.has("--model") ? null : saved.contextWindow),
  };
  await validateSelection(harness.id, selection, workspace);
  const status = await harness.status();
  console.log(`workspace: ${workspace}`);
  console.log(`harness: ${harness.id}`);
  if (!isHarnessReady(status)) {
    throw new Error(status.error || "Connect the active harness to Robinhood in auto-rob Settings first.");
  }
  if (check) {
    console.log("CLI, sign-in, and saved Robinhood authorization found. No portfolio job was started.");
    return 0;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    return await runPortfolio(workspace, { signal: controller.signal, selection });
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}

main().then(
  (code) => { process.exitCode = code; },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
