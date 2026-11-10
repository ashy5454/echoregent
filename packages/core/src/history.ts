import { decompressText, preserveText } from './compression.js'
import { expandTemplate, factorTemplates, type Template } from './templates.js'
import { payloadTokens, textTokens } from './token-count.js'
import type { Protocol } from './index.js'

const CHUNK_SIZE = 16
const RECENT_ITEMS = 8
const HISTORY_HEADER = '[EchoRegent lossless history v1: Hn rows reuse template Hn; numbered slots index the space-separated literal values, starting at zero.]\n'
const NUMBER = /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/
const HISTORY_MARKER = /^H\d+(?:\s|$)/

/** Only a single plain conversational text block may participate in a dictionary. */
function plainText(item: any): string | undefined {
  if (!item || !['user', 'assistant'].includes(item.role)
    || (item.type !== undefined && item.type !== 'message')
    || ['tool_calls', 'function_call', 'cache_control', 'annotations'].some(key => key in item)) return undefined
  if (typeof item.content === 'string') return item.content
  if (!Array.isArray(item.content) || item.content.length !== 1) return undefined
  const part = item.content[0]
  if (!part || !['input_text', 'output_text', 'text'].includes(part.type) || typeof part.text !== 'string'
    || 'cache_control' in part || 'annotations' in part) return undefined
  return part.text
}

function withText(item: any, text: string): any {
  if (plainText(item) === text) return item
  return { ...item, content: typeof item.content === 'string' ? text : [{ ...item.content[0], text }] }
}

function rowText(id: string, values: string[]): string {
  return id + (values.length ? ' ' + values.join(' ') : '')
}

/** Complete fixed chunks age once; their encoding is independent of later turns. */
export function compactOlderHistory(items: any[]) {
  let currentUser = -1
  for (let index = items.length - 1; index >= 0; index--) {
    if (items[index]?.role === 'user') { currentUser = index; break }
  }
  const boundary = Math.min(items.length - RECENT_ITEMS, currentUser < 0 ? items.length : currentUser)
  const next = [...items]
  let charactersRemoved = 0
  for (let start = 0; start + CHUNK_SIZE <= boundary; start += CHUNK_SIZE) {
    const chunk = items.slice(start, start + CHUNK_SIZE)
    const texts = chunk.map(plainText)
    // Reserved text cannot be mistaken for a reference after factoring this chunk.
    if (texts.some(text => text !== undefined && (text.includes('[EchoRegent lossless history') || HISTORY_MARKER.test(text)))) continue
    const { templates, rows } = factorTemplates(texts.map(text => text ?? ''),
      (text, index) => texts[index] !== undefined && text.length >= 24 && !preserveText(text))
    if (!templates.length) continue
    const names = new Map<number, string>()
    let headerWritten = false
    const compacted = chunk.map((item, index) => {
      const row = rows[index]
      if (typeof row === 'string') return item
      const [templateId, ...values] = row
      let name = names.get(templateId)
      let definition = ''
      if (name === undefined) {
        name = `H${start + index}`
        names.set(templateId, name)
        definition = (headerWritten ? '' : HISTORY_HEADER) + name + ' template ' + JSON.stringify(templates[templateId]) + '\n'
        headerWritten = true
      }
      return withText(item, definition + rowText(name, values))
    })
    const before = texts.reduce((sum, text) => sum + (text?.length ?? 0), 0)
    const afterTexts = compacted.map(plainText)
    const after = afterTexts.reduce((sum, text) => sum + (text?.length ?? 0), 0)
    if (after >= before || payloadTokens(compacted) >= payloadTokens(chunk)
      || afterTexts.reduce((sum, text) => sum + textTokens(text ?? ''), 0) >= texts.reduce((sum, text) => sum + textTokens(text ?? ''), 0)) continue
    next.splice(start, CHUNK_SIZE, ...compacted)
    charactersRemoved += before - after
  }
  return { items: charactersRemoved ? next : items, charactersRemoved }
}

function parseRow(text: string, templates: Map<string, Template>): string {
  const match = /^(H\d+)(?: (.*))?$/.exec(text)
  if (!match || !templates.has(match[1])) throw new Error('Undefined history template')
  const values = match[2] === undefined ? [] : match[2].split(' ')
  if (values.some(value => !NUMBER.test(value))) throw new Error('Invalid history value')
  return expandTemplate(templates.get(match[1]), values)
}

function expandHistory(items: any[]): any[] {
  const next = [...items]
  let changed = false
  for (let start = 0; start < items.length; start += CHUNK_SIZE) {
    const chunk = items.slice(start, start + CHUNK_SIZE)
    if (chunk.length !== CHUNK_SIZE) continue
    const texts = chunk.map(plainText)
    if (texts.filter(text => text?.startsWith(HISTORY_HEADER)).length !== 1) continue
    try {
      const templates = new Map<string, Template>()
      let active = false
      const restored = chunk.map((item, index) => {
        let text = texts[index]
        if (text === undefined) return item
        if (text.startsWith(HISTORY_HEADER)) { active = true; text = text.slice(HISTORY_HEADER.length) }
        if (!active) {
          if (HISTORY_MARKER.test(text)) throw new Error('History reference before header')
          return item
        }
        const definition = /^(H\d+) template ([^\n]+)\n([^\n]+)$/.exec(text)
        if (definition) {
          if (definition[1] !== `H${start + index}` || templates.has(definition[1])) throw new Error('Invalid history template ID')
          const parts = JSON.parse(definition[2])
          if (!Array.isArray(parts)) throw new Error('Invalid history template')
          templates.set(definition[1], parts)
          return withText(item, parseRow(definition[3], templates))
        }
        if (HISTORY_MARKER.test(text)) return withText(item, parseRow(text, templates))
        return item
      })
      next.splice(start, restored.length, ...restored)
      changed ||= restored.some((item, index) => item !== chunk[index])
    } catch { /* A malformed or incomplete chunk is left entirely untouched. */ }
  }
  return changed ? next : items
}

/** Inspect the exact original payload without calling a provider or retaining a dictionary. */
export function restoreCompressedRequest<T extends Record<string, any>>(request: T, protocol: Protocol): T {
  const field = protocol === 'responses' ? 'input' : 'messages'
  const items = request[field]
  if (!Array.isArray(items)) return request
  const next = expandHistory(items).map(item => {
    const contentField = protocol === 'responses' && ['function_call_output', 'custom_tool_call_output'].includes(item?.type)
      ? 'output' : protocol === 'chat-completions' && item?.role === 'tool' ? 'content' : null
    if (!contentField) return item
    const content = item[contentField]
    if (typeof content === 'string') {
      const text = decompressText(content)
      return text === content ? item : { ...item, [contentField]: text }
    }
    if (!Array.isArray(content)) return item
    const parts = content.map(part => {
      if (!part || !['input_text', 'text'].includes(part.type) || typeof part.text !== 'string') return part
      const text = decompressText(part.text)
      return text === part.text ? part : { ...part, text }
    })
    return parts.every((part, index) => part === content[index]) ? item : { ...item, [contentField]: parts }
  })
  return next.every((item, index) => item === items[index]) ? request : { ...request, [field]: next }
}
