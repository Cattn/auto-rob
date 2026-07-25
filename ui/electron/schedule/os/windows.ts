import { spawn } from "node:child_process";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SchedulePreset } from "../presets";
import { localTriggerTimes, type LocalParts } from "../slots";
import {
	resolveRunCommand,
	workingDirectoryForCommand,
} from "../path";

const TASK_PREFIX = "auto-rob\\slot-";

function execSchtasks(
	args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn("schtasks", args, {
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

function slotKey(local: LocalParts): string {
	return `${String(local.hour).padStart(2, "0")}${String(local.minute).padStart(2, "0")}`;
}

function escapeXml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function quoteArg(arg: string): string {
	if (!/[ \t"]/.test(arg)) return arg;
	return `"${arg.replace(/"/g, '\\"')}"`;
}

function buildTaskXml(
	taskName: string,
	local: LocalParts,
	command: string,
	args: string[],
	cwd: string,
	runMissed: boolean,
): string {
	const startBoundary = new Date();
	startBoundary.setFullYear(startBoundary.getFullYear(), startBoundary.getMonth(), startBoundary.getDate());
	startBoundary.setHours(local.hour, local.minute, 0, 0);
	const pad = (n: number) => String(n).padStart(2, "0");
	const boundary = `${startBoundary.getFullYear()}-${pad(startBoundary.getMonth() + 1)}-${pad(startBoundary.getDate())}T${pad(local.hour)}:${pad(local.minute)}:00`;
	const argsLine = args.map(quoteArg).join(" ");
	return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <URI>\\${escapeXml(taskName)}</URI>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>${boundary}</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByWeek>
        <WeeksInterval>1</WeeksInterval>
        <DaysOfWeek>
          <Monday /><Tuesday /><Wednesday /><Thursday /><Friday />
        </DaysOfWeek>
      </ScheduleByWeek>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>${runMissed ? "true" : "false"}</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT4H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${escapeXml(command)}</Command>
      ${argsLine ? `<Arguments>${escapeXml(argsLine)}</Arguments>` : ""}
      <WorkingDirectory>${escapeXml(cwd)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
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

async function listAutoRobTasks(): Promise<string[]> {
	const result = await execSchtasks(["/Query", "/FO", "LIST"]);
	const names: string[] = [];
	for (const line of result.stdout.split(/\r?\n/)) {
		const match = line.match(/^TaskName:\s+(.+)$/i);
		if (!match) continue;
		const name = match[1]!.trim().replace(/^\\/, "");
		if (name.startsWith("auto-rob\\slot-") || name.startsWith("auto-rob/slot-")) {
			names.push(name);
		}
	}
	return names;
}

export async function uninstallWindowsSchedule(): Promise<void> {
	const names = await listAutoRobTasks();
	for (const name of names) {
		await execSchtasks(["/Delete", "/TN", name, "/F"]);
	}
}

export async function installWindowsSchedule(
	preset: SchedulePreset,
	runMissed: boolean,
): Promise<void> {
	await uninstallWindowsSchedule();
	const cmd = resolveRunCommand(false);
	const cwd = workingDirectoryForCommand(cmd.command);
	const locals = uniqueLocalTimes(localTriggerTimes(preset));
	const tmpDir = path.join(os.tmpdir(), "auto-rob-schedule");
	await mkdir(tmpDir, { recursive: true });

	for (const local of locals) {
		const key = slotKey(local);
		const taskName = `${TASK_PREFIX}${key}`;
		const xmlPath = path.join(tmpDir, `${key}.xml`);
		const xml = buildTaskXml(
			taskName,
			local,
			cmd.command,
			cmd.args,
			cwd,
			runMissed,
		);
		await writeFile(xmlPath, `\uFEFF${xml}`, "utf16le");
		const result = await execSchtasks([
			"/Create",
			"/TN",
			taskName,
			"/XML",
			xmlPath,
			"/F",
		]);
		try {
			await unlink(xmlPath);
		} catch {
			// ignore
		}
		if (result.code !== 0) {
			throw new Error(
				result.stderr.trim() ||
					result.stdout.trim() ||
					`schtasks failed for ${taskName}`,
			);
		}
	}
}

export async function windowsScheduleInstalled(): Promise<boolean> {
	const names = await listAutoRobTasks();
	return names.length > 0;
}
