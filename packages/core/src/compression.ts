import { factorTemplates, expandTemplate, type TemplateRow } from './templates.js'
import { smallerText } from './token-count.js'

const REPEAT_PREFIX = '[EchoRegent: previous line repeated '
const LOG_HEADER = '[EchoRegent lossless logs v1; JSON templates interleave literals and zero-based value indexes; rows are literal strings or [template,...values]; repeat replays a row; join with LF.]\n'
const MAX_EXPANDED_CHARACTERS = 64 * 1024 * 1024
const MAX_REPEAT_COUNT = 1_000_000

export function isLogLine(text: string): boolean {
  return /^(?:(?:\[\d{4}-\d{2}-\d{2}[ T][^\]\r\n]+\]|\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\s*)?(?:\[(?:INFO|WARN|ERROR|DEBUG|TRACE)\]|PASS\b|FAIL\b|INFO\b|WARN\b|ERROR\b|DEBUG\b|TRACE\b)/.test(text.trimStart())
}

export function preserveText(text: string): boolean {
  if (text.includes('```') || text.includes('~~~') || text.includes('[EchoRegent lossless') || text.includes(REPEAT_PREFIX)) return true
  try { JSON.parse(text); return true } catch { return false }
}

/** Collapse consecutive identical, nonblank log lines. No semantic summarization. */
export function compressRepeatedLines(text: string): string {
  if (text.length < 256 || text.length > MAX_EXPANDED_CHARACTERS) return text
  if (preserveText(text)) return text
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(newline)
  const output: string[] = []
  for (let index = 0; index < lines.length;) {
    const line = lines[index]
    let end = index + 1
    const logLine = isLogLine(line)
    while (logLine && end < lines.length && lines[end] === line && end - index <= MAX_REPEAT_COUNT) end++
    output.push(line)
    if (end - index >= 4) output.push(`[EchoRegent: previous line repeated ${end - index - 1} additional times]`)
    else for (let repeat = index + 1; repeat < end; repeat++) output.push(line)
    index = end
  }
  const result = output.join(newline)
  return result.length < text.length ? result : text
}

/** Choose the cheaper of duplicate runs and lossless numeric templates. */
export function compressLogs(text: string): string {
  if (text.length < 256 || text.length > MAX_EXPANDED_CHARACTERS || preserveText(text)) return text
  let best = text
  const repeated = compressRepeatedLines(text)
  if (smallerText(best, repeated)) best = repeated
  // Split only LF: CR bytes remain in literal strings, preserving mixed endings too.
  const { templates, rows } = factorTemplates(text.split('\n'), isLogLine)
  if (!templates.length) return best
  const packed: Array<string | TemplateRow | { repeat: number; row: string | TemplateRow }> = []
  for (let index = 0; index < rows.length;) {
    const key = JSON.stringify(rows[index])
    let end = index + 1
    while (end < rows.length && JSON.stringify(rows[end]) === key && end - index < MAX_REPEAT_COUNT) end++
    if (end - index >= 4) packed.push({ repeat: end - index, row: rows[index] })
    else packed.push(...rows.slice(index, end))
    index = end
  }
  const candidate = LOG_HEADER + JSON.stringify({ templates, rows: packed })
  return smallerText(best, candidate) ? candidate : best
}

/** Exact reconstruction for locally generated log compaction. Invalid text passes through. */
export function decompressText(text: string): string {
  try {
    if (text.startsWith(LOG_HEADER)) {
      const data = JSON.parse(text.slice(LOG_HEADER.length))
      if (!data || !Array.isArray(data.templates) || !Array.isArray(data.rows)
        || Object.keys(data).sort().join(',') !== 'rows,templates') return text
      const output: string[] = []
      let characters = 0
      for (const record of data.rows) {
        const repeated = record && !Array.isArray(record) && typeof record === 'object'
        if (repeated && Object.keys(record).sort().join(',') !== 'repeat,row') return text
        const count = repeated ? record.repeat : 1
        const row = repeated ? record.row : record
        if (!Number.isInteger(count) || count < 1 || count > MAX_REPEAT_COUNT) return text
        let line: string
        if (typeof row === 'string') line = row
        else {
          if (!Array.isArray(row) || !Number.isInteger(row[0]) || row[0] < 0 || row[0] >= data.templates.length) return text
          line = expandTemplate(data.templates[row[0]], row.slice(1))
        }
        characters += (line.length + 1) * count - (output.length ? 0 : 1)
        if (characters > MAX_EXPANDED_CHARACTERS) return text
        for (let repeat = 0; repeat < count; repeat++) output.push(line)
      }
      return output.join('\n')
    }
    if (!text.includes(REPEAT_PREFIX)) return text
    const newline = text.includes('\r\n') ? '\r\n' : '\n'
    const output: string[] = []
    let characters = 0
    for (const line of text.split(newline)) {
      const match = /^\[EchoRegent: previous line repeated (\d+) additional times\]$/.exec(line)
      const previous = output.at(-1)
      if (line.includes(REPEAT_PREFIX) && (!match || previous === undefined || !isLogLine(previous))) return text
      if (match && previous !== undefined && isLogLine(previous)) {
        const count = Number(match[1])
        if (!Number.isSafeInteger(count) || count < 3 || count > MAX_REPEAT_COUNT) return text
        characters += (previous.length + newline.length) * count
        if (characters > MAX_EXPANDED_CHARACTERS) return text
        for (let repeat = 0; repeat < count; repeat++) output.push(previous)
      } else {
        characters += line.length + (output.length ? newline.length : 0)
        if (characters > MAX_EXPANDED_CHARACTERS) return text
        output.push(line)
      }
    }
    return output.join(newline)
  } catch { return text }
}
