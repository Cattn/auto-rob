import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getActiveHarness, getActiveHarnessId } from "./harness/index.js";

export const ONBOARDING_FILE = "onboarding.json";
export const PROMPT_FILE = "prompt.md";
export const DEFAULT_PROMPT_FILE = "prompt.default.md";

export const TRADE_STYLES = [
  "more_active",
  "balanced",
  "less_frequent",
] as const;

export type TradeStyle = (typeof TRADE_STYLES)[number];

export type OnboardingAnswers = {
  tradeStyle: TradeStyle;
  intent: string;
  minPerTradeUsd: number | null;
  minBpToAddPosition: number | null;
};

export type OnboardingState = {
  answers: OnboardingAnswers;
  completedAt: string | null;
  appliedAt: string | null;
  applyMode: "direct" | "agent" | null;
};

export type OnboardingApplyResult = {
  ok: boolean;
  mode: "direct" | "agent";
  state: OnboardingState;
  promptPath: string;
  message: string;
  exitCode: number | null;
};

export const DEFAULT_ONBOARDING_ANSWERS: OnboardingAnswers = {
  tradeStyle: "balanced",
  intent: "",
  minPerTradeUsd: null,
  minBpToAddPosition: null,
};

export function emptyOnboardingState(): OnboardingState {
  return {
    answers: { ...DEFAULT_ONBOARDING_ANSWERS },
    completedAt: null,
    appliedAt: null,
    applyMode: null,
  };
}

export function isTradeStyle(value: unknown): value is TradeStyle {
  return (
    typeof value === "string" &&
    (TRADE_STYLES as readonly string[]).includes(value)
  );
}

function normalizeOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function normalizeAnswers(
  input: Partial<OnboardingAnswers> | null | undefined,
): OnboardingAnswers {
  const tradeStyle = isTradeStyle(input?.tradeStyle)
    ? input.tradeStyle
    : DEFAULT_ONBOARDING_ANSWERS.tradeStyle;
  const intent =
    typeof input?.intent === "string" ? input.intent.trim() : "";
  return {
    tradeStyle,
    intent,
    minPerTradeUsd: normalizeOptionalNumber(input?.minPerTradeUsd),
    minBpToAddPosition: normalizeOptionalNumber(input?.minBpToAddPosition),
  };
}

export function normalizeState(
  input: Partial<OnboardingState> | null | undefined,
): OnboardingState {
  return {
    answers: normalizeAnswers(input?.answers),
    completedAt:
      typeof input?.completedAt === "string" ? input.completedAt : null,
    appliedAt: typeof input?.appliedAt === "string" ? input.appliedAt : null,
    applyMode:
      input?.applyMode === "direct" || input?.applyMode === "agent"
        ? input.applyMode
        : null,
  };
}

export async function loadOnboarding(
  workspace: string,
): Promise<OnboardingState> {
  try {
    const raw = await readFile(
      path.join(workspace, ONBOARDING_FILE),
      "utf8",
    );
    return normalizeState(JSON.parse(raw) as Partial<OnboardingState>);
  } catch {
    return emptyOnboardingState();
  }
}

export async function saveOnboarding(
  workspace: string,
  answersInput: Partial<OnboardingAnswers>,
  opts?: { markCompleted?: boolean },
): Promise<OnboardingState> {
  const current = await loadOnboarding(workspace);
  const answers = normalizeAnswers(answersInput);
  const next: OnboardingState = {
    ...current,
    answers,
    completedAt: opts?.markCompleted
      ? new Date().toISOString()
      : current.completedAt,
  };
  await writeFile(
    path.join(workspace, ONBOARDING_FILE),
    `${JSON.stringify(next, null, 2)}\n`,
    "utf8",
  );
  return next;
}

export function tradeStyleLabel(style: TradeStyle): string {
  switch (style) {
    case "more_active":
      return "More active / faster trades";
    case "less_frequent":
      return "Less frequent trades";
    default:
      return "Balanced cadence";
  }
}

export function formatAnswersForPrompt(answers: OnboardingAnswers): string {
  const lines = [
    `- Trade cadence: ${tradeStyleLabel(answers.tradeStyle)} (\`${answers.tradeStyle}\`)`,
  ];
  if (answers.minPerTradeUsd != null) {
    lines.push(`- Minimum per trade: $${answers.minPerTradeUsd}`);
  }
  if (answers.minBpToAddPosition != null) {
    lines.push(
      `- Minimum buying power to add a position: $${answers.minBpToAddPosition}`,
    );
  }
  if (answers.intent) {
    lines.push(`- Intent / focus: ${answers.intent}`);
  } else {
    lines.push("- Intent / focus: (none provided)");
  }
  return lines.join("\n");
}

export type PromptResetResult = {
  ok: boolean;
  promptPath: string;
  message: string;
};

export async function resetPromptToDefault(
  workspace: string,
): Promise<PromptResetResult> {
  const defaultPath = path.join(workspace, DEFAULT_PROMPT_FILE);
  let defaultContent: string;
  try {
    defaultContent = await readFile(defaultPath, "utf8");
  } catch {
    throw new Error(
      `Missing ${DEFAULT_PROMPT_FILE} at ${defaultPath} — cannot reset`,
    );
  }

  const promptPath = path.join(workspace, PROMPT_FILE);
  await writeFile(promptPath, defaultContent, "utf8");

  try {
    const raw = await readFile(path.join(workspace, ONBOARDING_FILE), "utf8");
    const state = JSON.parse(raw) as Record<string, unknown>;
    state.appliedAt = null;
    state.applyMode = null;
    await writeFile(
      path.join(workspace, ONBOARDING_FILE),
      `${JSON.stringify(state, null, 2)}\n`,
      "utf8",
    );
  } catch {
    // onboarding.json missing or invalid — skip
  }

  return { ok: true, promptPath, message: "prompt.md reset to stock default" };
}

export function isDefaultAnswers(answers: OnboardingAnswers): boolean {
  return (
    answers.tradeStyle === DEFAULT_ONBOARDING_ANSWERS.tradeStyle &&
    answers.intent.trim() === "" &&
    answers.minPerTradeUsd === null &&
    answers.minBpToAddPosition === null
  );
}

export function buildOnboardingAgentKickoff(
  answers: OnboardingAnswers,
): string {
  const header = [
    "You are editing auto-rob's standing agent instructions.",
    "This is NOT a portfolio run and NOT a trading kickoff.",
    "Your only job: read prompt.md, then edit it to reflect the owner's onboarding preferences.",
    "Do not trade. Do not call any Robinhood write tools. Do not modify run-log.md, long-term.md, notes.md, or onboarding.json.",
    "Keep the existing structure and safety rules in prompt.md.",
  ];

  if (isDefaultAnswers(answers)) {
    header.push(
      "",
      "The owner left all preferences at their defaults (balanced cadence, no intent, no sizing limits).",
      "Change as little as possible — leave the stock prompt alone unless something is clearly wrong or stale.",
      "If a User Preferences section already exists and is reasonable, leave it intact.",
    );
  } else {
    header.push(
      "",
      "Weave the following preferences into Goals/Workflow and the User Preferences section.",
      "Be concrete about cadence, sizing floors, and intent. Do not invent dollar limits the owner did not provide.",
      "If a User Preferences (from onboarding) section exists, refine it so the rest of the prompt is consistent with it.",
      "",
      "Owner preferences:",
      formatAnswersForPrompt(answers),
    );
  }

  header.push("", "Read prompt.md, edit it, then stop.");
  return header.join("\n");
}

export async function applyOnboardingWithAgent(
  workspace: string,
  answersInput?: Partial<OnboardingAnswers>,
): Promise<OnboardingApplyResult> {
  const prior = await loadOnboarding(workspace);
  const answers = normalizeAnswers(answersInput ?? prior.answers);
  const promptPath = path.join(workspace, PROMPT_FILE);

  const savedState = await saveOnboarding(workspace, answers, {
    markCompleted: true,
  });

  const kickoff = buildOnboardingAgentKickoff(answers);

  const activeId = await getActiveHarnessId(workspace);
  const harness = await getActiveHarness(workspace);
  console.log(`onboarding apply via harness: ${activeId} (${harness.label})`);

  const exitCode = await harness.run({
    workspace,
    kickoff,
    promptPath,
  });

  const state: OnboardingState = {
    ...savedState,
    appliedAt: new Date().toISOString(),
    applyMode: "agent",
  };
  await writeFile(
    path.join(workspace, ONBOARDING_FILE),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8",
  );

  return {
    ok: exitCode === 0,
    mode: "agent",
    state,
    promptPath,
    message:
      exitCode === 0
        ? "Agent finished refining prompt.md from onboarding answers"
        : `Agent apply failed (exit ${exitCode})`,
    exitCode,
  };
}
