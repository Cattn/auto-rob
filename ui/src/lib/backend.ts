import type {
	AutoRobApi,
	HarnessConnection,
	HarnessId,
	HarnessModels,
	HealthInfo,
	OnboardingAnswers,
	OnboardingApplyResult,
	OnboardingState,
	PromptResetResult,
	RunStatus,
	TradeStyle,
} from "../../shared/ipc";

export type {
	AutoRobApi,
	HarnessConnection,
	HarnessId,
	HarnessModels,
	HealthInfo,
	OnboardingAnswers,
	OnboardingApplyResult,
	OnboardingState,
	PromptResetResult,
	RunStatus,
	TradeStyle,
};

export function getBackend(): AutoRobApi | null {
	if (typeof window === "undefined") return null;
	return window.autoRob ?? null;
}

export function isElectron(): boolean {
	return getBackend() !== null;
}
