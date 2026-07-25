import type {
	AutoRobApi,
	HarnessConnection,
	HarnessId,
	HarnessModels,
	HealthInfo,
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
	HarnessConnection,
	HarnessId,
	HarnessModels,
	HealthInfo,
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
