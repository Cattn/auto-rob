import { access } from "node:fs/promises";
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

export async function resolveAgentCommand(): Promise<string> {
  const override = process.env.CURSOR_AGENT_PATH?.trim();
  if (override) {
    if (!(await pathExists(override))) {
      throw new Error(`CURSOR_AGENT_PATH not found: ${override}`);
    }
    return override;
  }

  const fromPath = findOnPath(["agent", "cursor-agent"]);
  if (fromPath) return fromPath;

  const fallbacks =
    process.platform === "win32"
      ? [
          path.join(
            process.env.LOCALAPPDATA ?? path.join(homedir(), "AppData", "Local"),
            "cursor-agent",
            "agent.cmd",
          ),
          path.join(
            process.env.LOCALAPPDATA ?? path.join(homedir(), "AppData", "Local"),
            "cursor-agent",
            "cursor-agent.cmd",
          ),
        ]
      : [
          path.join(homedir(), ".local", "bin", "agent"),
          path.join(homedir(), ".local", "bin", "cursor-agent"),
        ];

  for (const candidate of fallbacks) {
    if (await pathExists(candidate)) return candidate;
  }

  throw new Error(
    "Cursor agent CLI not found. Install from https://cursor.com/docs/cli/installation or set CURSOR_AGENT_PATH to the agent binary.",
  );
}
