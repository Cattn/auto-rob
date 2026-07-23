import type {
	AutoRobApi,
	HarnessConnection,
	HarnessId,
	HarnessModels,
	HealthInfo,
	RunStatus,
} from "../../shared/ipc";

export type {
	AutoRobApi,
	HarnessConnection,
	HarnessId,
	HarnessModels,
	HealthInfo,
	RunStatus,
};

export function getBackend(): AutoRobApi | null {
	if (typeof window === "undefined") return null;
	return window.autoRob ?? null;
}

export function isElectron(): boolean {
	return getBackend() !== null;
}
