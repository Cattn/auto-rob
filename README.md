# auto-rob

Unattended Robinhood portfolio agent. Runs on a schedule during market hours, researches the account via the Robinhood Trading MCP, places trades when conviction is high, and sends a short phone brief when each run finishes.

Supports two harnesses — **Cursor** or **ChatGPT (Codex)** — with one active at a time (`auto-rob.config.json`). Connect either (or both) from the Electron Settings UI without using the terminal.

## Prerequisites

- Node.js 20+
- At least one harness CLI:
  - [Cursor CLI](https://cursor.com/docs/cli/installation) (`agent` / `cursor-agent`), or
  - [ChatGPT / Codex](https://chatgpt.com/codex) app (resolves `codex` from PATH or AppData)
- A Robinhood account with [Agentic Trading](https://robinhood.com/us/en/support/articles/agentic-trading-overview/) enabled
- Robinhood Trading MCP connected for the active harness: `https://agent.robinhood.com/mcp/trading`
- Optional: a self-hosted [ntfy](https://docs.ntfy.sh/install/) instance for push notifications

## Setup

```bash
git clone https://github.com/<you>/auto-rob.git
cd auto-rob
npm install
cp .env.example .env
```

Edit `.env` if you want push notifications (`NTFY_*` is optional — leave blank to skip):

```
NTFY_URL=https://ntfy.example.com
NTFY_TOPIC=auto-rob
NTFY_TOKEN=your-token
```

Self-host guide: [docs.ntfy.sh/install](https://docs.ntfy.sh/install/). Create a topic, add a token if you use auth, then subscribe in the ntfy app.

### Connect harnesses (recommended: UI)

```bash
npm run ui
```

In **Settings**:

1. **Connect** Cursor and/or ChatGPT (Codex) — opens the Robinhood OAuth browser flow automatically.
2. Pick the **Active harness** used for runs.

If you skipped connect during onboarding, the same Connect buttons are available on Home and in Settings.

### Connect from CLI (optional)

```bash
npm run cursor:connect   # approve + login Robinhood via global Cursor MCP
npm run codex:connect    # codex mcp add + mcp login
npm run harness:list     # status for both harnesses
```

Optional files you can edit:

| File | Purpose |
| --- | --- |
| `prompt.md` | Standing rules for the agent |
| `notes.md` | Extra guidance injected each run |
| `long-term.md` | Durable goals/watches (agent-maintained) |
| `run-log.md` | Per-run continuity log (agent-maintained) |
| `auto-rob.config.json` | Active harness (`cursor` \| `codex`) |
| `.cursor/cli.json` | Cursor CLI allowlist |
| `.cursor/permissions.json` | IDE allowlist for the same tools |

Cursor Robinhood MCP is expected in the **global** `~/.cursor/mcp.json` (not a project `.cursor/mcp.json`).
## Run

```bash
npm start
```

Uses the harness selected in `auto-rob.config.json` (override with `AUTO_ROB_HARNESS=codex` if needed).

Check harness CLIs:

```bash
npm run agent:check
npm run codex:check
npm run harness:list
```

Test notifications:

```bash
npm run notify:test
```

Each run streams agent output and writes `run-log.md`. If ntfy is configured, it also sends a phone brief (from `.notify-brief.md`, or a fallback if the agent skipped it).

## Schedule

Aim for roughly every 2 hours during US market hours (Mon–Fri). Avoid firing exactly at the close if you want a last decision while the market is still open.

### Windows (Task Scheduler)

1. Open Task Scheduler → Create Task.
2. General: run whether user is logged on or not; configure for your Windows version.
3. Triggers → New:
   - Weekly, Monday–Friday
   - Start: `9:30 AM`
   - Repeat every: `2 hours`
   - Duration: `6 hours` (fires 9:30, 11:30, 1:30, 3:30)
4. Optional second trigger for a late run (e.g. `5:00 PM`, no repeat) so you get a pre-close pass without hitting 5:30.
5. Actions → Start a program:
   - Program: `npm` (or full path to `npm.cmd`)
   - Arguments: `start`
   - Start in: path to this repo

### Linux (cron)

```cron
# Every 2 hours during market hours (adjust TZ to your market)
TZ=America/New_York
30 9-15/2 * * 1-5 cd /path/to/auto-rob && npm start >> /var/log/auto-rob.log 2>&1
0 17 * * 1-5 cd /path/to/auto-rob && npm start >> /var/log/auto-rob.log 2>&1
```

The first line covers 9:30, 11:30, 1:30, 3:30. The second is an optional ~5:00 PM pre-close run. Edit crontab with `crontab -e`.

## Notes

This places real orders on your funded Agentic account. Review `prompt.md` before enabling a schedule, and keep MCP auth valid for the active harness so unattended runs can use the Robinhood tools. Cursor and Codex each need their own Robinhood OAuth connect.
