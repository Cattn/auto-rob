export const IPC = {
	health: "auto-rob:health",
	runStart: "auto-rob:run:start",
	runStop: "auto-rob:run:stop",
	runStatus: "auto-rob:run:status",
	runEvent: "auto-rob:run:event",
	readFile: "auto-rob:fs:read",
	harnesses: "auto-rob:harness:list",
	activeHarness: "auto-rob:harness:active",
	setActiveHarness: "auto-rob:harness:set-active",
	connectHarness: "auto-rob:harness:connect",
	harnessModels: "auto-rob:harness:models",
	setHarnessModel: "auto-rob:harness:set-model",
	onboardingGet: "auto-rob:onboarding:get",
	onboardingSave: "auto-rob:onboarding:save",
	onboardingApply: "auto-rob:onboarding:apply",
	promptReset: "auto-rob:prompt:reset",
} as const;

export type TradeStyle = "more_active" | "balanced" | "less_frequent";

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

export type PromptResetResult = {
	ok: boolean;
	promptPath: string;
	message: string;
};

export type RunState = "idle" | "running" | "failed";

export type HarnessId = "cursor" | "codex";

export type HarnessModels = Record<HarnessId, string>;

export type HarnessConnection = {
	id: HarnessId;
	binaryPath: string | null;
	binaryOk: boolean;
	mcpConfigured: boolean;
	mcpAuthenticated: boolean;
	label: string;
	model: string;
	error: string | null;
};

export type HealthInfo = {
	ok: boolean;
	repoRoot: string;
	agentPath: string | null;
	agentVersion: string | null;
	ntfyConfigured: boolean;
	fakeRuns: boolean;
	error: string | null;
	activeHarness: HarnessId;
	harnesses: HarnessConnection[];
};

export type RunStatus = {
	state: RunState;
	message: string;
	startedAt: number | null;
	exitCode: number | null;
	fake: boolean;
};

export type RunEvent =
	| { type: "status"; status: RunStatus }
	| { type: "log"; line: string };

export type AutoRobApi = {
	getHealth: () => Promise<HealthInfo>;
	getRunStatus: () => Promise<RunStatus>;
	startRun: () => Promise<RunStatus>;
	stopRun: () => Promise<RunStatus>;
	readRepoFile: (name: string) => Promise<string | null>;
	getHarnesses: () => Promise<HarnessConnection[]>;
	getActiveHarness: () => Promise<HarnessId>;
	setActiveHarness: (id: HarnessId) => Promise<HarnessId>;
	connectHarness: (id: HarnessId) => Promise<HarnessConnection>;
	getHarnessModels: () => Promise<HarnessModels>;
	setHarnessModel: (id: HarnessId, model: string) => Promise<HarnessModels>;
	getOnboarding: () => Promise<OnboardingState>;
	saveOnboarding: (answers: OnboardingAnswers, opts?: { draft?: boolean }) => Promise<OnboardingState>;
	applyOnboarding: (answers: OnboardingAnswers, opts?: { agent?: boolean }) => Promise<OnboardingApplyResult>;
	resetPrompt: () => Promise<PromptResetResult>;
	onRunEvent: (handler: (event: RunEvent) => void) => () => void;
};
