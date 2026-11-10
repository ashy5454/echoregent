export function readUsage(usage) {
  if (!usage || !Number.isInteger(usage.input_tokens) || usage.input_tokens < 0 || !Number.isInteger(usage.output_tokens) || usage.output_tokens < 0) return null
  const cached = usage.input_tokens_details?.cached_tokens
  const cachedInputTokens = Number.isInteger(cached) && cached >= 0 && cached <= usage.input_tokens ? cached : null
  return { inputTokens: usage.input_tokens, cachedInputTokens, uncachedInputTokens: cachedInputTokens === null ? null : usage.input_tokens - cachedInputTokens, outputTokens: usage.output_tokens, totalTokens: usage.input_tokens + usage.output_tokens }
}

export function createUsageCollector() {
  let pending = ''
  const records = []
  return {
    push(text) {
      pending += text
      for (;;) {
        const match = /\r?\n\r?\n/.exec(pending)
        if (!match) break
        const event = pending.slice(0, match.index)
        pending = pending.slice(match.index + match[0].length)
        const data = event.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
        try {
          const parsed = JSON.parse(data)
          if (parsed.type === 'response.completed') {
            const usage = readUsage(parsed.response?.usage)
            if (usage) records.push(usage)
          }
        } catch { /* non-JSON events are not usage evidence */ }
      }
      // Retain at most the unfinished SSE event; never the response transcript.
      if (pending.length > 2 * 1024 * 1024) pending = ''
    },
    finish() { return [...records] },
  }
}
