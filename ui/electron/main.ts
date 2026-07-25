import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { AgentBridge } from "./agent-bridge";
import { IPC } from "../shared/ipc";

const runOnce = process.argv.includes("--run-once");
const bridge = new AgentBridge();

const createWindow = () => {
	const mainWindow = new BrowserWindow({
		width: 1100,
		height: 720,
		webPreferences: {
			preload: path.join(import.meta.dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	});

	mainWindow.maximize();

	if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
		mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
	} else {
		mainWindow.loadFile(
			path.join(
				import.meta.dirname,
				`../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
			),
		);
	}
};

function registerIpc() {
	ipcMain.handle(IPC.health, () => bridge.getHealth());
	ipcMain.handle(IPC.runStatus, () => bridge.getStatus());
	ipcMain.handle(IPC.runStart, () => bridge.startRun());
	ipcMain.handle(IPC.runStop, () => bridge.stopRun());
	ipcMain.handle(IPC.readFile, (_event, name: string) => bridge.readRepoFile(name));
	ipcMain.handle(IPC.harnesses, () => bridge.getHarnesses());
	ipcMain.handle(IPC.activeHarness, () => bridge.getActiveHarness());
	ipcMain.handle(IPC.setActiveHarness, (_event, id) => bridge.setActiveHarness(id));
	ipcMain.handle(IPC.connectHarness, (_event, id) => bridge.connectHarness(id));
	ipcMain.handle(IPC.onboardingGet, () => bridge.getOnboarding());
	ipcMain.handle(IPC.onboardingSave, (_event, answers, opts) =>
		bridge.saveOnboarding(answers, opts),
	);
	ipcMain.handle(IPC.onboardingApply, (_event, answers) =>
		bridge.applyOnboarding(answers),
	);
	ipcMain.handle(IPC.promptReset, () => bridge.resetPrompt());
	ipcMain.handle(IPC.harnessModels, () => bridge.getHarnessModels());
	ipcMain.handle(IPC.setHarnessModel, (_event, id, model) =>
		bridge.setHarnessModel(id, model),
	);
	ipcMain.handle(IPC.ntfyGet, () => bridge.getNtfySettings());
	ipcMain.handle(IPC.ntfySet, (_event, settings) => bridge.setNtfySettings(settings));
	ipcMain.handle(IPC.notesGet, () => bridge.getNotes());
	ipcMain.handle(IPC.notesSaveActive, (_event, content: string) =>
		bridge.saveActiveNote(content),
	);
	ipcMain.handle(IPC.notesCreate, (_event, opts) => bridge.createSavedNote(opts));
	ipcMain.handle(IPC.notesUpdate, (_event, id: string, opts) =>
		bridge.updateSavedNote(id, opts),
	);
	ipcMain.handle(IPC.notesDelete, (_event, id: string) => bridge.deleteSavedNote(id));
	ipcMain.handle(IPC.notesSetActive, (_event, id: string) => bridge.setActiveNote(id));
	ipcMain.handle(IPC.longTermGet, () => bridge.getLongTerm());
	ipcMain.handle(IPC.longTermAdd, (_event, input) => bridge.addLongTermItem(input));
	ipcMain.handle(IPC.longTermUpdate, (_event, id: string, fields) =>
		bridge.updateLongTermItem(id, fields),
	);
	ipcMain.handle(IPC.longTermDismiss, (_event, id: string) =>
		bridge.dismissLongTermItem(id),
	);
	ipcMain.handle(IPC.longTermSetPinned, (_event, id: string, pinned: boolean) =>
		bridge.setLongTermPinned(id, pinned),
	);
	ipcMain.handle(IPC.constraintsGet, () => bridge.getConstraints());
	ipcMain.handle(IPC.constraintsSet, (_event, constraints) =>
		bridge.setConstraints(constraints),
	);
}

app.on("ready", () => {
	if (runOnce) {
		process.env.AUTO_ROB_REAL_RUNS = "1";
		void (async () => {
			try {
				const status = await bridge.startRunAndWait();
				const code =
					status.state === "failed" ? (status.exitCode ?? 1) : (status.exitCode ?? 0);
				app.exit(code);
			} catch (err) {
				console.error(err);
				app.exit(1);
			}
		})();
		return;
	}

	registerIpc();
	createWindow();
});

app.on("window-all-closed", () => {
	if (runOnce) return;
	if (process.platform !== "darwin") {
		app.quit();
	}
});

app.on("activate", () => {
	if (runOnce) return;
	if (BrowserWindow.getAllWindows().length === 0) {
		createWindow();
	}
});

app.on("before-quit", () => {
	void bridge.stopRun();
});
