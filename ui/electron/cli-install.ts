import { spawn } from "node:child_process";
import { access, chmod, mkdir, readFile, unlink, writeFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function execute(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function windowsLauncher(executable: string, binDir: string): string {
  const relative = path.win32.relative(binDir, executable).replace(/%/g, "%%");
  const target = path.win32.isAbsolute(relative) ? relative : `%~dp0${relative}`;
  return `@echo off\r\n"${target}" --cli %*\r\nexit /b %errorlevel%\r\n`;
}

export function unixLauncher(executable: string, cliFlag = true): string {
  return `#!/bin/sh\nexec ${shellQuote(executable)} ${cliFlag ? '--cli ' : ''}"$@"\n`;
}

export function windowsPathScript(binDir: string, remove: boolean, registryPath = "Environment"): string {
  const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
  return [
    "$ErrorActionPreference = 'Stop'",
    `$bin = ${quote(binDir)}`,
    `$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey(${quote(registryPath)})`,
    "$raw = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)",
    "$kind = if ($key.GetValueNames() -contains 'Path') { $key.GetValueKind('Path') } else { [Microsoft.Win32.RegistryValueKind]::ExpandString }",
    "$parts = @($raw.Split(';') | Where-Object { $_ -and $_.TrimEnd('\\') -ine $bin.TrimEnd('\\') })",
    remove ? "$next = $parts -join ';'" : "$next = (@($parts) + $bin) -join ';'",
    "if ($next -ne $raw) { $key.SetValue('Path', $next, $kind) }",
    "$key.Dispose()",
    "Add-Type -Namespace AutoRob -Name EnvironmentChange -MemberDefinition '[DllImport(\"user32.dll\", CharSet = CharSet.Unicode, SetLastError = true)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);'",
    "$result = [UIntPtr]::Zero",
    "[void][AutoRob.EnvironmentChange]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 2, 1000, [ref]$result)",
  ].join("\n");
}

async function updateWindowsPath(binDir: string, remove = false): Promise<void> {
  const script = windowsPathScript(binDir, remove);
  await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")]);
}

export async function installCli(executable = process.execPath, appImage = process.env.APPIMAGE?.trim(), home = os.homedir(), platform: NodeJS.Platform = process.platform): Promise<void> {
  if (platform === "win32") {
    const root = path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "auto-rob");
    const binDir = path.join(root, "bin");
    await mkdir(binDir, { recursive: true });
    await writeFile(path.join(binDir, "auto-rob.cmd"), windowsLauncher(executable, binDir), "utf8");
    await updateWindowsPath(binDir);
    return;
  }
  const systemCommand = platform === "darwin" ? "/usr/local/bin/auto-rob" : "/usr/bin/auto-rob";
  const packagedLauncher = platform === "darwin"
    ? path.resolve(path.dirname(executable), "../Resources/auto-rob")
    : path.join(path.dirname(executable), "auto-rob");
  if (!appImage && await realpath(systemCommand).catch(() => "") === packagedLauncher) return;
  const binDir = path.join(home, ".local", "bin");
  await mkdir(binDir, { recursive: true });
  const launcher = path.join(binDir, "auto-rob");
  const target = platform === "linux" && !appImage ? packagedLauncher : (appImage || executable);
  await writeFile(launcher, unixLauncher(target, platform !== "linux" || Boolean(appImage)), { mode: 0o755 });
  await chmod(launcher, 0o755);
  const exportPath = 'export PATH="$HOME/.local/bin:$PATH"';
  for (const name of [".profile", ".bash_profile", ".bash_login", ".zprofile"]) {
    const profile = path.join(home, name);
    if (name.startsWith(".bash_") && !(await access(profile).then(() => true, () => false))) continue;
    const content = await readFile(profile, "utf8").catch(() => "");
    if (!content.split(/\r?\n/).includes(exportPath)) {
      await writeFile(profile, `${content}${content.endsWith("\n") || !content ? "" : "\n"}${exportPath}\n`, "utf8");
    }
  }
  const fishDir = path.join(home, ".config", "fish", "conf.d");
  await mkdir(fishDir, { recursive: true });
  await writeFile(path.join(fishDir, "auto-rob.fish"), 'fish_add_path "$HOME/.local/bin"\n', "utf8");
}

export async function handleSquirrelEvent(event: string, executable = process.execPath): Promise<void> {
  if (event === "--squirrel-obsolete") return;
  const root = path.resolve(path.dirname(executable), "..");
  const binDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "auto-rob", "bin");
  if (event === "--squirrel-uninstall") {
    const launcher = path.join(binDir, "auto-rob.cmd");
    if (await readFile(launcher, "utf8").catch(() => "") === windowsLauncher(executable, binDir)) {
      await unlink(launcher);
      await updateWindowsPath(binDir, true);
    }
  } else {
    await installCli(executable);
  }
  const update = path.join(root, "Update.exe");
  if (await access(update).then(() => true, () => false)) {
    await execute(update, [`${event === "--squirrel-uninstall" ? "--removeShortcut" : "--createShortcut"}=${path.basename(executable)}`]);
  }
}
