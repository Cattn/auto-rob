# auto-rob

Desktop app that runs a Robinhood portfolio agent on a schedule. It reviews your account, researches when needed, trades when conviction is high, and can send a short phone brief when a run finishes.

You pick one AI harness at a time — [Cursor](https://cursor.com/docs/cli/installation) (Agent CLI) or [ChatGPT / Codex](https://chatgpt.com/codex) — and connect Robinhood from the app. No terminal setup is required for normal use.

## Features

- Electron UI for onboarding, strategy, runs, and settings
- Cursor or Codex as the agent backend (one active harness)
- Robinhood Trading MCP for portfolio data and orders
- Optional [ntfy](https://docs.ntfy.sh/install/) push notifications after each run
- Workspace files (prompt, notes, logs, config) stored in OS user data

## Prerequisites

- A Robinhood account with [Agentic Trading](https://robinhood.com/us/en/support/articles/agentic-trading-overview/) enabled
- At least one harness installed and signed in:
  - [Cursor CLI](https://cursor.com/docs/cli/installation) (`agent` / `cursor-agent`), and/or
  - the [ChatGPT / Codex](https://chatgpt.com/codex) app
- Optional: a self-hosted [ntfy](https://docs.ntfy.sh/install/) instance for phone briefs

## Setup

1. Install and open auto-rob.
2. Complete onboarding (trade style, intent, and limits).
3. In **Settings**, connect Cursor and/or Codex — this walks through Robinhood OAuth for that harness.
4. Choose the **Active harness** used for runs.
5. Optionally configure **Phone notifications** (ntfy URL, topic, and token).

State lives under the OS user-data folder (`%APPDATA%\auto-rob\workspace` on Windows, `~/Library/Application Support/auto-rob/workspace` on macOS, `~/.config/auto-rob/workspace` on Linux).

## Schedule

For unattended market-hour runs, point Task Scheduler or cron at the installed app with `--run-once` (about every 2 hours, Mon–Fri). Example cron:

```cron
TZ=America/New_York
30 9-15/2 * * 1-5 "/path/to/auto-rob" --run-once
0 17 * * 1-5 "/path/to/auto-rob" --run-once
```

On Windows, create a Task Scheduler action that launches the app with argument `--run-once` on the same cadence.

## Notes

This places real orders on your funded Agentic account. Review your strategy prompt in the app before enabling a schedule, and keep Robinhood connected for the active harness so unattended runs can use trading tools.
