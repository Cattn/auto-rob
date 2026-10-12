import path from "node:path";
import { access } from "node:fs/promises";
import { getActiveHarness } from "./harness/index.js";
import { runCommand } from "./harness/util.js";
import { loadEnvFile } from "./notify.js";
import { runPortfolio } from "./run.js";
import { resolveDefaultWorkspace } from "./workspace.js";

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--check" && arg !== "--help")) {
    throw new Error("Usage: npm start [-- --check | --help]");
  }
  if (args.includes("--help")) {
    console.log("Run one portfolio job using the desktop app's workspace and active harness.");
    console.log("--check checks setup without running the agent or trading.");
    console.log("AUTO_ROB_WORKSPACE overrides the default OS user-data workspace.");
    return 0;
  }
  const workspace = path.resolve(
    process.env.AUTO_ROB_WORKSPACE?.trim() || resolveDefaultWorkspace(),
  );
  await access(path.join(workspace, "prompt.md")).catch(() => {
    throw new Error(`No strategy prompt in ${workspace}. Set up the desktop workspace before running headlessly.`);
  });
  await loadEnvFile(workspace);
  const harness = await getActiveHarness(workspace);
  const status = await harness.status();
  console.log(`workspace: ${workspace}`);
  console.log(`harness: ${harness.id}`);
  if (!status.binaryOk || !status.mcpConfigured || !status.mcpAuthenticated) {
    throw new Error(status.error || "Connect the active harness to Robinhood in auto-rob Settings first.");
  }
  if (harness.id === "codex") {
    const login = await runCommand(await harness.resolve(), ["login", "status"], workspace);
    if (login.code !== 0) throw new Error("Sign in using codex login before running auto-rob.");
    console.log(login.stdout.trim() || login.stderr.trim());
  }
  if (args.includes("--check")) {
    console.log("CLI, sign-in, and saved Robinhood authorization found. No portfolio job was started.");
    return 0;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    return await runPortfolio(workspace, { signal: controller.signal });
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
