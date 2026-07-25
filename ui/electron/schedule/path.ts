import { app } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type RunCommand = {
	command: string;
	args: string[];
	display: string;
};

function quote(arg: string): string {
	if (!/[ \t"]/.test(arg)) return arg;
	return `"${arg.replace(/"/g, '\\"')}"`;
}

function quoteCmd(arg: string): string {
	return `"${arg.replace(/"/g, '""')}"`;
}

export function resolveRunCommand(catchUp = false): RunCommand {
	const flag = catchUp ? "--schedule-catch-up" : "--run-once";
	const appImage = process.env.APPIMAGE?.trim();

	if (appImage) {
		const args = [flag];
		return {
			command: appImage,
			args,
			display: `${quote(appImage)} ${args.join(" ")}`,
		};
	}

	if (app.isPackaged) {
		const args = [flag];
		return {
			command: process.execPath,
			args,
			display: `${quote(process.execPath)} ${args.join(" ")}`,
		};
	}

	const appPath = app.getAppPath();
	const args = [appPath, flag];
	return {
		command: process.execPath,
		args,
		display: `${quote(process.execPath)} ${args.map(quote).join(" ")}`,
	};
}

export function resolveRunOnceDisplay(): string {
	return resolveRunCommand(false).display;
}

export function workingDirectoryForRun(): string {
	if (app.isPackaged) {
		return path.dirname(process.execPath);
	}
	const appImage = process.env.APPIMAGE?.trim();
	if (appImage) {
		return path.dirname(appImage);
	}
	return app.getAppPath();
}

export function workingDirectoryForCommand(command: string): string {
	if (!app.isPackaged) {
		return workingDirectoryForRun();
	}
	return path.dirname(command);
}

export async function ensureWindowsScheduleLauncher(
	catchUp = false,
): Promise<string> {
	const cmd = resolveRunCommand(catchUp);
	const dir = path.join(app.getPath("userData"), "schedule");
	await mkdir(dir, { recursive: true });
	const scriptPath = path.join(
		dir,
		catchUp ? "run-catch-up.cmd" : "run-once.cmd",
	);
	const cwd = workingDirectoryForRun();
	const invoke = [cmd.command, ...cmd.args].map(quoteCmd).join(" ");
	const body = ["@echo off", `cd /d ${quoteCmd(cwd)}`, invoke, ""].join("\r\n");
	await writeFile(scriptPath, body, "utf8");
	return scriptPath;
}
