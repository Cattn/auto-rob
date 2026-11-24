import spawn from "cross-spawn";
import { consumeJsonLines, killProcessTree } from "../util.js";

export function getCodexProvider(): string | undefined {
  return process.env.AUTO_ROB_CODEX_PROVIDER?.trim() || undefined;
}

export function codexProviderArgs(): string[] {
  const provider = getCodexProvider();
  return provider ? ["-c", `model_provider=${JSON.stringify(provider)}`] : [];
}

type Request = (method: string, params: object) => Promise<unknown>;

export async function queryCodexAppServer<T>(
  command: string,
  cwd: string | undefined,
  operation: string,
  query: (request: Request) => Promise<T>,
): Promise<T> {
  const child = spawn(command, ["app-server", ...codexProviderArgs()], {
    cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  });
  const buffer = { value: "" };
  let requestId = 0;
  let pending: {
    id: number;
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
  } | undefined;
  const fail = (error: Error) => pending?.reject(error);
  const timer = setTimeout(() => fail(new Error(`${operation} timed out.`)), 20_000);
  const send = (message: object) => child.stdin?.write(`${JSON.stringify(message)}\n`);
  const request: Request = (method, params) => new Promise((resolve, reject) => {
    const id = ++requestId;
    pending = { id, resolve, reject };
    send({ id, method, params });
  });
  child.stdin?.on("error", fail);
  child.on("error", fail);
  child.on("close", (code) => fail(new Error(`${operation} exited before responding (exit ${code}).`)));
  child.stderr?.resume();
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => consumeJsonLines(chunk, buffer, (line) => {
    try {
      const message = JSON.parse(line);
      if (!pending || message.id !== pending.id) return;
      const { resolve, reject } = pending;
      pending = undefined;
      if (message.error) reject(new Error(message.error.message || `${operation} failed.`));
      else resolve(message.result);
    } catch {
      fail(new Error(`Invalid JSON from ${operation}.`));
    }
  }));

  try {
    await request("initialize", { clientInfo: { name: "auto_rob", version: "0.1.0" } });
    send({ method: "initialized" });
    return await query(request);
  } finally {
    clearTimeout(timer);
    child.stdin?.end();
    killProcessTree(child);
  }
}
