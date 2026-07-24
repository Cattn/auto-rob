import {
  applyOnboardingWithAgent,
  loadOnboarding,
  normalizeAnswers,
  resetPromptToDefault,
  saveOnboarding,
  type OnboardingAnswers,
} from "./onboarding.js";
import { resolveCliWorkspace } from "./workspace.js";

const args = process.argv.slice(2);
const command = args[0] ?? "get";

function flagValue(name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return undefined;
}

function hasFlag(name: string): boolean {
  return args.includes(name);
}

const workspace = flagValue("--root") ?? resolveCliWorkspace(import.meta.url);
const JSON_MARKER = "__AUTO_ROB_JSON__";

function emitJson(payload: unknown) {
  process.stdout.write(`${JSON_MARKER}\n${JSON.stringify(payload)}\n`);
}

function parseAnswersJson(): Partial<OnboardingAnswers> {
  const raw = flagValue("--json");
  if (!raw) return {};
  return JSON.parse(raw) as Partial<OnboardingAnswers>;
}

async function main() {
  if (command === "get") {
    emitJson({ state: await loadOnboarding(workspace) });
    return;
  }

  if (command === "save") {
    const answers = normalizeAnswers(parseAnswersJson());
    const state = await saveOnboarding(workspace, answers, {
      markCompleted: !hasFlag("--draft"),
    });
    emitJson({ state });
    return;
  }

  if (command === "apply") {
    const answersRaw = hasFlag("--json") ? parseAnswersJson() : undefined;
    const result = await applyOnboardingWithAgent(workspace, answersRaw);
    emitJson({ result });
    if (!result.ok) process.exitCode = result.exitCode ?? 1;
    return;
  }

  if (command === "reset-prompt") {
    const result = await resetPromptToDefault(workspace);
    emitJson({ result });
    return;
  }

  throw new Error(
    "Usage: onboarding-cli.ts <get|save|apply|reset-prompt> [--root <path>] [--json '{...}'] [--draft]",
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
