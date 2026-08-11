import { app } from "electron";
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
