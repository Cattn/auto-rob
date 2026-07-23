import { getHarness } from "./harness/index.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const status = await getHarness("cursor", root).status();

console.log(`resolved: ${status.binaryPath ?? "(missing)"}`);
console.log(`platform: ${process.platform}`);
console.log(`version: ok=${status.binaryOk}`);
console.log(`mcp configured: ${status.mcpConfigured}`);
console.log(`mcp authenticated: ${status.mcpAuthenticated}`);

if (!status.binaryOk) {
  console.error(status.error ?? "Cursor agent CLI not found");
  process.exit(1);
}

console.log("ok");
