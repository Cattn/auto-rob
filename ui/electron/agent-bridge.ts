import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { BrowserWindow } from "electron";
import type {
	HarnessConnection,
	HarnessId,
	HarnessModels,
	HealthInfo,
	RunEvent,
	RunStatus,
} from "../shared/ipc";
import { IPC } from "../shared/ipc";

const ALLOWED_FILES = new Set([
	"notes.md",
	"prompt.md",
	"run-log.md",
	"long-term.md",
]);

const LOG_PREFIX = "[auto-rob]";

function bridgeLog(...args: unknown[]) {
	console.log(LOG_PREFIX, ...args);
}

function bridgeWarn(...args: unknown[]) {
	console.warn(LOG_PREFIX, ...args);
}

function bridgeError(...args: unknown[]) {
	console.error(LOG_PREFIX, ...args);
}

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function sanitizeLog(text: string): string {
	return stripAnsi(text)
		.replace(/\u2192/g, "->")
		.replace(/\u2713/g, "ok")
		.replace(/\u2717/g, "x")
		.replace(/\u00d4\u00e5\u00c6/g, "->")
		.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "");
}

function shouldIgnoreLogLine(line: string): boolean {
	return (
		line.startsWith("npm warn Unknown env config") ||
		line.startsWith("cursor-retrieval: tracing to")
	);
}

function killProcessTree(child: ChildProcess): void {
	const pid = child.pid;
	if (!pid) {
		child.kill();
		return;
	}
	if (process.platform === "win32") {
		spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
			windowsHide: true,
			stdio: "ignore",
			shell: false,
		}).on("error", (err) => {
			bridgeWarn("taskkill failed, falling back to child.kill()", err);
			try {
				child.kill();
			} catch {
				// ignore
			}
		});
		return;
	}
	try {
		process.kill(-pid, "SIGTERM");
	} catch {
		try {
			child.kill("SIGTERM");
		} catch {
			// ignore
		}
	}
}

function fakeRunsEnabled(): boolean {
	return process.env.AUTO_ROB_REAL_RUNS !== "1";
}

function pathExists(filePath: string): Promise<boolean> {
	return access(filePath).then(
		() => true,
		() => false,
	);
}

export async function findRepoRoot(startDir: string): Promise<string> {
	let dir = startDir;
	for (;;) {
		const packageJson = path.join(dir, "package.json");
		const indexTs = path.join(dir, "index.ts");
		const prompt = path.join(dir, "prompt.md");
		if (
			(await pathExists(packageJson)) &&
			(await pathExists(indexTs)) &&
			(await pathExists(prompt))
		) {
			return dir;
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			throw new Error("Could not find auto-rob repo root (index.ts + prompt.md)");
		}
		dir = parent;
	}
}

async function loadEnvFile(repoRoot: string): Promise<void> {
	try {
		const raw = await readFile(path.join(repoRoot, ".env"), "utf8");
		for (const line of raw.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const eq = trimmed.indexOf("=");
			if (eq <= 0) continue;
			const key = trimmed.slice(0, eq).trim();
			let value = trimmed.slice(eq + 1).trim();
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
			}
			if (!(key in process.env)) process.env[key] = value;
		}
	} catch {
		// optional
	}
}

function isNtfyConfigured(): boolean {
	const baseUrl = (process.env.NTFY_URL ?? "").replace(/\/$/, "");
	const topic = process.env.NTFY_TOPIC ?? "";
	return Boolean(baseUrl && topic);
}

function runCommand(
	command: string,
	args: string[],
	cwd: string,
): Promise<{ code: number; out: string; err: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			env: process.env,
			windowsHide: true,
			shell: process.platform === "win32",
			stdio: ["ignore", "pipe", "pipe"],
		});
		let out = "";
		let err = "";
		child.stdout?.setEncoding("utf8");
		child.stderr?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			out += chunk;
		});
		child.stderr?.on("data", (chunk: string) => {
			err += chunk;
		});
		child.on("error", reject);
		child.on("close", (code) =>
			resolve({ code: code ?? 1, out: out.trim(), err: err.trim() }),
		);
	});
}

function parseJson<T>(text: string): T {
	const marker = "__AUTO_ROB_JSON__";
	const idx = text.lastIndexOf(marker);
	const slice = idx >= 0 ? text.slice(idx + marker.length).trim() : text.trim();
	const start = slice.indexOf("{");
	const end = slice.lastIndexOf("}");
	if (start < 0 || end < start) {
		throw new Error(`Expected JSON object, got: ${text.slice(0, 200)}`);
	}
	return JSON.parse(slice.slice(start, end + 1)) as T;
}

export class AgentBridge {
	private repoRoot: string | null = null;
	private child: ChildProcess | null = null;
	private fakeTimers: ReturnType<typeof setTimeout>[] = [];
	private runningFake = false;
	private stopping = false;
	private status: RunStatus = {
		state: "idle",
		message: "Ready",
		startedAt: null,
		exitCode: null,
		fake: fakeRunsEnabled(),
	};

	async ensureRoot(): Promise<string> {
		if (this.repoRoot) return this.repoRoot;
		this.repoRoot = await findRepoRoot(import.meta.dirname);
		await loadEnvFile(this.repoRoot);
		return this.repoRoot;
	}

	getStatus(): RunStatus {
		return { ...this.status };
	}

	private setStatus(partial: Partial<RunStatus>) {
		this.status = { ...this.status, ...partial };
		this.emit({ type: "status", status: this.getStatus() });
	}

	private emit(event: RunEvent) {
		for (const win of BrowserWindow.getAllWindows()) {
			win.webContents.send(IPC.runEvent, event);
		}
	}

	private clearFakeTimers() {
		for (const timer of this.fakeTimers) clearTimeout(timer);
		this.fakeTimers = [];
		this.runningFake = false;
	}

	private isBusy(): boolean {
		return this.child !== null || this.runningFake;
	}

	private async harnessCli(args: string[]): Promise<string> {
		const repoRoot = await this.ensureRoot();
		const npx = process.platform === "win32" ? "npx.cmd" : "npx";
		bridgeLog("harness-cli", args.join(" "), `(cwd=${repoRoot})`);
		const result = await runCommand(
			npx,
			["--yes", "tsx", "harness-cli.ts", ...args, "--root", repoRoot],
			repoRoot,
		);
		if (result.code !== 0) {
			bridgeError(
				"harness-cli failed",
				`exit=${result.code}`,
				result.err || result.out || "(no output)",
			);
			throw new Error(result.err || result.out || `harness-cli failed (exit ${result.code})`);
		}
		return result.out;
	}

	async getHarnesses(): Promise<HarnessConnection[]> {
		const out = await this.harnessCli(["list"]);
		const parsed = parseJson<{ statuses: HarnessConnection[] }>(out);
		return parsed.statuses;
	}

	async getActiveHarness(): Promise<HarnessId> {
		const out = await this.harnessCli(["active"]);
		const parsed = parseJson<{ activeHarness: HarnessId }>(out);
		return parsed.activeHarness;
	}

	async setActiveHarness(id: HarnessId): Promise<HarnessId> {
		const out = await this.harnessCli(["set-active", id]);
		const parsed = parseJson<{ activeHarness: HarnessId }>(out);
		return parsed.activeHarness;
	}

	async connectHarness(id: HarnessId): Promise<HarnessConnection> {
		const out = await this.harnessCli(["connect", id]);
		return parseJson<HarnessConnection>(out);
	}

	async getHarnessModels(): Promise<HarnessModels> {
		const out = await this.harnessCli(["models"]);
		const parsed = parseJson<{ models: HarnessModels }>(out);
		return parsed.models;
	}

	async setHarnessModel(id: HarnessId, model: string): Promise<HarnessModels> {
		const out = await this.harnessCli(["set-model", id, model]);
		const parsed = parseJson<{ models: HarnessModels }>(out);
		return parsed.models;
	}

	async getHealth(): Promise<HealthInfo> {
		const fakeRuns = fakeRunsEnabled();
		try {
			const repoRoot = await this.ensureRoot();
			const [activeHarness, harnesses] = await Promise.all([
				this.getActiveHarness(),
				this.getHarnesses(),
			]);
			const active = harnesses.find((h) => h.id === activeHarness) ?? null;
			const ok = Boolean(active?.binaryOk);
			return {
				ok,
				repoRoot,
				agentPath: active?.binaryPath ?? null,
				agentVersion: active?.binaryOk ? active.id : null,
				ntfyConfigured: isNtfyConfigured(),
				fakeRuns,
				error: ok ? null : (active?.error ?? "Active harness CLI not found"),
				activeHarness,
				harnesses,
			};
		} catch (err) {
			let repoRoot = this.repoRoot ?? "";
			try {
				repoRoot = await this.ensureRoot();
			} catch {
				// keep empty
			}
			return {
				ok: false,
				repoRoot,
				agentPath: null,
				agentVersion: null,
				ntfyConfigured: isNtfyConfigured(),
				fakeRuns,
				error: err instanceof Error ? err.message : String(err),
				activeHarness: "cursor",
				harnesses: [],
			};
		}
	}

	async readRepoFile(name: string): Promise<string | null> {
		if (!ALLOWED_FILES.has(name)) {
			throw new Error(`File not allowed: ${name}`);
		}
		const repoRoot = await this.ensureRoot();
		try {
			const content = await readFile(path.join(repoRoot, name), "utf8");
			return content;
		} catch {
			return null;
		}
	}

	async startRun(): Promise<RunStatus> {
		bridgeLog(
			"startRun requested",
			`busy=${this.isBusy()}`,
			`fake=${fakeRunsEnabled()}`,
			`AUTO_ROB_REAL_RUNS=${process.env.AUTO_ROB_REAL_RUNS ?? "(unset)"}`,
		);
		if (this.isBusy()) {
			bridgeWarn("startRun ignored — already busy", this.getStatus());
			return this.getStatus();
		}

		if (fakeRunsEnabled()) {
			bridgeLog("starting fake/dry run");
			return this.startFakeRun();
		}

		try {
			return await this.startRealRun();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			bridgeError("startRealRun threw", err);
			this.setStatus({
				state: "failed",
				message,
				exitCode: 1,
				fake: false,
			});
			this.emit({ type: "log", line: `ERROR: ${message}` });
			return this.getStatus();
		}
	}

	private startFakeRun(): RunStatus {
		this.runningFake = true;
		this.setStatus({
			state: "running",
			message: "[fake] Starting dry run…",
			startedAt: Date.now(),
			exitCode: null,
			fake: true,
		});

		const steps: Array<{ at: number; message: string; log?: string }> = [
			{ at: 400, message: "[fake] Checking portfolio…", log: "-> get_portfolio()" },
			{ at: 1100, message: "[fake] Scanning watchlist…", log: "-> get_watchlist_items()" },
			{ at: 2000, message: "[fake] No trades (dry run)", log: "-> skip place_equity_order" },
		];

		for (const step of steps) {
			this.fakeTimers.push(
				setTimeout(() => {
					if (!this.runningFake) return;
					if (step.log) this.emit({ type: "log", line: step.log });
					this.setStatus({ message: step.message });
				}, step.at),
			);
		}

		this.fakeTimers.push(
			setTimeout(() => {
				if (!this.runningFake) return;
				this.runningFake = false;
				this.fakeTimers = [];
				this.setStatus({
					state: "idle",
					message: "[fake] Dry run finished · no trades",
					exitCode: 0,
					fake: true,
				});
			}, 2800),
		);

		return this.getStatus();
	}

	private async startRealRun(): Promise<RunStatus> {
		const repoRoot = await this.ensureRoot();
		const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
		const recentLines: string[] = [];
		const lineBuf = { stdout: "", stderr: "" };
		const pushRecent = (line: string) => {
			recentLines.push(line);
			if (recentLines.length > 40) recentLines.shift();
		};

		const handleLine = (stream: "stdout" | "stderr", raw: string) => {
			const trimmed = sanitizeLog(raw).trim();
			if (!trimmed || shouldIgnoreLogLine(trimmed)) return;
			pushRecent(trimmed);
			if (stream === "stderr") {
				bridgeWarn(`run ${stream}:`, trimmed);
			} else {
				bridgeLog(`run ${stream}:`, trimmed);
			}
			this.emit({ type: "log", line: trimmed });
			if (/^->\s/.test(trimmed) || trimmed.startsWith("→")) {
				this.setStatus({
					message: trimmed.replace(/^(?:->|→)\s*/, ""),
				});
			} else if (trimmed.includes("done -")) {
				this.setStatus({ message: trimmed });
			}
		};

		const onChunk = (stream: "stdout" | "stderr", chunk: string) => {
			lineBuf[stream] += sanitizeLog(chunk.toString());
			const parts = lineBuf[stream].split(/\r?\n/);
			lineBuf[stream] = parts.pop() ?? "";
			for (const part of parts) handleLine(stream, part);
		};

		const flushBuffers = () => {
			for (const stream of ["stdout", "stderr"] as const) {
				if (lineBuf[stream].trim()) {
					handleLine(stream, lineBuf[stream]);
					lineBuf[stream] = "";
				}
			}
		};

		this.stopping = false;
		bridgeLog("starting REAL run", `cwd=${repoRoot}`, `cmd=${npmCmd} start`);
		this.emit({ type: "log", line: `Starting real run in ${repoRoot}` });
		this.emit({ type: "log", line: `Spawn: ${npmCmd} start` });

		this.setStatus({
			state: "running",
			message: "Starting portfolio run…",
			startedAt: Date.now(),
			exitCode: null,
			fake: false,
		});

		this.child = spawn(npmCmd, ["start"], {
			cwd: repoRoot,
			env: {
				...process.env,
				PYTHONIOENCODING: "utf-8",
				...(process.platform === "win32" ? { PYTHONUTF8: "1" } : {}),
			},
			windowsHide: true,
			shell: process.platform === "win32",
			stdio: ["ignore", "pipe", "pipe"],
		});
		bridgeLog("spawned child pid=", this.child.pid ?? "(none)");

		this.child.stdout?.setEncoding("utf8");
		this.child.stderr?.setEncoding("utf8");
		this.child.stdout?.on("data", (chunk: string) => onChunk("stdout", chunk));
		this.child.stderr?.on("data", (chunk: string) => onChunk("stderr", chunk));

		this.child.on("error", (err) => {
			bridgeError("child process error", err);
			this.child = null;
			this.stopping = false;
			const message = `Spawn failed: ${err.message}`;
			this.emit({ type: "log", line: message });
			this.setStatus({
				state: "failed",
				message,
				exitCode: 1,
			});
		});

		this.child.on("close", (code, signal) => {
			flushBuffers();
			this.child = null;
			const wasStopping = this.stopping;
			this.stopping = false;
			const exitCode = code ?? 1;
			bridgeLog(
				"child closed",
				`exit=${code}`,
				`signal=${signal ?? "(none)"}`,
				`stopping=${wasStopping}`,
				`recentLines=${recentLines.length}`,
			);
			if (wasStopping) {
				this.setStatus({
					state: "idle",
					message: "Stopped mid-run",
					exitCode: null,
					fake: false,
				});
				return;
			}
			if (exitCode !== 0) {
				const tail = recentLines.slice(-8);
				for (const line of tail) {
					bridgeError("run tail:", line);
				}
				const detail = tail.length
					? tail[tail.length - 1]
					: "(no process output — check the Electron terminal for [auto-rob] logs)";
				const message = `Run failed (exit ${exitCode}): ${detail}`;
				this.emit({ type: "log", line: message });
				if (tail.length > 1) {
					this.emit({
						type: "log",
						line: `Last output:\n${tail.join("\n")}`,
					});
				}
				this.setStatus({
					state: "failed",
					message,
					exitCode,
				});
				return;
			}
			this.setStatus({
				state: "idle",
				message: "Run finished",
				exitCode,
			});
		});

		return this.getStatus();
	}

	async stopRun(): Promise<RunStatus> {
		if (this.runningFake) {
			this.clearFakeTimers();
			this.setStatus({
				state: "idle",
				message: "[fake] Stopped dry run",
				exitCode: null,
				fake: true,
			});
			return this.getStatus();
		}

		if (!this.child) {
			return this.getStatus();
		}
		const child = this.child;
		const pid = child.pid;
		this.stopping = true;
		bridgeLog("stopRun — killing process tree", `pid=${pid ?? "(none)"}`);
		this.emit({
			type: "log",
			line: `Stopping run (killing process tree pid=${pid ?? "?"})…`,
		});
		this.setStatus({
			state: "running",
			message: "Stopping…",
			fake: false,
		});
		killProcessTree(child);
		return this.getStatus();
	}
}
