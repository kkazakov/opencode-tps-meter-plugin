# opencode-tps-meter

An [OpenCode](https://opencode.ai) TUI plugin that displays live TPS, average TPS, and peak TPS in the session prompt.

Requires OpenCode `1.3.14` or newer.

## What It Does

Adds a live performance indicator to the session prompt:

```
TPS 129.8 TPS | AVG 127.4 TPS | Peak 145.2 TPS
```

- **TPS** — live tokens per second, updated in real time during streaming
- **AVG** — average TPS across all completed messages in the session, using real token counts
- **Peak** — the highest instantaneous TPS observed during the session

All three values show `-` when no data is available yet.

## Installation

Install from the CLI:

```bash
opencode plugin opencode-tps-meter --global
```

This installs the package and adds it to your global OpenCode config.

### Manual installation

Add the package name to your OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-tps-meter"]
}
```

## How It Works

The plugin hooks into OpenCode TUI events to track token delivery:

| Event | Purpose |
|---|---|
| `message.part.delta` | Collects streaming samples for live and peak TPS |
| `message.updated` | Accumulates real output token counts and durations for average TPS |
| `session.status → idle` | Clears live stream samples when the response cycle ends |
| `session.deleted` | Cleans up all state for the session |

**Live TPS** is estimated from streaming text deltas using byte-length heuristics (`Buffer.byteLength(delta, "utf8") / 4`) over a rolling 15-second window. It disappears when streaming stops.

**Average TPS** uses real `tokens.output` counts from completed assistant messages, measured from the parent user message's `time.created` to the assistant message's `time.completed`. This is the most accurate reading.

**Peak TPS** is the highest live TPS value observed during the session, tracked continuously from the rolling window samples.

## Local Installation (without npm)

Copy `tui.tsx` to your plugin directory:

```bash
# Global
cp tui.tsx ~/.config/opencode/plugins/opencode-tps-meter.tsx

# Project-scoped
cp tui.tsx /your/project/.opencode/plugins/opencode-tps-meter.tsx
```

Files placed in those directories are loaded automatically — no config changes needed.
