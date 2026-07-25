import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { app, BrowserWindow } from "electron";
import type {
	Constraints,
	HarnessConnection,
	HarnessId,
	HarnessModels,
	HealthInfo,
	LongTermSize,
	LongTermState,
	LongTermType,
	LongTermUserFields,
	NotesState,
	NtfySettings,
	OnboardingAnswers,
	OnboardingApplyResult,
	OnboardingState,
	PromptResetResult,
	RunEvent,
	RunStatus,
	SchedulePreset,
	ScheduleStatus,
	TradeStyle,
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
import { killProcessTree } from "../../harness/util";
import {
	applyOnboardingWithAgent,
	loadOnboarding,
	normalizeAnswers,
	resetPromptToDefault,
	saveOnboarding,
} from "../../onboarding";
import {
	createSavedNote,
	deleteSavedNote,
	getNotesState,
	saveActiveNote,
	setActiveNote,
	updateSavedNote,
} from "../../notes-library";
import {
	addLongTermItem,
	dismissLongTermItem,
	loadLongTerm,
	setLongTermPinned,
	updateLongTermItem,
} from "../../long-term-library";
import {
	decideRunSlot,
	getScheduleStatus,
	isSchedulePreset,
	recordScheduleRun,
	setScheduleEnabled,
	setSchedulePaused,
	setSchedulePreset,
	setScheduleRunMissed,
	syncOsSchedule,
	type SlotDecision,
} from "./schedule";
import { loadConstraints, saveConstraints } from "../../constraints";
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
	private stopping = false;
	private runTask: Promise<void> | null = null;
	private harnessesCache: { at: number; data: HarnessConnection[] } | null = null;
	private harnessesInflight: Promise<HarnessConnection[]> | null = null;
	private status: RunStatus = {
		state: "idle",
		message: "Ready",
		startedAt: null,
		exitCode: null,
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

	private isBusy(): boolean {
		return this.runTask !== null;
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

	async getLongTerm(): Promise<LongTermState> {
		const workspace = await this.ensureRoot();
		return loadLongTerm(workspace);
	}

	async addLongTermItem(input: {
		title: string;
		type?: LongTermType;
		size?: LongTermSize;
		checkAfter?: string | null;
		rationale?: string;
		pinned?: boolean;
	}): Promise<LongTermState> {
		const workspace = await this.ensureRoot();
		return addLongTermItem(workspace, input);
	}

	async updateLongTermItem(
		id: string,
		fields: LongTermUserFields,
	): Promise<LongTermState> {
		const workspace = await this.ensureRoot();
		return updateLongTermItem(workspace, id, fields);
	}

	async dismissLongTermItem(id: string): Promise<LongTermState> {
		const workspace = await this.ensureRoot();
		return dismissLongTermItem(workspace, id);
	}

	async setLongTermPinned(id: string, pinned: boolean): Promise<LongTermState> {
		const workspace = await this.ensureRoot();
		return setLongTermPinned(workspace, id, pinned);
	}

	async getConstraints(): Promise<Constraints> {
		const workspace = await this.ensureRoot();
		return loadConstraints(workspace);
	}

	async setConstraints(constraints: Constraints): Promise<Constraints> {
		const workspace = await this.ensureRoot();
		return saveConstraints(workspace, constraints);
	}

	async getNotes(): Promise<NotesState> {
		const workspace = await this.ensureRoot();
		return getNotesState(workspace);
	}

	async saveActiveNote(content: string): Promise<NotesState> {
		const workspace = await this.ensureRoot();
		return saveActiveNote(workspace, content);
	}

	async createSavedNote(opts?: {
		title?: string;
		content?: string;
	}): Promise<NotesState> {
		const workspace = await this.ensureRoot();
		return createSavedNote(workspace, opts);
	}

	async updateSavedNote(
		id: string,
		opts: { title?: string; content?: string },
	): Promise<NotesState> {
		const workspace = await this.ensureRoot();
		return updateSavedNote(workspace, id, opts);
	}

	async deleteSavedNote(id: string): Promise<NotesState> {
		const workspace = await this.ensureRoot();
		return deleteSavedNote(workspace, id);
	}

	async setActiveNote(id: string): Promise<NotesState> {
		const workspace = await this.ensureRoot();
		return setActiveNote(workspace, id);
	}

	async startRun(): Promise<RunStatus> {
		bridgeLog("startRun requested", `busy=${this.isBusy()}`);
		if (this.isBusy()) {
			bridgeWarn("startRun ignored — already busy", this.getStatus());
			return this.getStatus();
		}

		try {
			const workspace = await this.ensureRoot();
			this.stopping = false;
			this.abort = new AbortController();
			bridgeLog("starting run (in-process)", `workspace=${workspace}`);
			this.emit({ type: "log", line: `Starting run in ${workspace}` });

			this.setStatus({
				state: "running",
				message: "Starting portfolio run…",
				startedAt: Date.now(),
				exitCode: null,
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
							if (this.stopping || abort.signal.aborted) {
								bridgeLog("stop already requested — killing harness child");
								killProcessTree(child);
							}
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
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			bridgeError("startRun threw", err);
			this.setStatus({
				state: "failed",
				message,
				exitCode: 1,
			});
			this.emit({ type: "log", line: `ERROR: ${message}` });
			return this.getStatus();
		}
	}

	async startRunAndWait(): Promise<RunStatus> {
		const status = await this.startRun();
		if (this.runTask) await this.runTask;
		return this.getStatus() ?? status;
	}

	async stopRun(): Promise<RunStatus> {
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
		});
		this.abort?.abort();
		if (this.child) {
			killProcessTree(this.child);
		}
		return this.getStatus();
	}

	private async harnessReady(): Promise<boolean> {
		const list = await this.getHarnesses();
		return list.some(
			(h) => h.binaryOk && h.mcpConfigured && h.mcpAuthenticated,
		);
	}

	private async currentTradeStyle(): Promise<TradeStyle> {
		const onboarding = await this.getOnboarding();
		return onboarding.answers.tradeStyle;
	}

	async getSchedule(): Promise<ScheduleStatus> {
		const workspace = await this.ensureRoot();
		const harnessReady = await this.harnessReady();
		const tradeStyle = await this.currentTradeStyle();
		return getScheduleStatus(workspace, { harnessReady, tradeStyle });
	}

	async syncScheduleOnLaunch(): Promise<void> {
		const workspace = await this.ensureRoot();
		const harnessReady = await this.harnessReady();
		await syncOsSchedule(workspace, harnessReady);
	}

	async setScheduleEnabled(enabled: boolean): Promise<ScheduleStatus> {
		const workspace = await this.ensureRoot();
		const harnessReady = await this.harnessReady();
		const tradeStyle = await this.currentTradeStyle();
		return setScheduleEnabled(workspace, enabled, harnessReady, tradeStyle);
	}

	async setSchedulePaused(paused: boolean): Promise<ScheduleStatus> {
		const workspace = await this.ensureRoot();
		const harnessReady = await this.harnessReady();
		const tradeStyle = await this.currentTradeStyle();
		return setSchedulePaused(workspace, paused, harnessReady, tradeStyle);
	}

	async setSchedulePreset(preset: SchedulePreset): Promise<ScheduleStatus> {
		if (!isSchedulePreset(preset)) {
			throw new Error(`Invalid schedule preset: ${preset}`);
		}
		const workspace = await this.ensureRoot();
		const harnessReady = await this.harnessReady();
		const tradeStyle = await this.currentTradeStyle();
		return setSchedulePreset(workspace, preset, harnessReady, tradeStyle);
	}

	async setScheduleRunMissed(runMissed: boolean): Promise<ScheduleStatus> {
		const workspace = await this.ensureRoot();
		const harnessReady = await this.harnessReady();
		const tradeStyle = await this.currentTradeStyle();
		return setScheduleRunMissed(workspace, runMissed, harnessReady, tradeStyle);
	}

	async decideScheduledRun(catchUp: boolean): Promise<SlotDecision> {
		const workspace = await this.ensureRoot();
		const harnessReady = await this.harnessReady();
		return decideRunSlot(workspace, { catchUp, harnessReady });
	}

	async recordScheduledRun(slotId: string): Promise<void> {
		const workspace = await this.ensureRoot();
		await recordScheduleRun(workspace, slotId);
	}
}
