import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const WORKSPACE_SUBDIR = "workspace";

export type WorkspaceDefaults = {
  promptDefault: string;
  configJson: string;
  cursorCliJson: string;
  cursorPermissionsJson: string;
};

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
  await writeIfMissing(
    path.join(workspace, ".cursor", "cli.json"),
    defaults.cursorCliJson.endsWith("\n")
      ? defaults.cursorCliJson
      : `${defaults.cursorCliJson}\n`,
  );
  await writeIfMissing(
    path.join(workspace, ".cursor", "permissions.json"),
    defaults.cursorPermissionsJson.endsWith("\n")
      ? defaults.cursorPermissionsJson
      : `${defaults.cursorPermissionsJson}\n`,
  );
}

export async function loadDefaultsFromRepoRoot(
  repoRoot: string,
): Promise<WorkspaceDefaults> {
  const [
    promptDefault,
    configJson,
    cursorCliJson,
    cursorPermissionsJson,
  ] = await Promise.all([
    readFile(path.join(repoRoot, "prompt.default.md"), "utf8"),
    readFile(path.join(repoRoot, "auto-rob.config.json"), "utf8"),
    readFile(path.join(repoRoot, ".cursor", "cli.json"), "utf8"),
    readFile(path.join(repoRoot, ".cursor", "permissions.json"), "utf8"),
  ]);
  return {
    promptDefault,
    configJson,
    cursorCliJson,
    cursorPermissionsJson,
  };
}

export function resolveCliWorkspace(importMetaUrl: string): string {
  const fromEnv = process.env.AUTO_ROB_WORKSPACE?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.dirname(fileURLToPath(importMetaUrl));
}
