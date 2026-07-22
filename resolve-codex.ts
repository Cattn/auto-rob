import { access, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import which from "which";

function pathExists(filePath: string): Promise<boolean> {
  return access(filePath).then(
    () => true,
    () => false,
  );
}

function findOnPath(names: string[]): string | null {
  for (const name of names) {
    try {
      const found = which.sync(name);
      if (found) return found;
    } catch {
      // not on PATH
    }
  }
  return null;
}

function codexHome(): string {
  return process.env.CODEX_HOME?.trim() || path.join(homedir(), ".codex");
}

function localAppData(): string {
  return (
    process.env.LOCALAPPDATA ?? path.join(homedir(), "AppData", "Local")
  );
}

async function readCodexCliPathFromConfig(): Promise<string | null> {
  try {
    const raw = await readFile(path.join(codexHome(), "config.toml"), "utf8");
    const match = raw.match(
      /^\s*CODEX_CLI_PATH\s*=\s*['"]([^'"]+)['"]/m,
    );
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

async function findCachedCodexBinary(): Promise<string | null> {
  const binRoot = path.join(localAppData(), "OpenAI", "Codex", "bin");
  if (!(await pathExists(binRoot))) return null;

  const entries = await readdir(binRoot, { withFileTypes: true });
  const candidates: { file: string; mtimeMs: number }[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const exe =
      process.platform === "win32"
        ? path.join(binRoot, entry.name, "codex.exe")
        : path.join(binRoot, entry.name, "codex");
    if (!(await pathExists(exe))) continue;
    const info = await stat(exe);
    candidates.push({ file: exe, mtimeMs: info.mtimeMs });
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.file ?? null;
}

export async function resolveCodexCommand(): Promise<string> {
  const override = process.env.CODEX_CLI_PATH?.trim();
  if (override) {
    if (!(await pathExists(override))) {
      throw new Error(`CODEX_CLI_PATH not found: ${override}`);
    }
    return override;
  }

  const fromPath = findOnPath(["codex"]);
  if (fromPath) return fromPath;

  const fromConfig = await readCodexCliPathFromConfig();
  if (fromConfig && (await pathExists(fromConfig))) return fromConfig;

  const cached = await findCachedCodexBinary();
  if (cached) return cached;

  throw new Error(
    "Codex CLI not found. Install the ChatGPT/Codex app, or set CODEX_CLI_PATH to codex.exe.",
  );
}
