import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

export const ENV_FILE = ".env";
export const BRIEF_FILE = ".notify-brief.md";
export const SENT_MARKER = ".notify-sent";

export type NotifyOptions = {
  title?: string;
  priority?: 1 | 2 | 3 | 4 | 5;
  tags?: string[];
  click?: string;
};

export async function loadEnvFile(workspace = packageRoot): Promise<void> {
  try {
    const raw = await readFile(path.join(workspace, ENV_FILE), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
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
