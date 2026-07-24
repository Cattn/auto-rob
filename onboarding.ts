import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { getActiveHarness, getActiveHarnessId } from "./harness/index.js";

export const ONBOARDING_TASK_FILE = ".onboarding-task.md";

export const ONBOARDING_CLI_JSON = {
  permissions: {
    allow: [
      "Read(prompt.md)",
      "Read(.onboarding-task.md)",
      "Write(prompt.md)",
    ],
    deny: [
      "Write(prompt.default.md)",
      "Write(run-log.md)",
      "Write(long-term.md)",
      "Write(notes.md)",
      "Write(onboarding.json)",
      "Write(auto-rob.config.json)",
      "Write(.env)",
      "Write(.env*)",
      "Write(.cursor/**)",
      "Mcp(*)",
      "Shell(*)",
      "Shell(rm)",
      "Shell(del)",
      "Shell(git)",
      "Shell(npm)",
      "Shell(npx)",
    ],
  },
};

export async function withOnboardingCliPermissions<T>(
  workspace: string,
  fn: () => Promise<T>,
): Promise<T> {
  const cliPath = path.join(workspace, ".cursor", "cli.json");
  let backup: string | null = null;
  try {
    backup = await readFile(cliPath, "utf8");
  } catch {
    backup = null;
  }
  await writeFile(
    cliPath,
    `${JSON.stringify(ONBOARDING_CLI_JSON, null, 2)}\n`,
    "utf8",
  );
  try {
    return await fn();
  } finally {
    if (backup !== null) {
      await writeFile(cliPath, backup, "utf8");
    } else {
      await rm(cliPath, { force: true });
    }
  }
}

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
  state: OnboardingState;
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

  const now = new Date().toISOString();
  const state: OnboardingState = {
    answers: { ...DEFAULT_ONBOARDING_ANSWERS },
    completedAt: now,
    appliedAt: now,
    applyMode: "direct",
  };
  await writeFile(
    path.join(workspace, ONBOARDING_FILE),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8",
  );

  return {
    ok: true,
    promptPath,
    message: "prompt.md reset to stock default",
    state,
  };
}

export function isDefaultAnswers(answers: OnboardingAnswers): boolean {
  return (
    answers.tradeStyle === DEFAULT_ONBOARDING_ANSWERS.tradeStyle &&
    answers.intent.trim() === "" &&
    answers.minPerTradeUsd === null &&
    answers.minBpToAddPosition === null
  );
}

export function buildOnboardingTaskMarkdown(
  answers: OnboardingAnswers,
): string {
  if (isDefaultAnswers(answers)) {
    return [
      "Check prompt.md only.",
      "",
      "Owner preferences are all defaults (balanced, no intent, no sizing). Make no changes unless the file is clearly broken.",
      "",
      "Steps:",
      "1. Read prompt.md",
      "2. If fine, stop with no edits",
      "3. Otherwise make the smallest fix, then stop",
      "",
      "Do not ask questions. Do not touch any other file.",
    ].join("\n");
  }

  return [
    "Edit prompt.md only.",
    "",
    "Owner preferences (weave these into Goals/Workflow and/or a short User Preferences section; do not invent limits):",
    formatAnswersForPrompt(answers),
    "",
    "Steps:",
    "1. Read prompt.md",
    "2. Apply the preferences above",
    "3. Write prompt.md",
    "4. Stop",
    "",
    "Do not ask questions. Do not read or edit any other file.",
  ].join("\n");
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

  if (isDefaultAnswers(answers)) {
    const defaultPath = path.join(workspace, DEFAULT_PROMPT_FILE);
    let defaultContent: string;
    try {
      defaultContent = await readFile(defaultPath, "utf8");
    } catch {
      throw new Error(
        `Missing ${DEFAULT_PROMPT_FILE} at ${defaultPath} — cannot apply defaults`,
      );
    }
    await writeFile(promptPath, defaultContent, "utf8");

    const state: OnboardingState = {
      ...savedState,
      appliedAt: new Date().toISOString(),
      applyMode: "direct",
    };
    await writeFile(
      path.join(workspace, ONBOARDING_FILE),
      `${JSON.stringify(state, null, 2)}\n`,
      "utf8",
    );

    return {
      ok: true,
      mode: "direct",
      state,
      promptPath,
      message: "Using stock prompt.md — no preference changes to apply",
      exitCode: 0,
    };
  }

  const taskPath = path.join(workspace, ONBOARDING_TASK_FILE);
  await writeFile(taskPath, buildOnboardingTaskMarkdown(answers), "utf8");

  const kickoff =
    "Follow every instruction in .onboarding-task.md exactly. Only edit prompt.md.";

  const activeId = await getActiveHarnessId(workspace);
  const harness = await getActiveHarness(workspace);
  console.log(`onboarding apply via harness: ${activeId} (${harness.label})`);

  let exitCode: number;
  try {
    exitCode = await withOnboardingCliPermissions(workspace, () =>
      harness.run({
        workspace,
        kickoff,
        promptPath,
      }),
    );
  } finally {
    await rm(taskPath, { force: true });
  }

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
