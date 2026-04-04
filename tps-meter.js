/**
 * TPS Meter Plugin
 *
 * Shows a toast with the peak and average output TPS when a response completes.
 * Logs live TPS estimates during streaming to ~/.config/opencode/tps-meter.log
 */

import fs from "fs"
import path from "path"

export default {
  id: "tps-meter",

  tui: async (api) => {
    const STREAM_WINDOW_MS = 15_000
    const ACTIVE_GAP_MS = 1_250
    const LIVE_STALE_MS = 1_500
    const SINGLE_SAMPLE_MS = 1_000
    const LOG_INTERVAL_MS = 1_000

    const LOG_FILE = path.join(process.env.HOME || "~", ".config", "opencode", "tps-meter.log")

    function log(msg) {
      const ts = new Date().toISOString()
      fs.appendFileSync(LOG_FILE, `[${ts}] ${msg}\n`)
    }

    function estimateStreamTokens(delta) {
      return Math.max(1, Math.ceil(Buffer.byteLength(delta, "utf8") / 4))
    }

    function formatTps(value) {
      if (!Number.isFinite(value) || value <= 0) return undefined
      if (value >= 100) return `${Math.round(value)} TPS`
      if (value >= 10) return `${value.toFixed(1)} TPS`
      return `${value.toFixed(2)} TPS`
    }

    function activeDurationMs(samples, tailAt) {
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

    // Per-session accumulator for final TPS
    const accumulators = new Map()

    function getAcc(sessionID) {
      if (!accumulators.has(sessionID)) {
        accumulators.set(sessionID, { tokens: 0, durationMs: 0, seen: new Set(), peakTps: 0 })
      }
      return accumulators.get(sessionID)
    }

    // Per-session live streaming samples for logging
    const liveSamples = new Map()

    function getLive(sessionID) {
      if (!liveSamples.has(sessionID)) {
        liveSamples.set(sessionID, { samples: [], timer: null })
      }
      return liveSamples.get(sessionID)
    }

    // Track streaming deltas for live TPS logging
    api.event.on("message.part.delta", (evt) => {
      if (evt.properties.field !== "text" && evt.properties.field !== "reasoning") return
      const sessionID = evt.properties.sessionID
      if (!sessionID) return

      const now = Date.now()
      const tokens = estimateStreamTokens(evt.properties.delta)

      const live = getLive(sessionID)
      live.samples.push({ at: now, tokens })
      live.samples = live.samples.filter((s) => now - s.at <= STREAM_WINDOW_MS)

      // Start periodic logger if not running
      if (!live.timer) {
        live.timer = setInterval(() => {
          const now = Date.now()
          live.samples = live.samples.filter((s) => now - s.at <= STREAM_WINDOW_MS)

          if (live.samples.length === 0) {
            clearInterval(live.timer)
            live.timer = null
            return
          }

          const relevant = live.samples.filter((s) => now - s.at <= STREAM_WINDOW_MS)
          if (relevant.length === 0) return

          const last = relevant[relevant.length - 1]
          if (!last || now - last.at > LIVE_STALE_MS) return

          const total = relevant.reduce((sum, s) => sum + s.tokens, 0)
          const dur = activeDurationMs(relevant, now) / 1000
          if (dur <= 0) return

          const tps = formatTps(total / dur)
          if (tps) {
            log(`live TPS: ${tps}`)
            // Track peak TPS
            const acc = getAcc(sessionID)
            const rawTps = total / dur
            if (rawTps > acc.peakTps) acc.peakTps = rawTps
          }
        }, LOG_INTERVAL_MS)
      }
    })

    // Clean up live samples when message completes
    api.event.on("message.updated", (evt) => {
      const info = evt.properties.info
      if (info.role !== "assistant" || !info.time?.completed) return

      // Clean up live samples
      const live = liveSamples.get(info.sessionID)
      if (live?.timer) {
        clearInterval(live.timer)
        live.timer = null
      }

      // Accumulate for final TPS
      const acc = getAcc(info.sessionID)
      if (acc.seen.has(info.id)) return

      const tokensOutput = info.tokens?.output ?? 0
      if (tokensOutput <= 0) return

      let startTime
      if (info.parentID) {
        const msgs = api.state.session.messages(info.sessionID)
        const parent = msgs.find((m) => m.id === info.parentID)
        if (parent?.time?.created) startTime = parent.time.created
      }
      if (!startTime) return

      const durationMs = info.time.completed - startTime
      if (durationMs <= 0) return

      acc.seen.add(info.id)
      acc.tokens += tokensOutput
      acc.durationMs += durationMs
    })

    // Clean up on session delete
    api.event.on("session.deleted", (evt) => {
      const sid = evt.properties.info.id
      accumulators.delete(sid)
      const live = liveSamples.get(sid)
      if (live?.timer) clearInterval(live.timer)
      liveSamples.delete(sid)
    })

    api.event.on("session.status", (evt) => {
      try {
        const { sessionID, status } = evt.properties
        if (status.type !== "idle") return

        const acc = accumulators.get(sessionID)
        if (!acc || acc.tokens === 0 || acc.durationMs === 0) return

        accumulators.delete(sessionID)

        const avgTps = acc.tokens / (acc.durationMs / 1000)
        const avgFormatted = formatTps(avgTps)
        const peakFormatted = formatTps(acc.peakTps)

        const lines = []
        if (avgFormatted) lines.push(`Avg: ${avgFormatted}`)
        if (peakFormatted) lines.push(`Peak: ${peakFormatted}`)

        const message = lines.join(" | ")
        if (!message) return

        log(`completed: ${message}`)
        api.ui.toast({ message, variant: "info", duration: 5000 })
      } catch (_) {}
    })
  },
}
