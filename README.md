# auto-rob

Desktop app that runs a Robinhood portfolio agent on a schedule. It reviews your account, researches when needed, trades when conviction is high, and can send a short phone brief when a run finishes.

You pick one AI harness at a time - [Cursor](https://cursor.com/docs/cli/installation) (Agent CLI) or [ChatGPT / Codex](https://chatgpt.com/codex) - and connect Robinhood from the app.

## Features

- Cursor or Codex as the agent backend (one active harness)
- Robinhood Trading MCP for portfolio data and orders
- Optional [ntfy](https://docs.ntfy.sh/install/) push notifications after each run
- Workspace files (prompt, notes, logs, config) stored in OS user data
- Opt-in unattended schedule (Task Scheduler / launchd / crontab)



## Prerequisites

- A Robinhood account with [Agentic Trading](https://robinhood.com/us/en/support/articles/agentic-trading-overview/) enabled
- At least one harness installed and signed in:
  - [Cursor CLI](https://cursor.com/docs/cli/installation) (`agent` / `cursor-agent`), and/or
  - the [ChatGPT / Codex](https://chatgpt.com/codex) app
- Optional: a self-hosted [ntfy](https://docs.ntfy.sh/install/) instance for phone briefs



## Setup

1. Install and open auto-rob.
2. On **Setup**, connect Cursor and/or Codex (Robinhood OAuth for that harness). Continue when at least one is ready.
3. Complete **preferences** (trade style, intent, and limits). Optionally enable the unattended schedule (tied to your cadence).
4. In **Settings**, choose the **Active harness** used for runs and tweak schedule/notifications anytime.
5. Optionally configure **Phone notifications** (ntfy URL, topic, and token).

State lives under the OS user-data folder (`%APPDATA%\auto-rob\workspace` on Windows, `~/Library/Application Support/auto-rob/workspace` on macOS, `~/.config/auto-rob/workspace` on Linux).

## Schedule

1. Connect at least one harness (Setup / Settings).
2. Enable the schedule in onboarding or **Settings → Unattended schedule**.
3. Pick a preset aligned with trade cadence (market hours 9:30–4:00 ET, converted to local time):
  - Every 30 minutes → More active
  - Every hour → Balanced
  - Every 2 hours → Less frequent

The app installs OS jobs that launch the packaged binary with `--run-once` (Windows Task Scheduler, macOS launchd, Linux crontab). Pause from the bottom bar; disable in Settings to remove OS jobs.

Optional **Run missed slots** catches up at most one latest missed run after wake/login (never chains older slots).

For a custom cadence, copy the command shown in Settings and point your own Task Scheduler / cron / launchd entry at it:

```text
"/path/to/auto-rob" --run-once
```



## Notes

This places real orders on your funded Agentic account. Review your strategy prompt in the app before enabling a schedule, and keep Robinhood connected for the active harness so unattended runs can use trading tools.
