import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import started from "electron-squirrel-startup";
import { AgentBridge } from "./agent-bridge";
import { IPC } from "../shared/ipc";

if (started) {
	app.quit();
}

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
