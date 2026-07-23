import spawn from "cross-spawn";
import { access } from "node:fs/promises";

export const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
export const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

export function pathExists(filePath: string): Promise<boolean> {
  return access(filePath).then(
    () => true,
    () => false,
  );
}

export function runCommand(
  command: string,
  argv: string[],
  cwd?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: process.env,
    });
    if (!child) {
      reject(new Error(`Failed to spawn: ${command}`));
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ code: exitCode ?? 1, stdout, stderr });
    });
  });
}

export function consumeJsonLines(
  chunk: string,
  buffer: { value: string },
  onLine: (line: string) => void,
): void {
  buffer.value += chunk;
  const lines = buffer.value.split(/\r?\n/);
  buffer.value = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    onLine(line);
  }
}
