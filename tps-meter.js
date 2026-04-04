/**
 * TPS Meter Plugin
 *
 * Shows a single toast with the averaged output TPS when the full
 * prompt/response cycle finishes (session goes idle).
 *
 * TPS is calculated as:
 *   total output tokens across all assistant messages in the cycle
 *   divided by
 *   total active streaming time (sum of per-message durations)
 */

export default {
  id: "tps-meter",

  tui: async (api) => {
    // Per-session accumulator: sessionID -> { tokens, durationMs, seen }
    // Reset only after idle fires — never on busy, because message.updated
    // events for a cycle can arrive before or after the busy event.
    const accumulators = new Map()

    function getAcc(sessionID) {
      if (!accumulators.has(sessionID)) {
        accumulators.set(sessionID, { tokens: 0, durationMs: 0, seen: new Set() })
      }
      return accumulators.get(sessionID)
    }

    function formatTps(value) {
      if (!Number.isFinite(value) || value <= 0) return undefined
      if (value >= 100) return `${Math.round(value)} TPS`
      if (value >= 10) return `${value.toFixed(1)} TPS`
      return `${value.toFixed(2)} TPS`
    }

    // Accumulate completed assistant messages
    api.event.on("message.updated", (evt) => {
      try {
        const message = evt.properties.info
        if (message.role !== "assistant") return
        if (!message.time?.completed) return

        const acc = getAcc(message.sessionID)
        if (acc.seen.has(message.id)) return

        const tokensOutput = message.tokens?.output ?? 0
        if (tokensOutput <= 0) return

        let startTime
        if (message.parentID) {
          const msgs = api.state.session.messages(message.sessionID)
          const parent = msgs.find((m) => m.id === message.parentID)
          if (parent?.time?.created) startTime = parent.time.created
        }
        if (!startTime) return

        const durationMs = message.time.completed - startTime
        if (durationMs <= 0) return

        acc.seen.add(message.id)
        acc.tokens += tokensOutput
        acc.durationMs += durationMs
      } catch (_) {}
    })

    // Show toast when the full cycle ends, then reset
    api.event.on("session.status", (evt) => {
      try {
        const { sessionID, status } = evt.properties
        if (status.type !== "idle") return

        const acc = accumulators.get(sessionID)
        if (!acc || acc.tokens === 0 || acc.durationMs === 0) return

        accumulators.delete(sessionID)

        const formatted = formatTps(acc.tokens / (acc.durationMs / 1000))
        if (!formatted) return

        api.ui.toast({ message: formatted, variant: "info", duration: 2000 })
      } catch (_) {}
    })
  },
}
