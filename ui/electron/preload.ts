import { contextBridge, ipcRenderer } from "electron";
import type { AutoRobApi, HarnessId, OnboardingAnswers, RunEvent } from "../shared/ipc";
import { IPC } from "../shared/ipc";

const api: AutoRobApi = {
	getHealth: () => ipcRenderer.invoke(IPC.health),
	getRunStatus: () => ipcRenderer.invoke(IPC.runStatus),
	startRun: () => ipcRenderer.invoke(IPC.runStart),
	stopRun: () => ipcRenderer.invoke(IPC.runStop),
	readRepoFile: (name) => ipcRenderer.invoke(IPC.readFile, name),
	getHarnesses: () => ipcRenderer.invoke(IPC.harnesses),
	getActiveHarness: () => ipcRenderer.invoke(IPC.activeHarness),
	setActiveHarness: (id: HarnessId) => ipcRenderer.invoke(IPC.setActiveHarness, id),
	connectHarness: (id: HarnessId) => ipcRenderer.invoke(IPC.connectHarness, id),
	getOnboarding: () => ipcRenderer.invoke(IPC.onboardingGet),
	saveOnboarding: (answers: OnboardingAnswers, opts?: { draft?: boolean }) =>
		ipcRenderer.invoke(IPC.onboardingSave, answers, opts),
	applyOnboarding: (answers: OnboardingAnswers) =>
		ipcRenderer.invoke(IPC.onboardingApply, answers),
	resetPrompt: () => ipcRenderer.invoke(IPC.promptReset),
	getHarnessModels: () => ipcRenderer.invoke(IPC.harnessModels),
	setHarnessModel: (id: HarnessId, model: string) =>
		ipcRenderer.invoke(IPC.setHarnessModel, id, model),
	getNtfySettings: () => ipcRenderer.invoke(IPC.ntfyGet),
	setNtfySettings: (settings) => ipcRenderer.invoke(IPC.ntfySet, settings),
	onRunEvent: (handler) => {
		const listener = (_event: Electron.IpcRendererEvent, payload: RunEvent) => {
			handler(payload);
		};
		ipcRenderer.on(IPC.runEvent, listener);
		return () => {
			ipcRenderer.removeListener(IPC.runEvent, listener);
		};
	},
};

contextBridge.exposeInMainWorld("autoRob", api);
