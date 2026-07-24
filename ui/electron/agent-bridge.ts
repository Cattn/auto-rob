import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { app, BrowserWindow } from "electron";
import type {
	HarnessConnection,
	HarnessId,
	HarnessModels,
	HealthInfo,
	NtfySettings,
	OnboardingAnswers,
	OnboardingApplyResult,
	OnboardingState,
	PromptResetResult,
	RunEvent,
	RunStatus,
} from "../shared/ipc";
import { IPC } from "../shared/ipc";
import {
	getActiveHarnessId,
	getHarness,
	getHarnessModels,
	isHarnessId,
	listHarnessStatuses,
	setActiveHarness,
	setHarnessModel,
} from "../../harness/index";
import {
	applyOnboardingWithAgent,
	loadOnboarding,
	normalizeAnswers,
	resetPromptToDefault,
	saveOnboarding,
} from "../../onboarding";
import { runPortfolio } from "../../run";
import {
	ensureWorkspaceSeeded,
	loadDefaultsFromRepoRoot,
	migrateWorkspaceFromRepo,
	resolveDefaultWorkspace,
} from "../../workspace";
import {
	isNtfyConfigured,
	loadEnvFile,
	readNtfySettings,
	writeNtfySettings,
} from "../../notify";
import { BUNDLED_WORKSPACE_DEFAULTS } from "./workspace-defaults";

const ALLOWED_FILES = new Set([
	"notes.md",
	"prompt.md",
	"run-log.md",
	"long-term.md",
]);

const CONFIG_FILE = "auto-rob.config.json";
const DEFAULT_ACTIVE_HARNESS: HarnessId = "cursor";
const DEFAULT_MODELS: HarnessModels = {
	cursor: "grok-4.5[effort=high,fast=true]",
	codex: "",
};
const HARNESS_CACHE_TTL_MS = 20_000;

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

type AutoRobConfigFile = {
	activeHarness: HarnessId;
	models: HarnessModels;
};

export class AgentBridge {
	private workspaceRoot: string | null = null;
	private child: ChildProcess | null = null;
	private abort: AbortController | null = null;
	private fakeTimers: ReturnType<typeof setTimeout>[] = [];
	private runningFake = false;
	private stopping = false;
	private runTask: Promise<void> | null = null;
	private harnessesCache: { at: number; data: HarnessConnection[] } | null = null;
	private harnessesInflight: Promise<HarnessConnection[]> | null = null;
	private status: RunStatus = {
		state: "idle",
		message: "Ready",
		startedAt: null,
		exitCode: null,
		fake: fakeRunsEnabled(),
	};

	async ensureRoot(): Promise<string> {
		if (this.workspaceRoot) return this.workspaceRoot;

		const envWorkspace = process.env.AUTO_ROB_WORKSPACE?.trim();
		this.workspaceRoot = envWorkspace
			? path.resolve(envWorkspace)
			: resolveDefaultWorkspace();

		let seedDefaults = BUNDLED_WORKSPACE_DEFAULTS;
		if (!app.isPackaged) {
			try {
				const repoRoot = await findRepoRoot(import.meta.dirname);
				await migrateWorkspaceFromRepo(repoRoot, this.workspaceRoot);
				seedDefaults = await loadDefaultsFromRepoRoot(repoRoot);
			} catch {
				seedDefaults = BUNDLED_WORKSPACE_DEFAULTS;
			}
		}

		await ensureWorkspaceSeeded(this.workspaceRoot, seedDefaults);
		await loadEnvFile(this.workspaceRoot);
		bridgeLog("workspace ready", this.workspaceRoot);
		return this.workspaceRoot;
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
		return this.runTask !== null || this.runningFake;
	}

	private invalidateHarnessCache() {
		this.harnessesCache = null;
	}

	private async readAutoRobConfig(): Promise<AutoRobConfigFile> {
		const workspace = await this.ensureRoot();
		let activeHarness = DEFAULT_ACTIVE_HARNESS;
		const models: HarnessModels = { ...DEFAULT_MODELS };
		try {
			const raw = await readFile(path.join(workspace, CONFIG_FILE), "utf8");
			const parsed = JSON.parse(raw) as {
				activeHarness?: string;
				models?: Partial<HarnessModels>;
			};
			if (parsed.activeHarness && isHarnessId(parsed.activeHarness)) {
				activeHarness = parsed.activeHarness;
			}
			if (parsed.models && typeof parsed.models === "object") {
				for (const id of Object.keys(DEFAULT_MODELS) as HarnessId[]) {
					if (typeof parsed.models[id] === "string") {
						models[id] = parsed.models[id]!.trim();
					}
				}
			}
		} catch {
			// missing or invalid — defaults
		}
		const envOverride = process.env.AUTO_ROB_HARNESS?.trim();
		if (envOverride && isHarnessId(envOverride)) {
			activeHarness = envOverride;
		}
		return { activeHarness, models };
	}

	private async writeAutoRobConfig(next: AutoRobConfigFile): Promise<void> {
		const workspace = await this.ensureRoot();
		await writeFile(
			path.join(workspace, CONFIG_FILE),
			`${JSON.stringify(next, null, 2)}\n`,
			"utf8",
		);
	}

	private installLogCapture(): () => void {
		const originalLog = console.log;
		const originalError = console.error;
		const originalWarn = console.warn;
		const handle = (args: unknown[]) => {
			const line = sanitizeLog(args.map(String).join(" ")).trim();
			if (!line || shouldIgnoreLogLine(line)) return;
			this.emit({ type: "log", line });
			if (/^->\s/.test(line) || line.startsWith("→")) {
				this.setStatus({
					message: line.replace(/^(?:->|→)\s*/, ""),
				});
			} else if (line.includes("done -")) {
				this.setStatus({ message: line });
			}
		};
		console.log = (...args: unknown[]) => {
			handle(args);
			originalLog(...args);
		};
		console.error = (...args: unknown[]) => {
			handle(args);
			originalError(...args);
		};
		console.warn = (...args: unknown[]) => {
			handle(args);
			originalWarn(...args);
		};
		return () => {
			console.log = originalLog;
			console.error = originalError;
			console.warn = originalWarn;
		};
	}

	async getOnboarding(): Promise<OnboardingState> {
		const workspace = await this.ensureRoot();
		return loadOnboarding(workspace);
	}

	async saveOnboarding(
		answers: OnboardingAnswers,
		opts?: { draft?: boolean },
	): Promise<OnboardingState> {
		const workspace = await this.ensureRoot();
		return saveOnboarding(workspace, normalizeAnswers(answers), {
			markCompleted: !opts?.draft,
		});
	}

	async applyOnboarding(
		answers: OnboardingAnswers,
	): Promise<OnboardingApplyResult> {
		const workspace = await this.ensureRoot();
		const normalized = normalizeAnswers(answers);
		return applyOnboardingWithAgent(workspace, normalized);
	}

	async resetPrompt(): Promise<PromptResetResult> {
		const workspace = await this.ensureRoot();
		return resetPromptToDefault(workspace);
	}

	async getHarnesses(): Promise<HarnessConnection[]> {
		const now = Date.now();
		if (this.harnessesCache && now - this.harnessesCache.at < HARNESS_CACHE_TTL_MS) {
			return this.harnessesCache.data;
		}
		if (this.harnessesInflight) return this.harnessesInflight;

		this.harnessesInflight = (async () => {
			try {
				const workspace = await this.ensureRoot();
				const statuses = await listHarnessStatuses(workspace);
				this.harnessesCache = { at: Date.now(), data: statuses };
				return statuses;
			} finally {
				this.harnessesInflight = null;
			}
		})();

		return this.harnessesInflight;
	}

	async getActiveHarness(): Promise<HarnessId> {
		const workspace = await this.ensureRoot();
		return getActiveHarnessId(workspace);
	}

	async setActiveHarness(id: HarnessId): Promise<HarnessId> {
		const workspace = await this.ensureRoot();
		await setActiveHarness(workspace, id);
		this.invalidateHarnessCache();
		return id;
	}

	async connectHarness(id: HarnessId): Promise<HarnessConnection> {
		const workspace = await this.ensureRoot();
		const status = await getHarness(id, workspace).connect({ login: true });
		this.invalidateHarnessCache();
		return status;
	}

	async getHarnessModels(): Promise<HarnessModels> {
		const workspace = await this.ensureRoot();
		return getHarnessModels(workspace);
	}

	async setHarnessModel(id: HarnessId, model: string): Promise<HarnessModels> {
		if (!isHarnessId(id)) {
			throw new Error(`Invalid harness id: ${id}`);
		}
		const workspace = await this.ensureRoot();
		const models = await setHarnessModel(workspace, id, model.trim());
		if (this.harnessesCache) {
			this.harnessesCache = {
				at: this.harnessesCache.at,
				data: this.harnessesCache.data.map((h) =>
					h.id === id ? { ...h, model: models[id] } : h,
				),
			};
		}
		return models;
	}

	async getNtfySettings(): Promise<NtfySettings> {
		const workspace = await this.ensureRoot();
		return readNtfySettings(workspace);
	}

	async setNtfySettings(input: {
		url: string;
		topic: string;
		token?: string;
		clearToken?: boolean;
	}): Promise<NtfySettings> {
		const workspace = await this.ensureRoot();
		return writeNtfySettings(workspace, input);
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
			let repoRoot = this.workspaceRoot ?? "";
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
		const workspace = await this.ensureRoot();
		try {
			const content = await readFile(path.join(workspace, name), "utf8");
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

	async startRunAndWait(): Promise<RunStatus> {
		const status = await this.startRun();
		if (this.runTask) await this.runTask;
		while (this.runningFake) {
			await new Promise((r) => setTimeout(r, 100));
		}
		return this.getStatus() ?? status;
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
		const workspace = await this.ensureRoot();
		this.stopping = false;
		this.abort = new AbortController();
		bridgeLog("starting REAL run (in-process)", `workspace=${workspace}`);
		this.emit({ type: "log", line: `Starting real run in ${workspace}` });

		this.setStatus({
			state: "running",
			message: "Starting portfolio run…",
			startedAt: Date.now(),
			exitCode: null,
			fake: false,
		});

		const restoreLogs = this.installLogCapture();
		const abort = this.abort;

		this.runTask = (async () => {
			try {
				const code = await runPortfolio(workspace, {
					signal: abort.signal,
					onSpawn: (child) => {
						this.child = child;
						bridgeLog("harness child pid=", child.pid ?? "(none)");
					},
				});
				const wasStopping = this.stopping;
				this.child = null;
				this.abort = null;
				this.stopping = false;
				if (wasStopping) {
					this.setStatus({
						state: "idle",
						message: "Stopped mid-run",
						exitCode: null,
						fake: false,
					});
					return;
				}
				if (code !== 0) {
					const message = `Run failed (exit ${code})`;
					this.emit({ type: "log", line: message });
					this.setStatus({
						state: "failed",
						message,
						exitCode: code,
					});
					return;
				}
				this.setStatus({
					state: "idle",
					message: "Run finished",
					exitCode: code,
				});
			} catch (err) {
				this.child = null;
				this.abort = null;
				const wasStopping = this.stopping;
				this.stopping = false;
				if (wasStopping) {
					this.setStatus({
						state: "idle",
						message: "Stopped mid-run",
						exitCode: null,
						fake: false,
					});
					return;
				}
				const message = err instanceof Error ? err.message : String(err);
				bridgeError("runPortfolio failed", err);
				this.emit({ type: "log", line: `ERROR: ${message}` });
				this.setStatus({
					state: "failed",
					message,
					exitCode: 1,
				});
			} finally {
				restoreLogs();
				this.runTask = null;
			}
		})();

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

		if (!this.runTask && !this.child) {
			return this.getStatus();
		}
		this.stopping = true;
		bridgeLog("stopRun — aborting in-process run");
		this.emit({
			type: "log",
			line: "Stopping run…",
		});
		this.setStatus({
			state: "running",
			message: "Stopping…",
			fake: false,
		});
		this.abort?.abort();
		if (this.child) {
			killProcessTree(this.child);
		}
		return this.getStatus();
	}
}
