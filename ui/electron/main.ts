import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import started from "electron-squirrel-startup";
import { AgentBridge } from "./agent-bridge";
import { IPC } from "../shared/ipc";

if (started) {
	app.quit();
}

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
	ipcMain.handle(IPC.harnessModels, () => bridge.getHarnessModels());
	ipcMain.handle(IPC.setHarnessModel, (_event, id, model) =>
		bridge.setHarnessModel(id, model),
	);
}

app.on("ready", () => {
	registerIpc();
	createWindow();
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) {
		createWindow();
	}
});

app.on("before-quit", () => {
	void bridge.stopRun();
});
