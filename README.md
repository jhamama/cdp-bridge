# Chrome DevTools Bridge

A VSCode extension that bridges AI coding agents, scripts, and terminal tools to your browser via the Chrome DevTools Protocol (CDP). It exposes a simple HTTP API so anything that can call `curl` can control Chrome.

Control your browser with `curl`. No WebSocket client needed. No MCP server required. Just HTTP.

---

## The Problem It Solves

Chrome runs with `--remote-debugging-port=9222`. You want to automate it — run JavaScript, inspect the DOM, capture screenshots, monitor network traffic — from your terminal, scripts, or AI coding agents.

The problem: CDP is a WebSocket protocol. You can't call it directly from a shell. Raw CDP is stateful and complex. There's no clean HTTP interface in the middle.

**Chrome DevTools Bridge is that interface.**

It connects to Chrome's CDP endpoint, wraps it in a simple REST API, and serves it on `localhost:9333`. Any tool that can make an HTTP request can now control Chrome.

---

## Why a VSCode Extension?

| Approach | Problem |
|---|---|
| Standalone Node script | Manually started, dies with the terminal session |
| pm2 / shell daemon | Lives outside VSCode, needs separate setup per machine |
| Docker container | Overkill, extra networking complexity |
| **VSCode Extension** | Starts automatically with VSCode, tied to your work session lifecycle |

VSCode is already the process that stays alive while you work. The bridge starts when you open VSCode and stops when you close it — no manual process management required.

---

## Why Not MCP?

MCP (Model Context Protocol) is great when a single AI agent is your only consumer. But this bridge is designed to serve **everything at once**:

- An AI coding agent running autonomously on a task
- You running `curl` from a terminal to debug something
- Shell scripts and CI-adjacent automation
- Future tooling you haven't built yet

An HTTP server on `localhost:9333` is universal. MCP can be layered on top of this bridge later if you want native tool integration with a specific agent — but you don't need it to get full browser control today.

Additionally, MCP requires the AI agent to be the lifecycle owner of the server process. This bridge lives in VSCode, which is a more stable anchor point for long-running work.

---

## Getting Started

Start Chrome (or any Chromium-based browser) with remote debugging enabled:

```bash
# Chrome
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222

# Arc
/Applications/Arc.app/Contents/MacOS/Arc \
  --remote-debugging-port=9222

# Brave
/Applications/Brave\ Browser.app/Contents/MacOS/Brave\ Browser \
  --remote-debugging-port=9222
```

The extension activates automatically when VSCode opens. With `autoStart: true` (the default), the bridge connects to Chrome and starts serving on `localhost:9333` immediately.

> **Recommended:** For automated testing and AI-driven workflows, use a dedicated Chrome installation rather than your daily browser. This avoids interference with your browsing session and lets you run Chrome with a clean profile. You can install Chrome for Testing — a version of Chrome specifically designed for automation — from [googlechromelabs.github.io/chrome-for-testing](https://googlechromelabs.github.io/chrome-for-testing/). It ships without auto-updates and is available for all platforms.

---

## Security

The bridge server binds to `127.0.0.1` (localhost only) and is **not accessible from the network**. However, be aware of the following:

- **`/eval` executes arbitrary JavaScript** in the connected browser tab. Any process on your machine that can reach `localhost:9333` can run code in the context of whatever page is open — including pages where you're logged in.
- **Do not expose the bridge port** to the network, even on a trusted LAN. There is no authentication.
- **Do not use your primary browsing session** for automated work if you have sensitive tabs open (banking, email, etc.). Use a separate Chrome profile or Chrome for Testing instead.
- **`/dom` returns the full page HTML**, which may include sensitive content, tokens in the DOM, or session data.
- **Screenshots** may capture sensitive information visible on screen.

If you need to expose the bridge beyond localhost (e.g. in a container or VM setup), add an authentication layer in front of it. A future version may include optional API key support.

---

## Usage

### curl

```bash
# Check bridge status
curl localhost:9333/status

# Navigate to a URL
curl -X POST localhost:9333/navigate \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'

# Run JavaScript in the page
curl -X POST localhost:9333/eval \
  -H "Content-Type: application/json" \
  -d '{"expression": "document.title"}'

# Take a screenshot
curl localhost:9333/screenshot | jq -r .data | base64 -d > screen.png

# Click a button
curl -X POST localhost:9333/click \
  -H "Content-Type: application/json" \
  -d '{"selector": "#submit-btn"}'

# Get last 20 network requests, filtered to API calls
curl "localhost:9333/network?limit=20&filter=/api/"

# Get current page HTML
curl localhost:9333/dom | jq -r .data.html
```

### AI Coding Agents

Most AI coding agents (Claude Code, Cursor, Codex, etc.) can use bash/shell tools, which means they can call `curl`. They just need to know the bridge exists and what it can do.

**Copy the block below into your agent's project config** — the file depends on your tool:

| Agent | Config file |
|---|---|
| Claude Code | `CLAUDE.md` |
| Cursor | `.cursorrules` |
| OpenAI Codex | `codex.md` |
| Windsurf | `.windsurfrules` |
| Others | System prompt or project instructions |

```markdown
## Browser Control

A Chrome DevTools Bridge is running at localhost:9333. You can control the
browser using curl. Use this whenever you need to verify frontend behavior,
debug UI issues, check network requests, or inspect page state.

Endpoints:
- POST /navigate      — go to a URL { url }
- POST /eval          — run JavaScript { expression }, returns { result, type }
- POST /click         — click element by CSS selector { selector }
- POST /type          — type into a focused element { selector, text }
- POST /scroll        — scroll page or element { deltaX, deltaY, selector? }
- GET  /screenshot    — capture page as base64 PNG
- GET  /network       — recent network requests (?limit=N&filter=substring)
- GET  /console       — recent console.log/error output (?limit=N)
- GET  /dom           — full page outer HTML
- GET  /tabs          — list all open browser tabs
- GET  /status        — bridge health and active tab info
- POST /network/clear — clear the network log

All responses use the format: { ok: true, data: ... } or { ok: false, error: "..." }

Tips:
- Take a screenshot after navigating to confirm the page loaded correctly
- Use /eval to query DOM state instead of parsing /dom HTML when possible
- Use /network with ?filter= to find specific API calls
- JS exceptions from /eval are returned as data, not HTTP errors
```

Once this is in your config, the agent will automatically reach for `curl localhost:9333/...` during frontend work — no further prompting needed.

---

## API Reference

### Browser Control

| Method | Endpoint | Body | Description |
|---|---|---|---|
| `GET` | `/status` | — | Bridge health, CDP state, active tab |
| `GET` | `/tabs` | — | All open Chrome tabs |
| `POST` | `/tabs/:id/activate` | — | Switch to a specific tab |
| `POST` | `/navigate` | `{ url }` | Navigate current tab |
| `POST` | `/eval` | `{ expression }` | Run JavaScript, returns result |
| `POST` | `/click` | `{ selector }` | Click element by CSS selector |
| `POST` | `/type` | `{ selector, text }` | Type text into an element |
| `POST` | `/scroll` | `{ deltaX, deltaY, selector? }` | Scroll page or element |
| `GET` | `/screenshot` | — | Page screenshot as base64 PNG |

### Inspection

| Method | Endpoint | Query Params | Description |
|---|---|---|---|
| `GET` | `/network` | `limit`, `filter`, `method` | Recent network requests |
| `POST` | `/network/clear` | — | Clear the network log |
| `GET` | `/console` | `limit` | Recent console output |
| `GET` | `/dom` | — | Current page outer HTML |

### Response Format

All endpoints return a consistent envelope:

```json
{ "ok": true, "data": ... }
{ "ok": false, "error": "message" }
```

JavaScript errors from `/eval` are returned as structured data, not 500s:

```json
{ "ok": true, "data": { "error": "ReferenceError: foo is not defined", "type": "exception" } }
```

---

## Configuration

Set in VSCode `settings.json`:

```json
{
  "cdpBridge.chromePort": 9222,
  "cdpBridge.serverPort": 9333,
  "cdpBridge.networkLogSize": 200,
  "cdpBridge.autoStart": true,
  "cdpBridge.reconnectInterval": 3000
}
```

| Setting | Default | Description |
|---|---|---|
| `chromePort` | `9222` | Chrome remote debugging port |
| `serverPort` | `9333` | Port for the HTTP bridge server |
| `networkLogSize` | `200` | Max network entries to keep in the rolling buffer |
| `autoStart` | `true` | Start automatically when VSCode opens |
| `reconnectInterval` | `3000` | Milliseconds between CDP reconnect attempts |

---

## Commands

Access via the Command Palette (`Cmd+Shift+P`):

| Command | Description |
|---|---|
| `CDP Bridge: Start` | Start the HTTP server and connect to Chrome |
| `CDP Bridge: Stop` | Stop the server and disconnect |
| `CDP Bridge: Reconnect` | Reconnect to Chrome without restarting the server |
| `CDP Bridge: Status` | Show current state, active tab, and start/stop controls |

The status bar item in the bottom-right corner shows live state and opens the status quick pick when clicked:

- `$(broadcast) CDP Bridge :9333` — connected and serving (green)
- `$(warning) CDP Bridge Error` — CDP disconnected or reconnecting (yellow)
- `$(circle-slash) CDP Bridge Off` — server stopped (grey)

---

## Architecture

```
Chrome (:9222)
    ▲
    │ WebSocket (CDP)
    │
VSCode
└── Chrome DevTools Bridge Extension
    ├── CDPManager       WebSocket → localhost:9222
    ├── NetworkLog       rolling buffer of request/response pairs
    ├── BridgeServer     Express HTTP on localhost:9333
    └── StatusBar        live state in the VSCode status bar

AI agents / curl / scripts  →  localhost:9333
```

The extension maintains a single persistent CDP WebSocket connection to Chrome. When the connection drops (e.g. Chrome restarts), it automatically reconnects with a configurable interval. The HTTP server stays up during reconnects so callers just see a brief `503` rather than a connection refused.

---

## Troubleshooting

**Bridge shows "Error" state on startup**

Chrome isn't reachable on port 9222. Verify:
1. Chrome is running with `--remote-debugging-port=9222`
2. `curl localhost:9222/json` returns tab JSON

**`/eval` returns unexpected results**

Check `/console` for JavaScript errors in the page. Use `/screenshot` to see the current page state before evaluating.

**Network log is empty**

The network log captures requests made *after* the CDP connection is established. Navigate to the page after the bridge is connected to populate it.

**Port 9333 already in use**

Change `cdpBridge.serverPort` in settings and restart the bridge.

---

## Future Enhancements

- **WebSocket endpoint** — `/ws` for subscribing to live network events without polling
- **MCP wrapper** — thin MCP server on top for native AI agent tool integration
- **Multi-tab requests** — specify a `tabId` per request rather than always using the active tab
- **Request interception** — mock API responses via `Network.setRequestInterception`
- **Auth** — optional API key header if the port is ever exposed beyond localhost
