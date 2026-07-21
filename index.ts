import { Agent, CursorAgentError, type CloudAgentOptions, type SDKMessage } from "@cursor/sdk";
import os from "node:os";

const ROBINHOOD_MCP_URL = "https://agent.robinhood.com/mcp/trading";
const ROBINHOOD_CLIENT_ID =
  process.env.ROBINHOOD_MCP_CLIENT_ID ?? "LtLiNmbs9owbYfWgBlC68Z2V-cursor";

const prompt = `
Use the robinhood-trading MCP tools only (read-only).
1. Call get_accounts.
2. For each account, call get_portfolio and get_equity_positions.
3. Summarize account type, cash, buying power, portfolio equity/market value, and open equity positions (symbol, quantity, average cost if available).
Do NOT place, review, or cancel any orders.
If Robinhood tools are missing or return auth errors, say so clearly and stop.
`;

function log(label: string, detail?: string) {
  if (detail) {
    console.log(`[${label}] ${detail}`);
  } else {
    console.log(`[${label}]`);
  }
}

function buildCloudOptions(): CloudAgentOptions {
  const envType = (process.env.CURSOR_CLOUD_ENV ?? "machine") as "cloud" | "pool" | "machine";
  const envName =
    process.env.CURSOR_WORKER_NAME ??
    process.env.CURSOR_POOL_NAME ??
    (envType === "machine" ? os.hostname() : undefined);

  const cloud: CloudAgentOptions = {
    env: envName ? { type: envType, name: envName } : { type: envType },
    skipReviewerRequest: true,
  };

  const repoUrl = process.env.CLOUD_REPO_URL ?? process.env.GITHUB_REPO_URL;
  if (repoUrl) {
    cloud.repos = [
      {
        url: repoUrl,
        startingRef: process.env.CLOUD_REPO_REF ?? "main",
      },
    ];
  }

  return cloud;
}

function handleEvent(event: SDKMessage) {
  switch (event.type) {
    case "system":
      if (event.subtype === "init") {
        const tools = event.tools ?? [];
        const robinhoodTools = tools.filter(
          (t) =>
            t.includes("get_accounts") ||
            t.includes("get_portfolio") ||
            t.includes("get_equity_positions") ||
            t.toLowerCase().includes("robinhood"),
        );
        log(
          "init",
          `model=${event.model?.id ?? "?"} tools=${tools.length} robinhood=${robinhoodTools.length ? robinhoodTools.join(", ") : "none"}`,
        );
        if (!robinhoodTools.length) {
          log(
            "warn",
            "No Robinhood tools visible yet — authorize https://agent.robinhood.com/mcp/trading on cursor.com/agents for this personal API key",
          );
        }
      }
      break;
    case "status":
      log("status", event.message ? `${event.status}: ${event.message}` : event.status);
      break;
    case "assistant":
      for (const block of event.message.content) {
        if (block.type === "text" && block.text.trim()) {
          process.stdout.write(block.text);
        }
      }
      break;
    case "tool_call":
      if (event.status === "running") {
        log("tool", `${event.name} …`);
      } else if (event.status === "completed") {
        log("tool", `${event.name} ✓`);
      } else {
        log("tool", `${event.name} ✗`);
      }
      break;
    case "task":
      if (event.text) log("task", event.text);
      else if (event.status) log("task", event.status);
      break;
    case "usage": {
      const u = event.usage;
      log(
        "usage",
        `in=${u.inputTokens ?? 0} out=${u.outputTokens ?? 0} total=${u.totalTokens ?? 0}`,
      );
      break;
    }
    default:
      break;
  }
}

async function main() {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    console.error("[startup] CURSOR_API_KEY is required (personal API key so Robinhood OAuth can be reused)");
    process.exit(1);
  }

  const cloud = buildCloudOptions();
  const envLabel = cloud.env
    ? `${cloud.env.type}${cloud.env.name ? `:${cloud.env.name}` : ""}`
    : "default";

  try {
    await using agent = await Agent.create({
      apiKey,
      model: { id: "composer-2.5" },
      name: "auto-rob portfolio",
      cloud,
      mcpServers: {
        "robinhood-trading": {
          type: "http",
          url: ROBINHOOD_MCP_URL,
          auth: {
            CLIENT_ID: ROBINHOOD_CLIENT_ID,
            scopes: ["internal"],
          },
        },
      },
    });

    const run = await agent.send(prompt);
    log("run", `agent=${agent.agentId} run=${run.id} env=${envLabel}`);

    for await (const event of run.stream()) {
      handleEvent(event);
    }

    const result = await run.wait();
    if (result.result?.trim()) {
      console.log();
      log("result", result.result.trim());
    }
    log(
      "done",
      `status=${result.status}${result.durationMs != null ? ` duration=${result.durationMs}ms` : ""}`,
    );

    if (result.status === "error") {
      if (result.error?.message) log("error", result.error.message);
      process.exit(2);
    }
  } catch (err) {
    if (err instanceof CursorAgentError) {
      console.error(`[startup] ${err.message} (retryable=${err.isRetryable})`);
      process.exit(1);
    }
    throw err;
  }
}

main();
