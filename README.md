# opencode-tps-meter

A TUI plugin for [OpenCode](https://opencode.ai) that shows tokens per second (TPS) during and after each assistant response.

## What It Does

### Live Logging (during streaming)

While the assistant generates tokens, TPS is logged every second to `~/.config/opencode/tps-meter.log`:

```
[2026-04-04T12:34:56.789Z] live TPS: 127.3 TPS
[2026-04-04T12:34:57.789Z] live TPS: 131.5 TPS
[2026-04-04T12:34:58.789Z] live TPS: 129.8 TPS
[2026-04-04T12:34:59.789Z] completed: Avg: 129.4 TPS | Peak: 145.2 TPS
```

Watch it live in a second terminal:

```bash
tail -f ~/.config/opencode/tps-meter.log
```

### Toast Notification (after completion)

When the response finishes, a toast appears for 5 seconds showing both average and peak TPS:

```
┌──────────────────────────────────┐
│   Avg: 129.4 TPS | Peak: 145.2 TPS │
└──────────────────────────────────┘
```

TPS is calculated as:

```
total output tokens across all assistant messages
─────────────────────────────────────────────────
    total active streaming time (seconds)
```

Multiple assistant messages in a single cycle (e.g. with tool calls) are accumulated and averaged. Peak TPS is tracked from live streaming samples using a rolling 15-second window.

## Requirements

- [OpenCode](https://opencode.ai) v1.3.13
- [Bun](https://bun.sh) (OpenCode's runtime)

## Installation

### 1. Copy the plugin file

```bash
mkdir -p ~/.config/opencode/plugins
cp tps-meter.js ~/.config/opencode/plugins/tps-meter.js
```

### 2. Declare the plugin in `tui.json`

Create or edit `~/.config/opencode/tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["file:///home/YOUR_USERNAME/.config/opencode/plugins/tps-meter.js"]
}
```

Replace `YOUR_USERNAME` with your actual username, or use the full absolute path. You can find it with:

```bash
echo "file://$(realpath ~/.config/opencode/plugins/tps-meter.js)"
```

### 3. Restart OpenCode

```bash
opencode
```

The plugin loads automatically on startup. No further configuration needed.

## Uninstall

Remove the plugin file and the entry from `tui.json`:

```bash
rm ~/.config/opencode/plugins/tps-meter.js
rm ~/.config/opencode/tps-meter.log
```

Then remove the `plugin` line from `~/.config/opencode/tui.json`.

## How It Works

The plugin hooks into three OpenCode TUI events:

| Event | Purpose |
|-------|---------|
| `message.part.delta` | Tracks live streaming tokens for peak TPS estimation and logging |
| `message.updated` | Accumulates output tokens and duration per completed assistant message |
| `session.status → idle` | Calculates average and peak TPS, shows the toast |

**Live TPS** is estimated using byte-length token estimation (`Buffer.byteLength(delta, "utf8") / 4`) over a rolling 15-second window, matching the original implementation's approach.

**Average TPS** uses real token counts from completed messages, measured from the parent user message's `time.created` to the assistant message's `time.completed`.

**Peak TPS** is the highest live TPS observed during streaming.

## Log File

`~/.config/opencode/tps-meter.log` contains timestamped TPS entries:

- `live TPS: 127.3 TPS` — logged every second during streaming
- `completed: Avg: 129.4 TPS | Peak: 145.2 TPS` — logged once when response finishes

The log file grows unbounded. Clear it manually when needed:

```bash
> ~/.config/opencode/tps-meter.log
```

## Project-Scoped Installation

To enable the plugin only for a specific project, place it in the project's `.opencode` directory instead:

```bash
mkdir -p /your/project/.opencode/plugins
cp tps-meter.js /your/project/.opencode/plugins/tps-meter.js
```

And declare it in `/your/project/.opencode/tui.json`:

```json
{
  "plugin": ["file:///your/project/.opencode/plugins/tps-meter.js"]
}
```
