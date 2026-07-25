import type {
	AutoRobApi,
	Constraints,
	HarnessConnection,
	HarnessId,
	HarnessModels,
	HealthInfo,
	LongTermItem,
	LongTermSize,
	LongTermState,
	LongTermType,
	LongTermUserFields,
	NotesState,
	NtfySettings,
	OnboardingAnswers,
	OnboardingApplyResult,
	OnboardingState,
	PromptResetResult,
	RunStatus,
	SavedNoteMeta,
	TradeStyle,
} from "../../shared/ipc";

export type {
	AutoRobApi,
	Constraints,
	HarnessConnection,
	HarnessId,
	HarnessModels,
	HealthInfo,
	LongTermItem,
	LongTermSize,
	LongTermState,
	LongTermType,
	LongTermUserFields,
	NotesState,
	NtfySettings,
	OnboardingAnswers,
	OnboardingApplyResult,
	OnboardingState,
	PromptResetResult,
	RunStatus,
	SavedNoteMeta,
	TradeStyle,
};

export function getBackend(): AutoRobApi | null {
	if (typeof window === "undefined") return null;
	return window.autoRob ?? null;
}

export function isElectron(): boolean {
	return getBackend() !== null;
}
