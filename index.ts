import { access, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BRIEF_FILE,
  isNtfyConfigured,
  loadEnvFile,
  notify,
  sendBriefFile,
  SENT_MARKER,
} from "./notify.js";
import { getActiveHarness, getActiveHarnessId } from "./harness/index.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = "run-log.md";
const LONG_TERM_FILE = "long-term.md";
const NOTES_FILE = "notes.md";
const RUN_PROMPT_FILE = ".current-run-prompt.md";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

async function notifyRunBrief(exitCode: number): Promise<void> {
  if (!isNtfyConfigured()) return;

  try {
    await access(path.join(root, SENT_MARKER));
    console.log(dim("\n-> ntfy brief already sent by agent"));
    return;
  } catch {
    // agent did not send — fall back
  }

  try {
    if (await sendBriefFile(path.join(root, BRIEF_FILE))) {
      console.log(dim("\n-> ntfy brief sent (from agent file)"));
      return;
    }
  } catch {
    // no usable agent brief
  }

  const ok = await notify(
    exitCode === 0
      ? "Run finished, but the agent did not send a phone brief."
      : `Run failed (exit ${exitCode}) and no phone brief was sent.`,
    {
      title:
        exitCode === 0 ? "auto-rob - no brief" : "auto-rob - run failed",
      tags: ["warning", "robot"],
      priority: 5,
    },
  );
  if (ok) console.log(dim("\n-> ntfy brief sent (fallback)"));
}

async function clearNotifyArtifacts(): Promise<void> {
  await Promise.all(
    [BRIEF_FILE, SENT_MARKER].map(async (name) => {
      try {
        await unlink(path.join(root, name));
      } catch {
        // ignore
      }
    }),
  );
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
  await clearNotifyArtifacts();
  const basePrompt = await readFile(path.join(root, "prompt.md"), "utf8");
  const [priorLog, longTerm, userNotes] = await Promise.all([
    readOptionalMarkdown(LOG_FILE),
    readOptionalMarkdown(LONG_TERM_FILE),
    readOptionalMarkdown(NOTES_FILE),
  ]);
  const prompt = buildPrompt(basePrompt, priorLog, longTerm, userNotes);
  const promptPath = path.join(root, RUN_PROMPT_FILE);
  await writeFile(promptPath, prompt, "utf8");

  const ntfyEnabled = isNtfyConfigured();
  const kickoff = [
    `Read and follow every instruction in ${RUN_PROMPT_FILE} exactly.`,
    "This is an unattended portfolio job on the owner's own Robinhood account via the robinhood-trading MCP.",
    "You can and should call review_equity_order and place_equity_order when your research supports a trade.",
    "Do not refuse to trade or say you cannot place/review orders.",
    "Do not ask for trading rules, risk tolerance, instruments, position limits, or approval — they are already defined in that file.",
    "After any clean review_equity_order or review_option_order with no blocking alerts, immediately call place_equity_order or place_option_order with the same parameters.",
    "Do not stop to request confirmation. Waiting for a human yes after review is forbidden in this run.",
    ntfyEnabled
      ? "At the end of the run, write .notify-brief.md with your own phone summary and run: npm run notify"
      : "Skip the phone brief / ntfy steps — notifications are not configured for this run.",
    "Begin the portfolio run now.",
  ].join(" ");

  const activeId = await getActiveHarnessId(root);
  const harness = await getActiveHarness(root);
  console.log(dim(`active harness: ${activeId} (${harness.label})`));

  const code = await harness.run({
    workspace: root,
    kickoff,
    promptPath,
  });

  await notifyRunBrief(code);
  await clearNotifyArtifacts();
  process.exit(code);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
