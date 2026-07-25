import { app } from "electron";
import { spawn } from "node:child_process";
import { writeFile, unlink, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { SchedulePreset } from "../presets";
import { localTriggerTimes, type LocalParts } from "../slots";
import { ensureWindowsScheduleLauncher } from "../path";

const TASK_NAME = "auto-rob";
const LEGACY_TASK_PREFIX = "auto-rob-slot-";

function exec(
	command: string,
	args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			windowsHide: true,
			shell: false,
		});
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

function quotePsSingle(s: string): string {
	return `'${s.replace(/'/g, "''")}'`;
}

function quoteCmdPath(p: string): string {
	return `"${p.replace(/"/g, '""')}"`;
}

function slotKey(local: LocalParts): string {
	return `${String(local.hour).padStart(2, "0")}${String(local.minute).padStart(2, "0")}`;
}

function uniqueLocalTimes(locals: LocalParts[]): LocalParts[] {
	const seen = new Set<string>();
	const out: LocalParts[] = [];
	for (const local of locals) {
		const key = slotKey(local);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(local);
	}
	return out;
}

function cmdExePath(): string {
	return path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");
}

async function scheduleDir(): Promise<string> {
	const dir = path.join(app.getPath("userData"), "schedule");
	await mkdir(dir, { recursive: true });
	return dir;
}

async function writeJobPs1(script: string): Promise<string> {
	const dir = await scheduleDir();
	const ps1Path = path.join(
		dir,
		`job-${Date.now()}-${Math.random().toString(16).slice(2)}.ps1`,
	);
	await writeFile(ps1Path, script, "utf8");
	return ps1Path;
}

async function runPs1(
	ps1Path: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
	return exec("powershell.exe", [
		"-NoProfile",
		"-NonInteractive",
		"-ExecutionPolicy",
		"Bypass",
		"-File",
		ps1Path,
	]);
}

async function runPs1Elevated(
	ps1Path: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
	const launcher = [
		`$p = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',${quotePsSingle(ps1Path)}) -Verb RunAs -Wait -PassThru`,
		`if ($null -eq $p) { exit 1 }`,
		`exit $p.ExitCode`,
	].join("; ");
	return exec("powershell.exe", [
		"-NoProfile",
		"-NonInteractive",
		"-ExecutionPolicy",
		"Bypass",
		"-Command",
		launcher,
	]);
}

async function runScheduleScript(body: string): Promise<void> {
	const dir = await scheduleDir();
	const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
	const ps1Path = path.join(dir, `job-${stamp}.ps1`);
	const logPath = path.join(dir, `job-${stamp}.log`);

	await writeFile(
		ps1Path,
		[
			`$ErrorActionPreference = 'Stop'`,
			`try {`,
			body,
			`  Set-Content -LiteralPath ${quotePsSingle(logPath)} -Value 'OK' -Encoding utf8`,
			`  exit 0`,
			`} catch {`,
			`  Set-Content -LiteralPath ${quotePsSingle(logPath)} -Value $_.Exception.Message -Encoding utf8`,
			`  exit 1`,
			`}`,
		].join("\r\n"),
		"utf8",
	);

	try {
		let result = await runPs1(ps1Path);
		if (result.code !== 0) {
			await writeFile(logPath, "", "utf8").catch(() => {});
			result = await runPs1Elevated(ps1Path);
		}

		let log = "";
		try {
			log = (await readFile(logPath, "utf8")).trim();
		} catch {
			// ignore
		}

		if (result.code === 0 || log === "OK") return;

		const detail = log || `${result.stderr}\n${result.stdout}`.trim();
		if (/canceled by the user/i.test(detail) || result.code === 1223) {
			throw new Error("Administrator permission was declined.");
		}
		throw new Error(detail || "Failed to update Windows Task Scheduler");
	} finally {
		await unlink(ps1Path).catch(() => {});
		await unlink(logPath).catch(() => {});
	}
}

type ListedTask = { taskName: string; taskPath: string };

async function listAutoRobTasks(): Promise<ListedTask[]> {
	const ps1Path = await writeJobPs1(
		[
			`Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object {`,
			`  ($_.TaskName -eq ${quotePsSingle(TASK_NAME)}) -or`,
			`  ($_.TaskName -like '${LEGACY_TASK_PREFIX}*') -or`,
			`  ($_.TaskPath -eq '\\auto-rob\\' -and $_.TaskName -like 'slot-*')`,
			`} | ForEach-Object { Write-Output ("{0}\t{1}" -f $_.TaskPath, $_.TaskName) }`,
		].join("\r\n"),
	);

	try {
		const result = await runPs1(ps1Path);
		const out: ListedTask[] = [];
		for (const line of result.stdout.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			const tab = trimmed.indexOf("\t");
			if (tab <= 0) continue;
			out.push({
				taskPath: trimmed.slice(0, tab),
				taskName: trimmed.slice(tab + 1),
			});
		}
		return out;
	} finally {
		await unlink(ps1Path).catch(() => {});
	}
}

function buildRemoveScript(tasks: ListedTask[]): string {
	if (tasks.length === 0) return "";
	return tasks
		.map(
			(t) =>
				`Unregister-ScheduledTask -TaskName ${quotePsSingle(t.taskName)} -TaskPath ${quotePsSingle(t.taskPath)} -Confirm:$false -ErrorAction SilentlyContinue`,
		)
		.join("\r\n");
}

function buildInstallScript(
	locals: LocalParts[],
	launcherPath: string,
	runMissed: boolean,
): string {
	const cmd = cmdExePath();
	const workDir = path.dirname(launcherPath);
	const arg = `/d /c ${quoteCmdPath(launcherPath)}`;
	const lines: string[] = [
		`$action = New-ScheduledTaskAction -Execute ${quotePsSingle(cmd)} -Argument ${quotePsSingle(arg)} -WorkingDirectory ${quotePsSingle(workDir)}`,
		`$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 4)${runMissed ? " -StartWhenAvailable" : ""}`,
		`$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited`,
		`$triggers = @()`,
	];

	for (const local of locals) {
		const at = `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`;
		lines.push(
			`$triggers += New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At ${quotePsSingle(at)}`,
		);
	}

	lines.push(
		`Register-ScheduledTask -TaskName ${quotePsSingle(TASK_NAME)} -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Force | Out-Null`,
	);

	return lines.join("\r\n");
}

export async function uninstallWindowsSchedule(): Promise<void> {
	const existing = await listAutoRobTasks();
	if (existing.length === 0) return;
	await runScheduleScript(buildRemoveScript(existing));
}

export async function installWindowsSchedule(
	preset: SchedulePreset,
	runMissed: boolean,
): Promise<void> {
	const existing = await listAutoRobTasks();
	const launcherPath = await ensureWindowsScheduleLauncher(false);
	const locals = uniqueLocalTimes(localTriggerTimes(preset));
	const script = [buildRemoveScript(existing), buildInstallScript(locals, launcherPath, runMissed)]
		.filter(Boolean)
		.join("\r\n");
	await runScheduleScript(script);
}

export async function windowsScheduleInstalled(): Promise<boolean> {
	const names = await listAutoRobTasks();
	return names.length > 0;
}
