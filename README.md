# Codex Usage Monitor for Windows, Omarchy and KDE Plasma

A Windows system-tray app, native Omarchy bar plugin and Plasma 6 panel widget
that show Codex usage: the rolling short window, weekly window and seven-day
local activity.

## Windows 10/11

The Windows edition lives in the notification area. Left-click the Codex icon
to open a scrollable panel with a session ring and live reset countdown, weekly
limits, model breakdown, two-hour activity, today's token/cache totals and the
public OpenAI service status. Right-click it to refresh, enable startup with
Windows or exit.

It reads `%USERPROFILE%\.codex\sessions\**\*.jsonl` locally and writes only a
normalized cache to `%APPDATA%\codex-usage-widget\usage-widget.json`. It does
not read `auth.json`, browser cookies or private ChatGPT endpoints. The service
card makes an unauthenticated request to the public
`https://status.openai.com/api/v2/summary.json` endpoint every five minutes.

### Run from source

Requires Node.js 22 or newer:

```powershell
npm install
npm start
```

### Build the installer

```powershell
npm run build:win
```

The NSIS installer is created at
`dist\Codex-Usage-Widget-Setup-2.1.0.exe`. The installed application is
self-contained and does not require Node.js. Use the checkbox in the panel or
the tray menu to start it automatically with Windows.

## Omarchy

The Omarchy version is a native Quickshell plugin. It displays the current
session percentage directly in the bar and opens a theme-aware details panel
with session and weekly limits, reset countdowns and recent activity.

```bash
chmod +x install-omarchy.sh
./install-omarchy.sh
```

The installer copies the plugin to
`~/.config/omarchy/plugins/asm444.codex-usage`, enables the user collector
timer and adds the widget to the right section of the bar. Left-click opens
the details panel; middle-click forces a refresh.

## How it works

Three moving parts, deliberately decoupled:

```
~/.codex/sessions/**.jsonl ──┐
                             ├─► codex-usage-collector.py ─► ~/.local/share/codex-usage-widget/usage-widget.json ─► main.qml
chatgpt.com backend-api ─────┘        (systemd user timer, 60s)              (0600, normalized values only)        (Plasma applet)
```

1. **Collector** (`scripts/codex-usage-collector.py`) merges two sources and
   writes one normalized JSON file. It writes to a temp file, `chmod 600`, then
   `os.replace` — an atomic swap, so the widget never reads a half-written file.
2. **Timer** (`systemd/*.timer`) runs the collector every 60s, `OnBootSec=30s`.
3. **Widget** (`plasmoid/contents/ui/main.qml`) uses Plasma's `executable`
   data engine with a declarative `interval` of 30s, re-running the collector and
   `cat`-ing the JSON — independent of the systemd timer, so the widget still
   refreshes if the timer is disabled. Opening the popup forces a refresh by cycling the source.

The remote view wins when available; the local session log is the fallback.
`rateLimits.source` reports which one produced the numbers (`api` or `local_log`).

### Source A — local Codex session log

Reads `~/.codex/sessions/**/*.jsonl`, skipping files older than 7 days by mtime.
It never reads `~/.codex/auth.json`.

Records consumed:

| Record | Field | Used for |
| --- | --- | --- |
| `type: session_meta` | `payload.session_id` | distinct session count |
| `type: event_msg` → `token_count` | `info.last_token_usage.total_tokens` | per-day and 7-day token totals |
| `type: event_msg` → `token_count` | `info.total_token_usage.total_tokens` | current thread tokens |
| `type: event_msg` → `token_count` | `rate_limits.primary` / `.secondary` | fallback 5h / weekly windows |

Each rate-limit snapshot carries `used_percent`, `window_minutes` and
`resets_at`. `used_percent` arrives as a fraction today, so values `<= 1` are
multiplied by 100 and clamped to `[0, 100]`.

Older Codex builds nested the payload under `payload.item`; both shapes are
handled.

### Source B — ChatGPT web endpoints

If a Chromium-family profile is signed in to ChatGPT, the collector reuses that
browser session. Endpoints, all `GET`:

| Key | URL | Fields consumed |
| --- | --- | --- |
| session | `chatgpt.com/api/auth/session` | `accessToken` → sent as `Authorization: Bearer` |
| `usage` | `chatgpt.com/backend-api/wham/usage` | `rate_limit`, `plan_type`, `credits.balance`, `rate_limit_reached_type`, `spend_control.reached`, `rate_limit_reset_credits.available_count` |
| `resetCredits` | `chatgpt.com/backend-api/wham/rate-limit-reset-credits` | `available_count` |
| `limitsConfig` | `chatgpt.com/backend-api/pageConfigs/usage_limits` | `show_buy_credits`, `show_manage_auto_reload` |

The `usage` response also carries `email`, `user_id` and `account_id`. **None of
them are written to the cache file** — only the fields listed above are read.

`rate_limit` has no documented shape, so `find_rate_limit_blocks` walks the tree
and picks up any object carrying `used_percent` plus a window duration
(`window_minutes`, `limit_window_seconds` or the camelCase spelling). The
resulting blocks are sorted **by duration**, not by position: shortest becomes
the session window, longest becomes the weekly window. That survives the API
adding, reordering or renaming windows.

### Cookie handling

Chromium stores cookies AES-128-CBC encrypted; the key comes from the desktop
keyring (`secret-tool`, or `kwallet-query` on KDE) via PBKDF2-HMAC-SHA1
(`salt=saltysalt`, 1 iteration, 16 bytes). Chrome's documented `peanuts`
fallback is tried when no keyring entry works. Chrome 130+ prefixes a 32-byte
integrity hash on the plaintext, so both offsets are attempted.

The cookie DB is copied to a temp file (plus `-wal`/`-shm`) because the live one
is locked by the running browser. The copy is deleted in a `finally` block.
Cookies and the access token live only in process memory for the duration of the
requests — they are never written to disk.

## Output contract

`~/.local/share/codex-usage-widget/usage-widget.json`, mode `0600`:

| Path | Meaning |
| --- | --- |
| `generatedAt` | UTC ISO-8601 of the run |
| `source` | `ChatGPT browser session` or `local Codex session log` |
| `available` | false when neither source produced a snapshot |
| `rateLimits.session` | `percentUsed`, `resetsAt`, `resetsInMinutes`, `resetsLabel` |
| `rateLimits.weeklyAll` | same shape, 7-day window |
| `rateLimits.plan` | e.g. `plus`, `pro` |
| `rateLimits.credits` | `amount`, `currency`, `autoReload` |
| `rateLimits.source` | `api` or `local_log` |
| `browserApi.endpoints` | per-endpoint `ok` / `HTTP 4xx` / error class name |
| `browserApi.responseKeys` | top-level key names per response — makes an API shape change diagnosable without leaking values |
| `account.*` | `allowed`, `limitReached`, `limitReachedType`, `spendControlReached`, `resetCreditsAvailable`, `canBuyCredits`, `canManageAutoReload` |
| `activity.*` | `last7DaysTokens`, `last7DaysTurns`, `last7DaysSessions`, `daily[]` (`label`, `tokens`, `turns`), `currentThreadTokens` |

Errors are reported as an HTTP status or an exception class name, never a
response body — a failing request cannot leak account data into the cache.

### Known gap

`main.qml` is a rich UI carried over from a Claude-oriented widget and still
reads panels the Codex collector does not populate: `weeklyOpus`,
`weeklySonnet`, `weeklyFable`, `weeklyDesign`, `weeklyCowork`,
`weeklyOauthApps`, `toolUse`, `streak`, `costProjection`, `opusFallbacks`,
`latency`, `errorRate`. Every read is optional-chained, so those panels stay
hidden. `serviceStatus`, `dumbness`, `limitEta`, `performance` and `lifetime`
are emitted as inert placeholders to keep the UI's expectations satisfied.

## KDE Plasma install

```bash
chmod +x install.sh
./install.sh
```

Then **Add Widgets** in Plasma → **Codex Usage Monitor**.

Requires KDE Plasma 6 (`kpackagetool6`) and Python 3. The `cryptography`
package is needed only for the browser path; without it the widget falls back to
the local session log.

Rate-limit bars appear once Codex has written a `token_count` event, i.e. after
one completed interaction.

## License

MIT — see `LICENSE`.
