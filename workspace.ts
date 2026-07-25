import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const APP_DATA_DIR_NAME = "auto-rob";
export const WORKSPACE_SUBDIR = "workspace";

export type WorkspaceDefaults = {
  promptDefault: string;
  configJson: string;
  cursorCliJson: string;
  cursorPermissionsJson: string;
  envExample?: string;
};

const MIGRATE_FILES = [
  "prompt.md",
  "prompt.default.md",
  "notes.md",
  "run-log.md",
  "long-term.md",
  "onboarding.json",
  "auto-rob.config.json",
  ".env",
  path.join(".cursor", "cli.json"),
  path.join(".cursor", "permissions.json"),
] as const;

function pathExists(filePath: string): Promise<boolean> {
  return access(filePath).then(
    () => true,
    () => false,
  );
}

async function writeIfMissing(
  filePath: string,
  contents: string,
): Promise<void> {
  if (await pathExists(filePath)) return;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

export function resolveOsUserDataDir(): string {
  if (process.platform === "win32") {
    const appData =
      process.env.APPDATA?.trim() ||
      path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, APP_DATA_DIR_NAME);
  }
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      APP_DATA_DIR_NAME,
    );
  }
  const xdg =
    process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), ".config");
  return path.join(xdg, APP_DATA_DIR_NAME);
}

export function resolveDefaultWorkspace(): string {
  return path.join(resolveOsUserDataDir(), WORKSPACE_SUBDIR);
}

export function resolveCliWorkspace(_importMetaUrl?: string): string {
  const fromEnv = process.env.AUTO_ROB_WORKSPACE?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return resolveDefaultWorkspace();
}

export function resolveRepoRoot(importMetaUrl: string): string {
  return path.dirname(fileURLToPath(importMetaUrl));
}

export async function ensureWorkspaceSeeded(
  workspace: string,
  defaults: WorkspaceDefaults,
): Promise<void> {
  await mkdir(workspace, { recursive: true });
  await mkdir(path.join(workspace, ".cursor"), { recursive: true });

  await writeIfMissing(
    path.join(workspace, "prompt.default.md"),
    defaults.promptDefault,
  );
  await writeIfMissing(path.join(workspace, "prompt.md"), defaults.promptDefault);
  await writeIfMissing(path.join(workspace, "notes.md"), "");
  await writeIfMissing(path.join(workspace, "run-log.md"), "");
  await writeIfMissing(path.join(workspace, "long-term.md"), "");
  await writeIfMissing(
    path.join(workspace, "auto-rob.config.json"),
    defaults.configJson.endsWith("\n")
      ? defaults.configJson
      : `${defaults.configJson}\n`,
  );
  const cliJson = defaults.cursorCliJson.endsWith("\n")
    ? defaults.cursorCliJson
    : `${defaults.cursorCliJson}\n`;
  const permissionsJson = defaults.cursorPermissionsJson.endsWith("\n")
    ? defaults.cursorPermissionsJson
    : `${defaults.cursorPermissionsJson}\n`;
  await mkdir(path.join(workspace, ".cursor"), { recursive: true });
  await writeFile(path.join(workspace, ".cursor", "cli.json"), cliJson, "utf8");
  await writeFile(
    path.join(workspace, ".cursor", "permissions.json"),
    permissionsJson,
    "utf8",
  );
  if (defaults.envExample !== undefined) {
    await writeIfMissing(path.join(workspace, ".env"), defaults.envExample);
  }
}

export async function migrateWorkspaceFromRepo(
  repoRoot: string,
  workspace: string,
): Promise<string[]> {
  await mkdir(workspace, { recursive: true });
  const copied: string[] = [];
  for (const rel of MIGRATE_FILES) {
    const src = path.join(repoRoot, rel);
    const dest = path.join(workspace, rel);
    if (!(await pathExists(src))) continue;
    if (await pathExists(dest)) continue;
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(src, dest);
    copied.push(rel);
  }
  return copied;
}

export async function loadDefaultsFromRepoRoot(
  repoRoot: string,
): Promise<WorkspaceDefaults> {
  const [
    promptDefault,
    configJson,
    cursorCliJson,
    cursorPermissionsJson,
    envExample,
  ] = await Promise.all([
    readFile(path.join(repoRoot, "prompt.default.md"), "utf8"),
    readFile(path.join(repoRoot, "auto-rob.config.json"), "utf8"),
    readFile(path.join(repoRoot, ".cursor", "cli.json"), "utf8"),
    readFile(path.join(repoRoot, ".cursor", "permissions.json"), "utf8"),
    readFile(path.join(repoRoot, ".env.example"), "utf8").catch(() => undefined),
  ]);
  return {
    promptDefault,
    configJson,
    cursorCliJson,
    cursorPermissionsJson,
    envExample,
  };
}

export async function prepareCliWorkspace(
  importMetaUrl: string,
  explicitRoot?: string,
): Promise<string> {
  const workspace = explicitRoot
    ? path.resolve(explicitRoot)
    : resolveCliWorkspace(importMetaUrl);
  const repoRoot = resolveRepoRoot(importMetaUrl);
  await migrateWorkspaceFromRepo(repoRoot, workspace);
  const defaults = await loadDefaultsFromRepoRoot(repoRoot);
  await ensureWorkspaceSeeded(workspace, defaults);
  return workspace;
}
