import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

export const ENV_FILE = ".env";
export const BRIEF_FILE = ".notify-brief.md";
export const SENT_MARKER = ".notify-sent";

const NTFY_KEYS = ["NTFY_URL", "NTFY_TOPIC", "NTFY_TOKEN"] as const;

export type NotifyOptions = {
  title?: string;
  priority?: 1 | 2 | 3 | 4 | 5;
  tags?: string[];
  click?: string;
};

export type NtfySettings = {
  url: string;
  topic: string;
  tokenConfigured: boolean;
  configured: boolean;
};

function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const eq = trimmed.indexOf("=");
  if (eq <= 0) return null;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

function quoteEnvValue(value: string): string {
  if (/[\s#"']/.test(value) || value.includes("\\")) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

export async function loadEnvFile(workspace = packageRoot): Promise<void> {
  try {
    const raw = await readFile(path.join(workspace, ENV_FILE), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (!parsed) continue;
      if (!(parsed.key in process.env)) process.env[parsed.key] = parsed.value;
    }
  } catch {
    // optional
  }
}

export function isNtfyConfigured(): boolean {
  const baseUrl = (process.env.NTFY_URL ?? "").replace(/\/$/, "");
  const topic = process.env.NTFY_TOPIC ?? "";
  return Boolean(baseUrl && topic);
}

export async function readNtfySettings(
  workspace = packageRoot,
): Promise<NtfySettings> {
  const fromFile: Record<string, string> = {};
  try {
    const raw = await readFile(path.join(workspace, ENV_FILE), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (!parsed) continue;
      if ((NTFY_KEYS as readonly string[]).includes(parsed.key)) {
        fromFile[parsed.key] = parsed.value;
      }
    }
  } catch {
    // optional
  }

  const url = (fromFile.NTFY_URL ?? process.env.NTFY_URL ?? "").trim();
  const topic = (fromFile.NTFY_TOPIC ?? process.env.NTFY_TOPIC ?? "").trim();
  const token = (fromFile.NTFY_TOKEN ?? process.env.NTFY_TOKEN ?? "").trim();
  return {
    url,
    topic,
    tokenConfigured: Boolean(token),
    configured: Boolean(url.replace(/\/$/, "") && topic),
  };
}

export async function writeNtfySettings(
  workspace: string,
  input: { url: string; topic: string; token?: string; clearToken?: boolean },
): Promise<NtfySettings> {
  const url = input.url.trim().replace(/[\r\n]/g, "");
  const topic = input.topic.trim().replace(/[\r\n]/g, "");
  const existingToken = (
    await (async () => {
      try {
        const raw = await readFile(path.join(workspace, ENV_FILE), "utf8");
        for (const line of raw.split(/\r?\n/)) {
          const parsed = parseEnvLine(line);
          if (parsed?.key === "NTFY_TOKEN") return parsed.value.trim();
        }
      } catch {
        // optional
      }
      return (process.env.NTFY_TOKEN ?? "").trim();
    })()
  );
  const tokenInput = (input.token ?? "").trim().replace(/[\r\n]/g, "");
  const token = input.clearToken
    ? ""
    : tokenInput || existingToken;
  const updates: Record<string, string> = {
    NTFY_URL: url,
    NTFY_TOPIC: topic,
    NTFY_TOKEN: token,
  };

  const envPath = path.join(workspace, ENV_FILE);
  let lines: string[] = [];
  try {
    lines = (await readFile(envPath, "utf8")).split(/\r?\n/);
  } catch {
    lines = [
      "# Optional — leave blank to disable push notifications",
      "NTFY_URL=",
      "NTFY_TOPIC=",
      "NTFY_TOKEN=",
    ];
  }

  const seen = new Set<string>();
  const next: string[] = [];
  for (const line of lines) {
    const parsed = parseEnvLine(line);
    if (parsed && parsed.key in updates) {
      next.push(`${parsed.key}=${quoteEnvValue(updates[parsed.key]!)}`);
      seen.add(parsed.key);
      continue;
    }
    next.push(line);
  }
  for (const key of NTFY_KEYS) {
    if (seen.has(key)) continue;
    next.push(`${key}=${quoteEnvValue(updates[key]!)}`);
  }

  while (next.length > 0 && next[next.length - 1] === "") next.pop();
  await writeFile(envPath, `${next.join("\n")}\n`, "utf8");

  process.env.NTFY_URL = url;
  process.env.NTFY_TOPIC = topic;
  process.env.NTFY_TOKEN = token;

  return {
    url,
    topic,
    tokenConfigured: Boolean(token),
    configured: Boolean(url.replace(/\/$/, "") && topic),
  };
}

export async function notify(
  message: string,
  options: NotifyOptions = {},
): Promise<boolean> {
  const baseUrl = (process.env.NTFY_URL ?? "").replace(/\/$/, "");
  const topic = process.env.NTFY_TOPIC ?? "";
  if (!baseUrl || !topic) return false;

  const token = process.env.NTFY_TOKEN ?? "";
  const headers: Record<string, string> = {
    "Content-Type": "text/plain; charset=utf-8",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.title) headers.Title = options.title;
  if (options.priority) headers.Priority = String(options.priority);
  if (options.tags?.length) headers.Tags = options.tags.join(",");
  if (options.click) headers.Click = options.click;

  try {
    const res = await fetch(`${baseUrl}/${topic}`, {
      method: "POST",
      headers,
      body: message,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`ntfy failed - ${res.status} ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`ntfy error - ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

export async function readBriefFile(filePath: string): Promise<{
  title: string;
  body: string;
}> {
  const raw = (await readFile(filePath, "utf8")).trim();
  if (!raw) throw new Error(`Brief file is empty: ${filePath}`);

  const lines = raw.split(/\r?\n/);
  const heading = lines[0]?.match(/^#\s+(.+)$/);
  if (heading) {
    return {
      title: heading[1]?.trim() || "auto-rob - update",
      body: lines.slice(1).join("\n").trim(),
    };
  }
  return { title: "auto-rob - update", body: raw };
}

export async function sendBriefFile(
  filePath = path.join(packageRoot, BRIEF_FILE),
  options: NotifyOptions = {},
): Promise<boolean> {
  const brief = await readBriefFile(filePath);
  if (!brief.body) return false;
  return notify(brief.body, {
    title: options.title ?? brief.title,
    priority: options.priority ?? 5,
    tags: options.tags ?? ["robot"],
    click: options.click,
  });
}
