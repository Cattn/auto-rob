import { spawn } from "node:child_process";
import type { SchedulePreset } from "../presets";
import { localTriggerTimes, type LocalParts } from "../slots";
import { resolveRunCommand } from "../path";

const BEGIN = "# auto-rob schedule begin";
const END = "# auto-rob schedule end";

function exec(
	command: string,
	args: string[],
	input?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args);
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (d: Buffer) => {
			stdout += d.toString();
		});
		child.stderr?.on("data", (d: Buffer) => {
			stderr += d.toString();
		});
		child.on("error", reject);
		if (input != null) {
			child.stdin?.write(input);
			child.stdin?.end();
		}
		child.on("close", (code) => {
			resolve({ code: code ?? 1, stdout, stderr });
		});
	});
}

function quoteShell(arg: string): string {
	if (!/[^a-zA-Z0-9_./:=+-]/.test(arg)) return arg;
	return `'${arg.replace(/'/g, `'\\''`)}'`;
}

function uniqueLocalTimes(locals: LocalParts[]): LocalParts[] {
	const seen = new Set<string>();
	const out: LocalParts[] = [];
	for (const local of locals) {
		const key = `${local.hour}:${local.minute}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(local);
	}
	return out;
}

function stripManaged(crontab: string): string {
	const lines = crontab.split(/\r?\n/);
	const out: string[] = [];
	let skipping = false;
	for (const line of lines) {
		if (line.trim() === BEGIN) {
			skipping = true;
			continue;
		}
		if (line.trim() === END) {
			skipping = false;
			continue;
		}
		if (!skipping) out.push(line);
	}
	while (out.length && out[out.length - 1] === "") out.pop();
	return out.join("\n");
}

function cronLinesForTimes(locals: LocalParts[], command: string): string[] {
	const byMinute = new Map<number, number[]>();
	for (const local of locals) {
		const hours = byMinute.get(local.minute) ?? [];
		if (!hours.includes(local.hour)) hours.push(local.hour);
		byMinute.set(local.minute, hours);
	}
	return [...byMinute.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([minute, hours]) => {
			hours.sort((a, b) => a - b);
			return `${minute} ${hours.join(",")} * * 1-5 ${command}`;
		});
}

function buildManagedBlock(preset: SchedulePreset, runMissed: boolean): string {
	const cmd = resolveRunCommand(false);
	const catchUp = resolveRunCommand(true);
	const command = [cmd.command, ...cmd.args].map(quoteShell).join(" ");
	const catchUpCommand = [catchUp.command, ...catchUp.args]
		.map(quoteShell)
		.join(" ");
	const lines = [
		BEGIN,
		...cronLinesForTimes(uniqueLocalTimes(localTriggerTimes(preset)), command),
	];
	if (runMissed) {
		lines.push(`@reboot ${catchUpCommand}`);
	}
	lines.push(END);
	return lines.join("\n");
}

async function readCrontab(): Promise<string> {
	const result = await exec("crontab", ["-l"]);
	if (result.code !== 0) {
		if (/no crontab/i.test(result.stderr) || /no crontab/i.test(result.stdout)) {
			return "";
		}
		throw new Error(result.stderr.trim() || "Failed to read crontab");
	}
	return result.stdout;
}

async function writeCrontab(content: string): Promise<void> {
	const normalized = content.endsWith("\n") || content === "" ? content : `${content}\n`;
	const result = await exec("crontab", ["-"], normalized);
	if (result.code !== 0) {
		throw new Error(result.stderr.trim() || "Failed to write crontab");
	}
}

export async function uninstallLinuxSchedule(): Promise<void> {
	const current = await readCrontab().catch(() => "");
	const next = stripManaged(current);
	if (next.trim() === current.trim()) return;
	if (!next.trim()) {
		await exec("crontab", ["-r"]).catch(() => writeCrontab(""));
		return;
	}
	await writeCrontab(next);
}

export async function installLinuxSchedule(
	preset: SchedulePreset,
	runMissed: boolean,
): Promise<void> {
	const current = await readCrontab().catch(() => "");
	const base = stripManaged(current);
	const block = buildManagedBlock(preset, runMissed);
	const next = base.trim() ? `${base.trimEnd()}\n\n${block}\n` : `${block}\n`;
	await writeCrontab(next);
}

export async function linuxScheduleInstalled(): Promise<boolean> {
	const current = await readCrontab().catch(() => "");
	return current.includes(BEGIN);
}
