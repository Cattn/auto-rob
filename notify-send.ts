import { unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BRIEF_FILE,
  loadEnvFile,
  notify,
  readBriefFile,
  SENT_MARKER,
} from "./notify.js";

const root = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv: string[]) {
  let title: string | null = null;
  let priority: 1 | 2 | 3 | 4 | 5 = 5;
  let tags = ["robot"];
  let file: string | null = null;
  const bodyParts: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--title" || arg === "-t") {
      title = argv[++i] ?? null;
    } else if (arg === "--priority" || arg === "-p") {
      const n = Number(argv[++i]);
      if (n >= 1 && n <= 5) priority = n as 1 | 2 | 3 | 4 | 5;
    } else if (arg === "--tags") {
      tags = (argv[++i] ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    } else if (arg === "--file" || arg === "-f") {
      file = argv[++i] ?? BRIEF_FILE;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage:",
          '  npm run notify -- --title "auto-rob - update" "message body"',
          "  npm run notify -- --file .notify-brief.md",
          "  npm run notify",
          "",
          `Default file: ${BRIEF_FILE}`,
          "Brief file format:",
          "  # title on first heading line",
          "  body lines after that",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      bodyParts.push(arg);
    }
  }

  return {
    title,
    priority,
    tags,
    file,
    body: bodyParts.join(" ").trim(),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await loadEnvFile();

  let title = args.title ?? "auto-rob - update";
  let body = args.body;

  if (!body) {
    const brief = await readBriefFile(path.join(root, args.file ?? BRIEF_FILE));
    if (!args.title) title = brief.title;
    body = brief.body;
  }

  if (!body) {
    console.error("No notification body. Pass a message or write .notify-brief.md");
    process.exit(1);
  }

  const ok = await notify(body, {
    title,
    priority: args.priority,
    tags: args.tags,
  });

  if (!ok) process.exit(1);

  await writeFile(path.join(root, SENT_MARKER), new Date().toISOString(), "utf8");
  console.log(`Sent - ${title}`);
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  try {
    await unlink(path.join(root, SENT_MARKER));
  } catch {
    // ignore
  }
  process.exit(1);
});
