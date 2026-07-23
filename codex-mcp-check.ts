import path from "node:path";
import { fileURLToPath } from "node:url";
import { getHarness } from "./harness/index.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const doConnect = args.has("--connect");
const doLogin = args.has("--login") || doConnect;
const doAdd = args.has("--add") || doConnect;

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const ok = (s: string) => `\x1b[32m${s}\x1b[0m`;
const warn = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bad = (s: string) => `\x1b[31m${s}\x1b[0m`;

const harness = getHarness("codex", root);

async function main() {
  console.log(dim("resolving Codex CLI…"));
  let status = await harness.status();
  console.log(`codex: ${status.binaryPath ?? "(missing)"}`);

  if (!status.binaryOk) {
    console.error(bad(status.error ?? "Codex CLI not found"));
    process.exit(1);
  }

  if (status.mcpConfigured) {
    console.log(ok("\n✓ robinhood-trading is configured"));
  } else {
    console.log(warn("\n✗ robinhood-trading is not configured"));
  }

  if ((!status.mcpConfigured && doAdd) || (status.mcpConfigured && doLogin)) {
    status = await harness.connect({ login: doLogin });
    if (status.mcpConfigured) {
      console.log(ok("✓ robinhood-trading ready"));
    }
  }

  if (!status.mcpConfigured && !doAdd) {
    console.log(
      dim("\nnext: npm run codex:connect   # add MCP + open Robinhood OAuth"),
    );
    process.exit(2);
  }

  if (status.mcpConfigured && !doLogin && !doConnect) {
    console.log(
      dim("\noptional: npm run codex:connect   # (re)run Robinhood OAuth"),
    );
  }

  console.log(ok("\nok"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
