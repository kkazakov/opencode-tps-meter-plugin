# opencode-tps-meter

A TUI plugin for [OpenCode](https://opencode.ai) that shows a brief toast notification with the averaged tokens per second (TPS) at the end of each prompt/response cycle.

## What It Does

After each assistant response finishes, a small notification appears showing the output TPS for that cycle — then disappears after 2 seconds.

```
┌──────────────────┐
│   127.3 TPS      │
└──────────────────┘
```

TPS is calculated as:

```
total output tokens across all assistant messages
─────────────────────────────────────────────────
    total active streaming time (seconds)
```

Multiple assistant messages in a single cycle (e.g. with tool calls) are accumulated and averaged before display.

## Requirements

- [OpenCode](https://opencode.ai) — any recent version
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
```

Then remove the `plugin` line from `~/.config/opencode/tui.json`.

## How It Works

The plugin hooks into two OpenCode TUI events:

| Event | Purpose |
|-------|---------|
| `session.status → busy` | Resets the accumulator for a new cycle |
| `message.updated` | Accumulates output tokens and duration per completed assistant message |
| `session.status → idle` | Calculates averaged TPS and shows the toast |

Start time is taken from the parent user message's `time.created` timestamp for accuracy. End time is the assistant message's `time.completed` timestamp.

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
