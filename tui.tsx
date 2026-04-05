/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal } from "solid-js"

type StreamSample = {
  at: number
  tokens: number
}

const STREAM_WINDOW_MS = 15_000
const ACTIVE_GAP_MS = 1_250
const LIVE_STALE_MS = 1_500
const SINGLE_SAMPLE_MS = 1_000

type SessionAccumulator = {
  tokens: number
  durationMs: number
  peakTps: number
  seen: Set<string>
}

type TrackerState = {
  streamSamplesBySession: Record<string, StreamSample[]>
  accumulatorBySession: Record<string, SessionAccumulator>
}

function estimateStreamTokens(delta: string) {
  return Math.max(1, Math.ceil(Buffer.byteLength(delta, "utf8") / 4))
}

function formatTps(value: number) {
  if (!Number.isFinite(value) || value <= 0) return undefined
  if (value >= 100) return `${Math.round(value)} TPS`
  if (value >= 10) return `${value.toFixed(1)} TPS`
  return `${value.toFixed(2)} TPS`
}

function activeDurationMs(samples: StreamSample[], tailAt?: number) {
  if (samples.length === 0) return 0
  if (samples.length === 1) {
    const tailDuration = tailAt ? Math.max(0, tailAt - samples[0].at) : SINGLE_SAMPLE_MS
    return Math.min(Math.max(tailDuration, 250), SINGLE_SAMPLE_MS)
  }
  let duration = 0
  for (let i = 1; i < samples.length; i++) {
    duration += Math.min(Math.max(0, samples[i].at - samples[i - 1].at), ACTIVE_GAP_MS)
  }
  if (tailAt) {
    duration += Math.min(Math.max(0, tailAt - samples[samples.length - 1].at), ACTIVE_GAP_MS)
  }
  return Math.max(duration, SINGLE_SAMPLE_MS)
}

function SessionPromptRight(props: {
  api: Parameters<TuiPlugin>[0]
  sessionID: string
  tracker: TrackerState
  version: () => number
  clock: () => number
}) {
  const liveTps = createMemo(() => {
    props.version()
    props.clock()
    const status = props.api.state.session.status(props.sessionID)
    if (status?.type === "idle") return undefined
    const samples = props.tracker.streamSamplesBySession[props.sessionID] ?? []
    if (samples.length === 0) return undefined
    const now = Date.now()
    const relevant = samples.filter((s) => now - s.at <= STREAM_WINDOW_MS)
    if (relevant.length === 0) return undefined
    const last = relevant[relevant.length - 1]
    if (!last || now - last.at > LIVE_STALE_MS) return undefined
    const total = relevant.reduce((sum, s) => sum + s.tokens, 0)
    const durationSeconds = activeDurationMs(relevant, now) / 1000
    if (durationSeconds <= 0) return undefined
    return formatTps(total / durationSeconds)
  })

  const avgTps = createMemo(() => {
    props.version()
    const acc = props.tracker.accumulatorBySession[props.sessionID]
    if (!acc || acc.tokens <= 0 || acc.durationMs <= 0) return undefined
    return formatTps(acc.tokens / (acc.durationMs / 1000))
  })

  const peakTps = createMemo(() => {
    props.version()
    const acc = props.tracker.accumulatorBySession[props.sessionID]
    if (!acc || acc.peakTps <= 0) return undefined
    return formatTps(acc.peakTps)
  })

  const text = createMemo(() => {
    const live = liveTps() ?? "-"
    const avg = avgTps() ?? "-"
    const peak = peakTps() ?? "-"
    return `TPS ${live} | AVG ${avg} | Peak ${peak}`
  })

  return <>{text() ? <text fg={props.api.theme.current.textMuted}>{text()}</text> : null}</>
}

const tui: TuiPlugin = async (api) => {
  const tracker: TrackerState = {
    streamSamplesBySession: {},
    accumulatorBySession: {},
  }

  const [version, setVersion] = createSignal(0)
  const [clock, setClock] = createSignal(Date.now())
  const bump = () => setVersion((v) => v + 1)

  function getAcc(sessionID: string): SessionAccumulator {
    if (!tracker.accumulatorBySession[sessionID]) {
      tracker.accumulatorBySession[sessionID] = {
        tokens: 0,
        durationMs: 0,
        peakTps: 0,
        seen: new Set(),
      }
    }
    return tracker.accumulatorBySession[sessionID]
  }

  const pruneSamples = (now = Date.now()) => {
    let changed = false
    for (const [sessionID, samples] of Object.entries(tracker.streamSamplesBySession)) {
      const next = samples.filter((s) => now - s.at <= STREAM_WINDOW_MS)
      if (next.length !== samples.length) {
        changed = true
        if (next.length > 0) tracker.streamSamplesBySession[sessionID] = next
        else delete tracker.streamSamplesBySession[sessionID]
      }
    }
    if (changed) bump()
  }

  const onDelta = api.event.on("message.part.delta", (evt) => {
    if (evt.properties.field !== "text" && evt.properties.field !== "reasoning") return
    const { sessionID } = evt.properties
    if (!sessionID) return

    const now = Date.now()
    const tokens = estimateStreamTokens(evt.properties.delta)

    const existing = tracker.streamSamplesBySession[sessionID] ?? []
    tracker.streamSamplesBySession[sessionID] = [
      ...existing.filter((s) => now - s.at <= STREAM_WINDOW_MS),
      { at: now, tokens },
    ]

    // Update peak TPS from the current rolling window
    const samples = tracker.streamSamplesBySession[sessionID]
    const total = samples.reduce((sum, s) => sum + s.tokens, 0)
    const durationSeconds = activeDurationMs(samples, now) / 1000
    if (durationSeconds > 0) {
      const currentTps = total / durationSeconds
      const acc = getAcc(sessionID)
      if (currentTps > acc.peakTps) {
        acc.peakTps = currentTps
      }
    }

    bump()
  })

  const onMessage = api.event.on("message.updated", (evt) => {
    const info = evt.properties.info
    if (info.role !== "assistant" || !info.time?.completed) return

    const acc = getAcc(evt.properties.sessionID)
    if (acc.seen.has(info.id)) return

    const tokensOutput = info.tokens?.output ?? 0
    if (tokensOutput <= 0) return

    // Use parent user message time as start, matching original implementation
    let startTime: number | undefined
    if (info.parentID) {
      const msgs = api.state.session.messages(evt.properties.sessionID)
      const parent = msgs.find((m) => m.id === info.parentID)
      if (parent?.time?.created) startTime = parent.time.created
    }
    if (!startTime) return

    const durationMs = info.time.completed - startTime
    if (durationMs <= 0) return

    acc.seen.add(info.id)
    acc.tokens += tokensOutput
    acc.durationMs += durationMs

    pruneSamples(info.time.completed)
    bump()
  })

  const onSessionDeleted = api.event.on("session.deleted", (evt) => {
    const sid = evt.properties.info.id
    delete tracker.streamSamplesBySession[sid]
    delete tracker.accumulatorBySession[sid]
    bump()
  })

  const onSessionStatus = api.event.on("session.status", (evt) => {
    const { sessionID, status } = evt.properties
    if (status.type !== "idle") return
    // Clear stream samples when session goes idle so live TPS stops showing
    if (tracker.streamSamplesBySession[sessionID]) {
      delete tracker.streamSamplesBySession[sessionID]
      bump()
    }
  })

  const timer = setInterval(() => {
    setClock(Date.now())
    pruneSamples()
  }, 1000)

  api.lifecycle.onDispose(() => {
    onDelta()
    onMessage()
    onSessionDeleted()
    onSessionStatus()
    clearInterval(timer)
  })

  api.slots.register({
    slots: {
      session_prompt_right(_ctx, value) {
        return (
          <SessionPromptRight
            api={api}
            sessionID={value.session_id}
            tracker={tracker}
            version={version}
            clock={clock}
          />
        )
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "opencode-tps-meter",
  tui,
}

export default plugin
