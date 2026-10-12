import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import spawn from 'cross-spawn';

const packageInfo = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const output = path.resolve('out', `electron-svelte-${process.platform}-${process.arch}`);
const command = process.platform === 'win32' ? path.join(output, 'auto-rob.cmd')
  : process.platform === 'darwin' ? path.join(output, 'electron-svelte.app', 'Contents', 'Resources', 'auto-rob')
  : path.join(output, 'auto-rob');
await access(command);
const root = await mkdtemp(path.join(os.tmpdir(), 'auto-rob packaged cli '));
const workspace = path.join(root, 'workspace with spaces');
await mkdir(workspace);
const fake = path.join(root, 'fake.cjs');
const fakeCommand = path.join(root, process.platform === 'win32' ? 'fake.cmd' : 'fake');
const quote = value => `'${value.replace(/'/g, `'\\''`)}'`;
await writeFile(fakeCommand, process.platform === 'win32'
  ? `@echo off\r\n"${process.execPath}" "${fake}" %*\r\n`
  : `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fake)} "$@"\n`, { mode: 0o755 });
await writeFile(fake, `
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'app-server') {
  require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
    const request = JSON.parse(line);
    if (request.method === 'initialize') console.log(JSON.stringify({ id: request.id, result: {} }));
    if (request.method === 'model/list') console.log(JSON.stringify({ id: request.id, result: {
      data: [{ model: 'model-test', displayName: 'Test model', isDefault: true,
        supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'High' }],
        contextWindow: 100000, maxContextWindow: 200000 }], nextCursor: null
    } }));
  });
} else if (args[0] === '--version') console.log('test-cli 1.0');
else if (args[0] === '--list-models') console.log('auto - Auto (default)\\nmodel-high - Model High');
else if (args[0] === 'login' && args[1] === 'status') process.exit(process.env.TEST_LOGGED_OUT ? 1 : 0);
else if (args[0] === 'mcp' && args[1] === 'list') console.log(JSON.stringify([
  { name: 'robinhood-trading', enabled: true, auth_status: 'oauth',
    transport: { type: 'streamable_http', url: 'https://agent.robinhood.com/mcp/trading' } }
]));
else if (args[0] === 'exec') {
  fs.writeFileSync(process.env.TEST_ARGS_FILE, JSON.stringify(args));
  console.log(JSON.stringify({ type: 'turn.completed' }));
  process.exit(Number(process.env.TEST_EXIT_CODE || 0));
} else process.exit(9);
`);
const env = {
  ...process.env,
  AUTO_ROB_WORKSPACE: workspace,
  AUTO_ROB_HARNESS: 'codex',
  CODEX_CLI_PATH: fakeCommand,
  CURSOR_AGENT_PATH: fakeCommand,
  CODEX_HOME: root,
  TEST_ARGS_FILE: path.join(root, 'args.json'),
  NTFY_URL: '', NTFY_TOPIC: '', NTFY_TOKEN: '',
};

async function run(args, overrides = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...env, ...overrides }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`CLI timeout: ${args.join(' ')}`)); }, 30000);
    child.stdout.on('data', data => stdout += data);
    child.stderr.on('data', data => stderr += data);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

try {
  let result = await run(['--version']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.trim(), packageInfo.version);
  result = await run(['--help']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Usage: auto-rob/);
  result = await run(['--unknown']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Unknown argument/);
  result = await run(['--check']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /No strategy prompt/);
  result = await run(['list', 'codex', '--json']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).models[0].id, 'model-test');
  result = await run(['list', 'cursor', '--json']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).models.length, 2);
  await writeFile(path.join(workspace, 'prompt.md'), 'Isolated fake-CLI test.');
  await writeFile(path.join(workspace, 'auto-rob.config.json'), JSON.stringify({ activeHarness: 'codex', models: { codex: 'model-test' } }));
  result = await run(['--check']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /No portfolio job was started/);
  assert.equal(await access(env.TEST_ARGS_FILE).then(() => true, () => false), false);
  result = await run(['--check'], { TEST_LOGGED_OUT: '1' });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Sign in to ChatGPT/);
  result = await run(['--thinking', 'high', '--context', '200001']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /exceeds the limit/);
  result = await run(['--model', 'model-test', '--thinking', 'high', '--context', '100000'], { TEST_EXIT_CODE: '7' });
  assert.equal(result.code, 7, result.stderr);
  const args = JSON.parse(await readFile(env.TEST_ARGS_FILE, 'utf8'));
  assert.ok(args.includes('model_reasoning_effort="high"'));
  assert.ok(args.includes('model_context_window=100000'));
  if (process.platform === 'linux') {
    result = await run(['list', 'codex', '--json'], { DISPLAY: '', WAYLAND_DISPLAY: '' });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).models[0].id, 'model-test');
  }
  console.log('Packaged CLI passed: help/version, model listing, setup checks, settings, errors, and exit codes.');
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
