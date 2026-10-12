import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { installCli, windowsLauncher, windowsPathScript } from '../electron/cli-install.ts';
import { packagedUnixLauncher } from '../packaging.ts';

const execute = promisify(execFile);
const root = await mkdtemp(path.join(os.tmpdir(), 'auto-rob installation tests '));
const quote = value => `'${value.replace(/'/g, `'\\''`)}'`;

async function shell(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => stdout += data);
    child.stderr.on('data', data => stderr += data);
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
    child.stdin.end(input);
  });
}

try {
  const home = path.join(root, 'home');
  await mkdir(home);
  await writeFile(path.join(home, '.profile'), 'export EXISTING=value');
  await installCli('/Applications/Test App.app/Contents/MacOS/electron-svelte', undefined, home, 'darwin');
  await installCli('/Applications/Test App.app/Contents/MacOS/electron-svelte', undefined, home, 'darwin');
  for (const name of ['.profile', '.bash_profile', '.zprofile']) {
    const profile = await readFile(path.join(home, name), 'utf8');
    assert.equal(profile.split('\n').filter(line => line === 'export PATH="$HOME/.local/bin:$PATH"').length, 1);
  }
  assert.match(await readFile(path.join(home, '.profile'), 'utf8'), /^export EXISTING=value\n/);
  await installCli('/tmp/extracted/electron-svelte', '/home/test/Auto Rob.AppImage', home, 'linux');
  assert.match(await readFile(path.join(home, '.local/bin/auto-rob'), 'utf8'), /exec '\/home\/test\/Auto Rob.AppImage' --cli/);
  const fake = path.join(root, 'args.cjs');
  await writeFile(fake, 'console.log(JSON.stringify(process.argv.slice(2)));');
  for (const platform of ['linux', 'darwin']) {
    const directory = path.join(root, platform, 'Test App.app');
    const binDir = platform === 'darwin' ? path.join(directory, 'Contents/MacOS') : directory;
    const resourceDir = platform === 'darwin' ? path.join(directory, 'Contents/Resources') : directory;
    await mkdir(binDir, { recursive: true });
    await mkdir(resourceDir, { recursive: true });
    const executable = path.join(binDir, 'electron-svelte');
    await writeFile(executable, `#!/bin/sh\nexec ${quote(process.execPath.replaceAll('\\', '/'))} ${quote(fake.replaceAll('\\', '/'))} "$@"\n`, { mode: 0o755 });
    const launcher = path.join(resourceDir, 'auto-rob');
    const source = packagedUnixLauncher(platform);
    await writeFile(launcher, source, { mode: 0o755 });
    const interpreter = process.platform === 'win32' ? path.join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe') : '/bin/sh';
    await shell(interpreter, ['-n'], source);
    const quotedArgument = process.platform === 'win32' ? 'quoted value' : "a'b";
    let output = await shell(interpreter, [launcher.replaceAll('\\', '/'), 'model with spaces', quotedArgument]);
    assert.deepEqual(JSON.parse(output), ['--cli', 'model with spaces', quotedArgument]);
    output = await shell(interpreter, [launcher.replaceAll('\\', '/'), '--gui', 'argument']);
    assert.deepEqual(JSON.parse(output), ['argument']);
    if (process.platform !== 'win32') {
      const link = path.join(root, `linked-${platform}`);
      await symlink(launcher, link);
      output = await shell(interpreter, [link, '--help']);
      assert.deepEqual(JSON.parse(output), ['--cli', '--help']);
    }
  }
  assert.equal(windowsLauncher('C:\\Apps\\auto-rob\\app-0.2.0\\electron-svelte.exe', 'C:\\Apps\\auto-rob\\bin'), '@echo off\r\n"%~dp0..\\app-0.2.0\\electron-svelte.exe" --cli %*\r\nexit /b %errorlevel%\r\n');
  if (process.platform === 'win32') {
    const key = `Software\\AutoRobCliTests\\${process.pid}`;
    const runPowerShell = async source => (await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], { windowsHide: true })).stdout.trim();
    try {
      await runPowerShell(`$key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('${key}');$key.SetValue('Path','%USERPROFILE%\\existing;C:\\preserve',[Microsoft.Win32.RegistryValueKind]::ExpandString);$key.Dispose()`);
      await runPowerShell(windowsPathScript(root, false, key));
      await runPowerShell(windowsPathScript(root, false, key));
      let value = await runPowerShell(`$key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('${key}');$key.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames);$key.Dispose()`);
      assert.equal(value, `%USERPROFILE%\\existing;C:\\preserve;${root}`);
      await runPowerShell(windowsPathScript(root, true, key));
      value = await runPowerShell(`$key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('${key}');$key.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames);$key.Dispose()`);
      assert.equal(value, '%USERPROFILE%\\existing;C:\\preserve');
    } finally {
      await runPowerShell(`[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree('${key}', $false)`);
    }
  }
  console.log('CLI installation passed: launchers, quoting, shell profiles, and PATH registration/cleanup.');
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
