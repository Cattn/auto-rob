import { isNtfyConfigured, loadEnvFile, notify } from "./notify.js";
import { prepareCliWorkspace } from "./workspace.js";

const message =
  process.argv.slice(2).join(" ").trim() ||
  `auto-rob test - ${new Date().toLocaleString()}`;

const root = await prepareCliWorkspace(import.meta.url);
await loadEnvFile(root);

if (!isNtfyConfigured()) {
  console.error(
    "ntfy is not configured. Set NTFY_URL and NTFY_TOPIC in the workspace .env to test.",
  );
  process.exit(1);
}

const ok = await notify(message, {
  title: "auto-rob - test",
  tags: ["white_check_mark"],
  priority: 5,
});

if (!ok) {
  console.error(
    "Failed to send test notification. Check workspace .env (NTFY_URL, NTFY_TOPIC, NTFY_TOKEN).",
  );
  process.exit(1);
}

console.log("Sent test notification.");
