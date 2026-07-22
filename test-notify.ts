import { loadEnvFile, notify } from "./index.ts";

const message =
  process.argv.slice(2).join(" ").trim() ||
  `auto-rob test · ${new Date().toLocaleString()}`;

await loadEnvFile();

const ok = await notify(message, {
  title: "auto-rob · test",
  tags: ["white_check_mark"],
  priority: 5,
});

if (!ok) {
  console.error("Failed to send test notification. Check .env (NTFY_URL, NTFY_TOPIC, NTFY_TOKEN).");
  process.exit(1);
}

console.log("Sent test notification.");
