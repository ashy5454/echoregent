export type Template = Array<string | number>
export type TemplateRow = [number, ...string[]]

interface Parsed { literals: string[]; values: string[]; index: number }

/** Numeric strings stay strings: no rounding, timestamp stripping or range inference. */
function parse(text: string, index: number): Parsed | undefined {
  const literals: string[] = []
  const values: string[] = []
  let offset = 0
  for (const match of text.matchAll(/[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)) {
    if (values.length === 64) return undefined
    literals.push(text.slice(offset, match.index))
    values.push(match[0])
    offset = match.index! + match[0].length
  }
  literals.push(text.slice(offset))
  return { literals, values, index }
}

/** A request-local dictionary. Literal exceptions occupy their original row. */
export function factorTemplates(texts: string[], eligible: (text: string, index: number) => boolean) {
  const groups = new Map<string, Parsed[]>()
  const templates: Template[] = []
  const rows: Array<string | TemplateRow> = [...texts]
  texts.forEach((text, index) => {
    if (!eligible(text, index)) return
    const parsed = parse(text, index)
    if (!parsed) return
    const key = JSON.stringify(parsed.literals)
    const group = groups.get(key) ?? []
    group.push(parsed)
    groups.set(key, group)
  })
  for (const group of groups.values()) {
    if (group.length < 4) continue
    const parts: Template = []
    const variableColumns: number[] = []
    const columnIds = new Map<string, number>()
    const literal = (text: string) => {
      if (!text) return
      if (typeof parts.at(-1) === 'string') parts[parts.length - 1] = String(parts.at(-1)) + text
      else parts.push(text)
    }
    for (let column = 0; column < group[0].values.length; column++) {
      literal(group[0].literals[column])
      const values = group.map(row => row.values[column])
      if (values.every(value => value === values[0])) { literal(values[0]); continue }
      const key = JSON.stringify(values)
      let slot = columnIds.get(key)
      if (slot === undefined) {
        slot = variableColumns.length
        columnIds.set(key, slot)
        variableColumns.push(column)
      }
      parts.push(slot)
    }
    literal(group[0].literals.at(-1)!)
    const id = templates.length
    templates.push(parts)
    for (const row of group) rows[row.index] = [id, ...variableColumns.map(column => row.values[column])]
  }
  return { templates, rows }
}

export function expandTemplate(parts: unknown, values: unknown): string {
  if (!Array.isArray(parts) || !Array.isArray(values) || values.some(value => typeof value !== 'string')) throw new Error('Invalid template values')
  const slots = new Set<number>()
  const expanded = parts.map(part => {
    if (typeof part === 'string') return part
    if (!Number.isInteger(part) || part < 0 || part >= values.length) throw new Error('Invalid template slot')
    slots.add(part)
    return values[part]
  }).join('')
  if (slots.size !== values.length) throw new Error('Unused template values')
  return expanded
}
