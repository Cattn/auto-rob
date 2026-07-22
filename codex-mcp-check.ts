import { spawn } from "node:child_process";
import { resolveCodexCommand } from "./resolve-codex.js";

const MCP_NAME = "robinhood-trading";
const MCP_URL = "https://agent.robinhood.com/mcp/trading";

const args = new Set(process.argv.slice(2));
const doConnect = args.has("--connect");
const doLogin = args.has("--login") || doConnect;
const doAdd = args.has("--add") || doConnect;

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const ok = (s: string) => `\x1b[32m${s}\x1b[0m`;
const warn = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bad = (s: string) => `\x1b[31m${s}\x1b[0m`;

function run(
  command: string,
  argv: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ code: exitCode ?? 1, stdout, stderr });
    });
  });
}

function hasRobinhood(listOutput: string): boolean {
  return listOutput
    .split(/\r?\n/)
    .some((line) => line.toLowerCase().includes(MCP_NAME));
}

async function main() {
  console.log(dim("resolving Codex CLI…"));
  const codex = await resolveCodexCommand();
  console.log(`codex: ${codex}`);

  const version = await run(codex, ["--version"]);
  if (version.code !== 0) {
    console.error(bad(`codex --version failed (exit ${version.code})`));
    console.error((version.stdout + version.stderr).trim());
    process.exit(1);
  }
  console.log(`version: ${(version.stdout || version.stderr).trim()}`);

  const listed = await run(codex, ["mcp", "list"]);
  const listText = (listed.stdout + listed.stderr).trim();
  if (listed.code !== 0) {
    console.error(bad(`codex mcp list failed (exit ${listed.code})`));
    console.error(listText || "(empty)");
    process.exit(1);
  }

  console.log(dim("\nmcp list:"));
  console.log(listText || "(no servers)");

  let connected = hasRobinhood(listText);
  if (connected) {
    console.log(ok(`\n✓ ${MCP_NAME} is configured`));
  } else {
    console.log(warn(`\n✗ ${MCP_NAME} is not configured`));
  }

  if (!connected && doAdd) {
    console.log(dim(`\nadding ${MCP_NAME}…`));
    const added = await run(codex, [
      "mcp",
      "add",
      MCP_NAME,
      "--url",
      MCP_URL,
    ]);
    const addText = (added.stdout + added.stderr).trim();
    if (addText) console.log(addText);
    if (added.code !== 0) {
      console.error(bad(`codex mcp add failed (exit ${added.code})`));
      process.exit(1);
    }
    connected = true;
    console.log(ok(`✓ added ${MCP_NAME}`));
  }

  if (connected && doLogin) {
    console.log(
      dim(
        `\nstarting OAuth for ${MCP_NAME} (finish in browser + Robinhood app)…`,
      ),
    );
    const login = await run(codex, ["mcp", "login", MCP_NAME]);
    const loginText = (login.stdout + login.stderr).trim();
    if (loginText) console.log(loginText);
    if (login.code !== 0) {
      console.error(bad(`codex mcp login failed (exit ${login.code})`));
      process.exit(1);
    }
    console.log(ok("✓ login command finished"));
  }

  if (!connected && !doAdd) {
    console.log(
      dim(
        `\nnext: npm run codex:connect   # add MCP + open Robinhood OAuth`,
      ),
    );
    process.exit(2);
  }

  if (connected && !doLogin) {
    console.log(
      dim(
        `\noptional: npm run codex:connect   # (re)run Robinhood OAuth`,
      ),
    );
  }

  console.log(ok("\nok"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
