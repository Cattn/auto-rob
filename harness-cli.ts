import { writeFile } from "node:fs/promises";
import {
  getActiveHarnessId,
  getHarness,
  getHarnessModels,
  isHarnessId,
  listHarnessStatuses,
  setActiveHarness,
  setHarnessModel,
  type HarnessId,
} from "./harness/index.js";
import { resolveCliWorkspace } from "./workspace.js";

const args = process.argv.slice(2);
const command = args[0] ?? "list";

function flagValue(name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return undefined;
}

const workspace = flagValue("--root") ?? resolveCliWorkspace(import.meta.url);

const JSON_MARKER = "__AUTO_ROB_JSON__";

function emitJson(payload: unknown) {
  process.stdout.write(`${JSON_MARKER}\n${JSON.stringify(payload)}\n`);
}

async function main() {
  if (command === "list") {
    const statuses = await listHarnessStatuses(workspace);
    emitJson({ statuses });
    return;
  }

  if (command === "active") {
    const activeHarness = await getActiveHarnessId(workspace);
    emitJson({ activeHarness });
    return;
  }

  if (command === "set-active") {
    const id = args[1];
    if (!id || !isHarnessId(id)) {
      throw new Error("Usage: harness-cli.ts set-active <cursor|codex>");
    }
    await setActiveHarness(workspace, id);
    emitJson({ activeHarness: id });
    return;
  }

  if (command === "models") {
    const models = await getHarnessModels(workspace);
    emitJson({ models });
    return;
  }

  if (command === "set-model") {
    const id = args[1];
    if (!id || !isHarnessId(id)) {
      throw new Error(
        'Usage: harness-cli.ts set-model <cursor|codex> "<model>"',
      );
    }
    const model = args[2] ?? "";
    const models = await setHarnessModel(workspace, id, model);
    emitJson({ models });
    return;
  }

  if (command === "status") {
    const id = args[1];
    if (!id || !isHarnessId(id)) {
      throw new Error("Usage: harness-cli.ts status <cursor|codex>");
    }
    const status = await getHarness(id as HarnessId, workspace).status();
    emitJson(status);
    return;
  }

  if (command === "connect") {
    const id = args[1];
    if (!id || !isHarnessId(id)) {
      throw new Error("Usage: harness-cli.ts connect <cursor|codex>");
    }
    const status = await getHarness(id as HarnessId, workspace).connect({
      login: true,
    });
    const outPath = flagValue("--out");
    const payload = JSON.stringify(status, null, 2);
    if (outPath) await writeFile(outPath, `${payload}\n`, "utf8");
    emitJson(status);
    return;
  }

  throw new Error(
    `Unknown command: ${command}. Use list|active|set-active|models|set-model|status|connect`,
  );
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
