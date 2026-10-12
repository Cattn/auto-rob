import { execFile } from "node:child_process";
import { mkdir, chmod, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ForgeMakeResult } from "@electron-forge/shared-types";

const execute = promisify(execFile);

export function packagedUnixLauncher(platform: string): string {
  const target = platform === "darwin" ? '../MacOS/electron-svelte' : 'electron-svelte';
  return [
    "#!/bin/sh",
    "set -eu",
    "launcher=$0",
    'while [ -L "$launcher" ]; do',
    '  directory=$(CDPATH= cd -- "$(dirname -- "$launcher")" && pwd)',
    '  target=$(readlink "$launcher")',
    '  case "$target" in /*) launcher=$target ;; *) launcher=$directory/$target ;; esac',
    "done",
    'directory=$(CDPATH= cd -- "$(dirname -- "$launcher")" && pwd)',
    'if [ "${1-}" = "--gui" ]; then',
    "  shift",
    `  exec "$directory/${target}" "$@"`,
    "fi",
    `exec "$directory/${target}" --cli "$@"`,
    "",
  ].join("\n");
}

export async function addPackagedCli(buildPath: string, platform: string): Promise<void> {
  if (platform === "win32") {
    await writeFile(path.resolve(buildPath, "../../auto-rob.cmd"), '@echo off\r\n"%~dp0electron-svelte.exe" --cli %*\r\nexit /b %errorlevel%\r\n', "utf8");
    return;
  }
  const launcher = platform === "darwin"
    ? path.resolve(buildPath, "../auto-rob")
    : path.resolve(buildPath, "../../auto-rob");
  await writeFile(launcher, packagedUnixLauncher(platform), { mode: 0o755 });
  await chmod(launcher, 0o755);
}

export async function makeMacInstaller(results: ForgeMakeResult[]): Promise<ForgeMakeResult[]> {
  if (process.platform !== "darwin") return results;
  const result = results.find((entry) => entry.platform === "darwin");
  if (!result) return results;
  const output = path.resolve("out", `electron-svelte-darwin-${result.arch}`);
  const appName = (await readdir(output)).find((name) => name.endsWith(".app"));
  if (!appName) throw new Error("Packaged macOS app was not found.");
  const scripts = path.resolve(".vite", "pkg-scripts");
  await mkdir(scripts, { recursive: true });
  const postinstall = path.join(scripts, "postinstall");
  await writeFile(postinstall, [
    "#!/bin/sh", "set -eu",
    'destination="$3/usr/local/bin"',
    'mkdir -p "$destination"',
    `ln -sfn '/Applications/${appName}/Contents/Resources/auto-rob' "$destination/auto-rob"`,
    "",
  ].join("\n"), { mode: 0o755 });
  await chmod(postinstall, 0o755);
  const installer = path.resolve("out", "make", `auto-rob-${result.packageJSON.version}-${result.arch}.pkg`);
  await execute("pkgbuild", [
    "--component", path.join(output, appName), "--install-location", "/Applications",
    "--identifier", "com.auto-rob.desktop", "--version", result.packageJSON.version,
    "--scripts", scripts, installer,
  ]);
  result.artifacts.push(installer);
  return results;
}
