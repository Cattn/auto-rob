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
	ntfyGet: "auto-rob:ntfy:get",
	ntfySet: "auto-rob:ntfy:set",
	onboardingGet: "auto-rob:onboarding:get",
	onboardingSave: "auto-rob:onboarding:save",
	onboardingApply: "auto-rob:onboarding:apply",
	promptReset: "auto-rob:prompt:reset",
	notesGet: "auto-rob:notes:get",
	notesSaveActive: "auto-rob:notes:save-active",
	notesCreate: "auto-rob:notes:create",
	notesUpdate: "auto-rob:notes:update",
	notesDelete: "auto-rob:notes:delete",
	notesSetActive: "auto-rob:notes:set-active",
	longTermGet: "auto-rob:long-term:get",
	longTermAdd: "auto-rob:long-term:add",
	longTermUpdate: "auto-rob:long-term:update",
	longTermDismiss: "auto-rob:long-term:dismiss",
	longTermSetPinned: "auto-rob:long-term:set-pinned",
	constraintsGet: "auto-rob:constraints:get",
	constraintsSet: "auto-rob:constraints:set",
	scheduleGet: "auto-rob:schedule:get",
	scheduleSetEnabled: "auto-rob:schedule:set-enabled",
	scheduleSetPaused: "auto-rob:schedule:set-paused",
	scheduleSetPreset: "auto-rob:schedule:set-preset",
	scheduleSetRunMissed: "auto-rob:schedule:set-run-missed",
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
	state: OnboardingState;
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

export type NtfySettings = {
	url: string;
	topic: string;
	tokenConfigured: boolean;
	configured: boolean;
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

export type SavedNoteMeta = {
	id: string;
	title: string;
	updatedAt: string;
};

export type NotesState = {
	content: string;
	activeId: string | null;
	notes: SavedNoteMeta[];
};

export type LongTermType = "goal" | "watch" | "todo";
export type LongTermSize = "small" | "medium" | "large";
export type LongTermSource = "user" | "agent";

export type LongTermItem = {
	id: string;
	title: string;
	type: LongTermType;
	size: LongTermSize;
	pinned: boolean;
	source: LongTermSource;
	added: string;
	checkAfter: string | null;
	rationale: string;
};

export type LongTermState = {
	items: LongTermItem[];
};

export type LongTermUserFields = {
	title?: string;
	type?: LongTermType;
	size?: LongTermSize;
	checkAfter?: string | null;
	rationale?: string;
	pinned?: boolean;
};

export type Constraints = {
	neverTrade: string[];
	doNotSell: string[];
	maxPositionPct: number | null;
	notes: string;
};

export type SchedulePreset = "every_30m" | "every_1h" | "every_2h";

export type SchedulePlatform = "win32" | "darwin" | "linux" | "unsupported";

export type ScheduleStatus = {
	enabled: boolean;
	paused: boolean;
	runMissed: boolean;
	preset: SchedulePreset;
	suggestedPreset: SchedulePreset;
	harnessReady: boolean;
	canEnable: boolean;
	active: boolean;
	installed: boolean;
	platform: SchedulePlatform;
	nextRunAt: string | null;
	nextRunLabel: string | null;
	slotsLocal: string[];
	runCommand: string;
	isPackaged: boolean;
	cadenceMatch: boolean;
	error: string | null;
};

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
	getNtfySettings: () => Promise<NtfySettings>;
	setNtfySettings: (settings: {
		url: string;
		topic: string;
		token?: string;
		clearToken?: boolean;
	}) => Promise<NtfySettings>;
	getOnboarding: () => Promise<OnboardingState>;
	saveOnboarding: (answers: OnboardingAnswers, opts?: { draft?: boolean }) => Promise<OnboardingState>;
	applyOnboarding: (answers: OnboardingAnswers) => Promise<OnboardingApplyResult>;
	resetPrompt: () => Promise<PromptResetResult>;
	getNotes: () => Promise<NotesState>;
	saveActiveNote: (content: string) => Promise<NotesState>;
	createSavedNote: (opts?: { title?: string; content?: string }) => Promise<NotesState>;
	updateSavedNote: (
		id: string,
		opts: { title?: string; content?: string },
	) => Promise<NotesState>;
	deleteSavedNote: (id: string) => Promise<NotesState>;
	setActiveNote: (id: string) => Promise<NotesState>;
	getLongTerm: () => Promise<LongTermState>;
	addLongTermItem: (input: {
		title: string;
		type?: LongTermType;
		size?: LongTermSize;
		checkAfter?: string | null;
		rationale?: string;
		pinned?: boolean;
	}) => Promise<LongTermState>;
	updateLongTermItem: (id: string, fields: LongTermUserFields) => Promise<LongTermState>;
	dismissLongTermItem: (id: string) => Promise<LongTermState>;
	setLongTermPinned: (id: string, pinned: boolean) => Promise<LongTermState>;
	getConstraints: () => Promise<Constraints>;
	setConstraints: (constraints: Constraints) => Promise<Constraints>;
	getSchedule: () => Promise<ScheduleStatus>;
	setScheduleEnabled: (enabled: boolean) => Promise<ScheduleStatus>;
	setSchedulePaused: (paused: boolean) => Promise<ScheduleStatus>;
	setSchedulePreset: (preset: SchedulePreset) => Promise<ScheduleStatus>;
	setScheduleRunMissed: (runMissed: boolean) => Promise<ScheduleStatus>;
	onRunEvent: (handler: (event: RunEvent) => void) => () => void;
};
