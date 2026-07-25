import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolveOsUserDataDir } from "./workspace";

export const NOTES_FILE = "notes.md";
export const NOTES_LIBRARY_SUBDIR = "notes";

export type SavedNoteMeta = {
  id: string;
  title: string;
  updatedAt: string;
};

export type NotesState = {
  content: string;
  activeId: string | null;
  notes: SavedNoteMeta[];
};

type NotesIndex = {
  activeId: string | null;
  notes: SavedNoteMeta[];
};

function notesLibraryDir(): string {
  return path.join(resolveOsUserDataDir(), NOTES_LIBRARY_SUBDIR);
}

function indexPath(): string {
  return path.join(notesLibraryDir(), "index.json");
}

function noteFilePath(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid note id: ${id}`);
  }
  return path.join(notesLibraryDir(), `${id}.md`);
}

async function ensureLibrary(): Promise<void> {
  await mkdir(notesLibraryDir(), { recursive: true });
}

async function readIndex(): Promise<NotesIndex> {
  await ensureLibrary();
  try {
    const raw = await readFile(indexPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<NotesIndex>;
    const notes = Array.isArray(parsed.notes)
      ? parsed.notes.filter(
          (n): n is SavedNoteMeta =>
            !!n &&
            typeof n.id === "string" &&
            typeof n.title === "string" &&
            typeof n.updatedAt === "string",
        )
      : [];
    const activeId =
      typeof parsed.activeId === "string" || parsed.activeId === null
        ? parsed.activeId
        : null;
    return {
      activeId: activeId && notes.some((n) => n.id === activeId) ? activeId : null,
      notes: notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    };
  } catch {
    return { activeId: null, notes: [] };
  }
}

async function writeIndex(index: NotesIndex): Promise<void> {
  await ensureLibrary();
  await writeFile(
    indexPath(),
    `${JSON.stringify(index, null, 2)}\n`,
    "utf8",
  );
}

async function readActiveContent(workspace: string): Promise<string> {
  try {
    return await readFile(path.join(workspace, NOTES_FILE), "utf8");
  } catch {
    return "";
  }
}

async function writeActiveContent(
  workspace: string,
  content: string,
): Promise<void> {
  await writeFile(path.join(workspace, NOTES_FILE), content, "utf8");
}

function titleFromContent(content: string, fallback = "Untitled note"): string {
  const line = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return fallback;
  const cleaned = line.replace(/^#+\s*/, "").trim();
  if (!cleaned) return fallback;
  return cleaned.length > 48 ? `${cleaned.slice(0, 48)}…` : cleaned;
}

async function buildState(workspace: string): Promise<NotesState> {
  const [content, index] = await Promise.all([
    readActiveContent(workspace),
    readIndex(),
  ]);
  return {
    content,
    activeId: index.activeId,
    notes: index.notes,
  };
}

export async function getNotesState(workspace: string): Promise<NotesState> {
  return buildState(workspace);
}

export async function saveActiveNote(
  workspace: string,
  content: string,
): Promise<NotesState> {
  await writeActiveContent(workspace, content);
  const index = await readIndex();
  if (index.activeId) {
    let libraryContent = "";
    try {
      libraryContent = await readFile(noteFilePath(index.activeId), "utf8");
    } catch {
      libraryContent = "";
    }
    if (content !== libraryContent) {
      index.activeId = null;
      await writeIndex(index);
    }
  }
  return buildState(workspace);
}

export async function createSavedNote(
  workspace: string,
  opts?: { title?: string; content?: string },
): Promise<NotesState> {
  const content =
    opts?.content !== undefined
      ? opts.content
      : await readActiveContent(workspace);
  const id = randomUUID().replace(/-/g, "");
  const title =
    opts?.title?.trim() || titleFromContent(content, "Untitled note");
  const updatedAt = new Date().toISOString();
  await ensureLibrary();
  await writeFile(noteFilePath(id), content, "utf8");
  const index = await readIndex();
  index.notes = [{ id, title, updatedAt }, ...index.notes];
  await writeIndex(index);
  return buildState(workspace);
}

export async function updateSavedNote(
  workspace: string,
  id: string,
  opts: { title?: string; content?: string },
): Promise<NotesState> {
  const index = await readIndex();
  const existing = index.notes.find((n) => n.id === id);
  if (!existing) throw new Error(`Note not found: ${id}`);

  if (opts.content !== undefined) {
    await writeFile(noteFilePath(id), opts.content, "utf8");
    if (index.activeId === id) {
      await writeActiveContent(workspace, opts.content);
    }
  }

  const nextTitle =
    opts.title?.trim() ||
    (opts.content !== undefined
      ? titleFromContent(opts.content, existing.title)
      : existing.title);

  index.notes = index.notes.map((n) =>
    n.id === id
      ? { ...n, title: nextTitle, updatedAt: new Date().toISOString() }
      : n,
  );
  await writeIndex(index);
  return buildState(workspace);
}

export async function deleteSavedNote(
  workspace: string,
  id: string,
): Promise<NotesState> {
  const index = await readIndex();
  if (!index.notes.some((n) => n.id === id)) {
    throw new Error(`Note not found: ${id}`);
  }
  index.notes = index.notes.filter((n) => n.id !== id);
  if (index.activeId === id) index.activeId = null;
  await writeIndex(index);
  try {
    await unlink(noteFilePath(id));
  } catch {
    // ignore missing file
  }
  return buildState(workspace);
}

export async function setActiveNote(
  workspace: string,
  id: string,
): Promise<NotesState> {
  const index = await readIndex();
  if (!index.notes.some((n) => n.id === id)) {
    throw new Error(`Note not found: ${id}`);
  }
  const content = await readFile(noteFilePath(id), "utf8");
  await writeActiveContent(workspace, content);
  index.activeId = id;
  await writeIndex(index);
  return buildState(workspace);
}
