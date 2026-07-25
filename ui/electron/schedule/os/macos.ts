import { spawn } from "node:child_process";
import { mkdir, writeFile, unlink, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SchedulePreset } from "../presets";
import { localTriggerTimes, type LocalParts } from "../slots";
import { resolveRunCommand } from "../path";

const LABEL = "com.auto-rob.schedule";

function plistPath(): string {
	return path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
}

function exec(
	command: string,
	args: string[],
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
		child.on("close", (code) => {
			resolve({ code: code ?? 1, stdout, stderr });
		});
	});
}

function escapeXml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
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

function buildPlist(preset: SchedulePreset): string {
	const cmd = resolveRunCommand(false);
	const programArgs = [cmd.command, ...cmd.args]
		.map((a) => `\t\t<string>${escapeXml(a)}</string>`)
		.join("\n");
	const intervals = uniqueLocalTimes(localTriggerTimes(preset))
		.flatMap((local) =>
			[1, 2, 3, 4, 5].map(
				(weekday) => `\t\t<dict>
\t\t\t<key>Weekday</key>
\t\t\t<integer>${weekday}</integer>
\t\t\t<key>Hour</key>
\t\t\t<integer>${local.hour}</integer>
\t\t\t<key>Minute</key>
\t\t\t<integer>${local.minute}</integer>
\t\t</dict>`,
			),
		)
		.join("\n");

	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>${LABEL}</string>
\t<key>ProgramArguments</key>
\t<array>
${programArgs}
\t</array>
\t<key>StartCalendarInterval</key>
\t<array>
${intervals}
\t</array>
\t<key>RunAtLoad</key>
\t<false/>
</dict>
</plist>
`;
}

async function uid(): Promise<string> {
	const result = await exec("id", ["-u"]);
	return result.stdout.trim() || String(process.getuid?.() ?? 501);
}

export async function uninstallMacSchedule(): Promise<void> {
	const plist = plistPath();
	const id = await uid();
	await exec("launchctl", ["bootout", `gui/${id}/${LABEL}`]).catch(() => {});
	await exec("launchctl", ["unload", plist]).catch(() => {});
	try {
		await unlink(plist);
	} catch {
		// ignore
	}
}

export async function installMacSchedule(preset: SchedulePreset): Promise<void> {
	await uninstallMacSchedule();
	const plist = plistPath();
	await mkdir(path.dirname(plist), { recursive: true });
	await writeFile(plist, buildPlist(preset), "utf8");
	const id = await uid();
	const boot = await exec("launchctl", ["bootstrap", `gui/${id}`, plist]);
	if (boot.code !== 0) {
		const load = await exec("launchctl", ["load", "-w", plist]);
		if (load.code !== 0) {
			throw new Error(
				boot.stderr.trim() ||
					load.stderr.trim() ||
					"Failed to load launchd agent",
			);
		}
	}
}

export async function macScheduleInstalled(): Promise<boolean> {
	try {
		await access(plistPath());
		return true;
	} catch {
		return false;
	}
}
