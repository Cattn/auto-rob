# auto-rob

Desktop app that runs a Robinhood portfolio agent on a schedule. It reviews your account, researches when needed, trades when conviction is high, and can send a short phone brief when a run finishes.

You pick one AI harness at a time - [Cursor](https://cursor.com/docs/cli/installation) (Agent CLI) or [ChatGPT / Codex](https://chatgpt.com/codex) - and connect Robinhood from the app.

## Features

- Cursor or Codex as the agent backend (one active harness)
- Robinhood Trading MCP for portfolio data and orders
- Optional [ntfy](https://docs.ntfy.sh/install/) push notifications after each run
- Workspace files (prompt, notes, logs, config) stored in OS user data
- Opt-in unattended schedule (Task Scheduler / launchd / crontab)



## Install

Download the latest build from [Releases](https://github.com/Cattn/auto-rob/releases). Current artifacts are named `electron-svelte-*`:

- Windows (x64): `electron-svelte-Setup.exe`
- macOS (Apple Silicon): `.dmg` or `.zip`
- Linux (x64): `.AppImage`, `.deb`, or `.rpm`

Builds are unsigned. On Windows, SmartScreen may warn; choose More info, then Run anyway. On macOS, allow the app in System Settings > Privacy & Security, or right-click the app and choose Open. For the Linux AppImage, mark it executable (`chmod +x`) before running.



## Prerequisites

- A Robinhood account with [Agentic Trading](https://robinhood.com/us/en/support/articles/agentic-trading-overview/) enabled
- At least one harness installed and signed in:
  - [Cursor CLI](https://cursor.com/docs/cli/installation) (`agent` / `cursor-agent`), separate from the Cursor desktop app, and/or
  - the [ChatGPT / Codex](https://chatgpt.com/codex) app
- Optional: a self-hosted [ntfy](https://docs.ntfy.sh/install/) server, plus the ntfy app on your phone subscribed to the same topic



## Setup

1. Install and open auto-rob.
2. On **Setup**, connect Cursor and/or Codex with Robinhood. Finish login in the browser, then return to the app. Continue when at least one harness is ready.
3. Complete **preferences** (trade style, intent, and limits). Optionally enable the unattended schedule.
4. Use **Settings** anytime to switch the active harness, pick a model, or configure ntfy.

If a harness still shows CLI missing after you install it, quit and reopen auto-rob so it can pick up PATH. Reconnect in Settings if Robinhood auth expires.

State lives under the OS user-data folder (`%APPDATA%\auto-rob\workspace` on Windows, `~/Library/Application Support/auto-rob/workspace` on macOS, `~/.config/auto-rob/workspace` on Linux).

## Schedule

Enable the schedule in onboarding or **Settings**. Slots are weekdays during US market hours (9:30-4:00 ET), converted to local time. Presets and missed-slot catch-up are configured in Settings.

The app installs OS jobs that launch the packaged binary with `--run-once` (Windows Task Scheduler, macOS launchd, Linux crontab). The computer must be on and logged in; sleep or shutdown will miss slots. Pause from the bottom bar keeps the jobs; disable in Settings to remove them.

Windows may prompt for administrator permission when installing or removing the task. For a custom cadence, copy the command shown in Settings and point your own Task Scheduler / cron / launchd entry at the app executable.



## Notes

This places real orders on your funded Agentic account. Review your strategy prompt in the app before enabling a schedule, and keep Robinhood connected for the active harness so unattended runs can use trading tools. Stay signed in to Cursor or Codex on this machine as well.



## Develop

The desktop app lives in `ui/` (Electron + SvelteKit). Use [Node.js](https://nodejs.org/) 22 and [pnpm](https://pnpm.io/).

```bash
cd ui
pnpm install
pnpm start
```

That opens the Electron UI with hot reload. Workspace files still go to the OS user-data folder above, not the git checkout.

Other commands from `ui/`:

- `pnpm run package` - production build in `ui/out`
- `pnpm run make` - platform installers

From the repo root, `npm run ui` is the same as `pnpm --dir ui start` (pnpm must already be installed).
