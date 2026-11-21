import { existsSync, mkdirSync, writeFileSync, appendFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { evaluatePolicy } from './policy.js'
import type { MemoryFact, MemoryScope, ScopedMemory } from './memory.js'

export const STOPWORDS = new Set([
  'what', 'where', 'when', 'which', 'who', 'how',
  'is', 'are', 'was', 'were', 'do', 'does', 'did',
  'the', 'a', 'an', 'to', 'of', 'in', 'on', 'for',
  'with', 'we', 'our', 'use', 'using', 'about', 'tell', 'me',
])

export interface WikiSyncEvent {
  type: 'remember' | 'update' | 'forget' | 'purge'
  fact?: MemoryFact
  id?: string
  count?: number
  now: number
}

export interface ExtractedConcept {
  name: string
  slug: string
  facts: MemoryFact[]
  relatedSlugs: Set<string>
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'concept'
}

export function extractConcepts(facts: MemoryFact[]): ExtractedConcept[] {
  const conceptMap = new Map<string, ExtractedConcept>()

  for (const fact of facts) {
    const content = fact.content
    const detectedNames = new Set<string>()

    // Match [[wikilinks]]
    const wikilinkMatches = content.match(/\[\[([^\]]+)\]\]/g)
    if (wikilinkMatches) {
      for (const m of wikilinkMatches) {
        const raw = m.slice(2, -2).trim()
        if (raw) detectedNames.add(raw)
      }
    }

    // Match Capitalized technical terms or entity names
    const capitalizedMatches = content.match(/\b([A-Z][a-zA-Z0-9_-]{2,})\b/g)
    if (capitalizedMatches) {
      for (const raw of capitalizedMatches) {
        if (!STOPWORDS.has(raw.toLowerCase())) detectedNames.add(raw)
      }
    }

    // If still empty, grab key non-stopwords with length >= 4
    if (!detectedNames.size) {
      const words = content.toLowerCase().match(/[a-z0-9_]{4,}/g) ?? []
      for (const w of words) {
        if (!STOPWORDS.has(w)) {
          detectedNames.add(w.charAt(0).toUpperCase() + w.slice(1))
          if (detectedNames.size >= 3) break
        }
      }
    }

    const slugsInFact = new Set<string>()
    for (const name of detectedNames) {
      const slug = slugify(name)
      slugsInFact.add(slug)
      if (!conceptMap.has(slug)) {
        conceptMap.set(slug, {
          name,
          slug,
          facts: [],
          relatedSlugs: new Set(),
        })
      }
      const entry = conceptMap.get(slug)!
      if (!entry.facts.some((f) => f.id === fact.id)) {
        entry.facts.push(fact)
      }
    }

    // Interlink related concepts within the same fact
    for (const slug of slugsInFact) {
      const entry = conceptMap.get(slug)!
      for (const otherSlug of slugsInFact) {
        if (otherSlug !== slug) entry.relatedSlugs.add(otherSlug)
      }
    }
  }

  return Array.from(conceptMap.values()).sort((a, b) => a.slug.localeCompare(b.slug))
}

export function rankFacts(facts: MemoryFact[], queryText: string, maxFacts?: number): MemoryFact[] {
  const activeFacts = facts.filter(
    (fact) => !fact.supersededBy && evaluatePolicy(fact.content).memory,
  )
  const trimmed = queryText.trim()
  if (!trimmed) {
    const sorted = [...activeFacts].sort((a, b) => b.updatedAt - a.updatedAt)
    return maxFacts !== undefined ? sorted.slice(0, maxFacts) : sorted
  }

  const rawTokens = trimmed.toLowerCase().match(/[a-z0-9_]+/g) ?? []
  const tokens = rawTokens.filter((token) => !STOPWORDS.has(token))
  const queryTokens = tokens.length > 0 ? tokens : rawTokens
  if (!queryTokens.length) {
    const sorted = [...activeFacts].sort((a, b) => b.updatedAt - a.updatedAt)
    return maxFacts !== undefined ? sorted.slice(0, maxFacts) : sorted
  }

  const uniqueTokens = Array.from(new Set(queryTokens))
  const scored: Array<{ fact: MemoryFact; score: number }> = []

  for (const fact of activeFacts) {
    const haystack = (fact.content + ' ' + fact.sources.join(' ')).toLowerCase()
    const score = uniqueTokens.filter((token) => haystack.includes(token)).length
    if (score > 0) {
      scored.push({ fact, score })
    }
  }

  scored.sort((a, b) => b.score - a.score || b.fact.updatedAt - a.fact.updatedAt)
  const results = scored.map((item) => item.fact)
  return maxFacts !== undefined ? results.slice(0, maxFacts) : results
}

export function formatContextBlock(facts: MemoryFact[]): string {
  if (!facts.length) return ''
  const lines = [
    '[EchoRegent LLM-Wiki Memory Context]',
    ...facts.map((fact) => `- ${fact.content} ^[${fact.sources.join(', ')}]`),
  ]
  return lines.join('\n')
}

export class WikiMemory {
  constructor(private readonly memory: ScopedMemory) {}

  compileContextBlock(scope: MemoryScope, queryText: string, maxFacts = 5): string {
    if (this.memory.isProtected(scope)) return ''
    if (queryText.trim() && !evaluatePolicy(queryText).memory) return ''
    const facts = this.memory.getActiveFactsSync(scope)
    const ranked = rankFacts(facts, queryText, maxFacts)
    return formatContextBlock(ranked)
  }

  static syncWiki(
    directory: string,
    scopeKey: string,
    facts: MemoryFact[],
    event: WikiSyncEvent,
  ): void {
    const wikiDir = join(directory, scopeKey, 'wiki')
    mkdirSync(wikiDir, { recursive: true, mode: 0o700 })
    const conceptsDir = join(wikiDir, 'concepts')
    mkdirSync(conceptsDir, { recursive: true, mode: 0o700 })

    // 1. SCHEMA.md
    const schemaPath = join(wikiDir, 'SCHEMA.md')
    if (!existsSync(schemaPath)) {
      const schemaContent = [
        '# EchoRegent LLM-Wiki Continually Learning Memory Schema',
        '',
        'This directory provides human-readable, auditable, continually learning memory for EchoRegent.',
        '',
        '## Hierarchy & Files',
        '- `SCHEMA.md`: Schema definitions, format contracts, and semantic rules.',
        '- `index.md`: Current catalog of active facts, updated/superseded history, and concept index.',
        '- `log.md`: Append-only chronological audit log of all memory operations (`remember`, `update`, `forget`, `purge`).',
        '- `concepts/<slug>.md`: Concept pages interlinking facts with `^[source]` citations and `[[wikilinks]]` cross-references.',
        '',
        '## Provenance & Continual Learning Contracts',
        '- **Citations**: Facts must cite their source origins via `^[source]`.',
        '- **Interlinking**: Related topics connect using `[[concept-slug]]` wikilinks.',
        "- **Supersession**: When a fact updates previous knowledge (`relation: 'updates'`), the previous fact is marked superseded while remaining in historical audit records.",
        '',
      ].join('\n')
      writeFileSync(schemaPath, schemaContent, 'utf8')
    }

    // 2. log.md (append-only chronological log)
    const logPath = join(wikiDir, 'log.md')
    if (!existsSync(logPath)) {
      writeFileSync(logPath, '# EchoRegent Memory Audit Log\n\n', 'utf8')
    }
    const iso = new Date(event.now).toISOString()
    let logEntry = ''
    switch (event.type) {
      case 'remember': {
        const f = event.fact!
        const relationText =
          f.relation && f.supersedesId ? ` (${f.relation} ${f.supersedesId})` : ''
        logEntry = `- [${iso}] REMEMBER [${f.id}] "${f.content}" ^[${f.sources.join(', ')}]${relationText}\n`
        break
      }
      case 'update': {
        const f = event.fact!
        logEntry = `- [${iso}] UPDATE [${f.id}] "${f.content}" ^[${f.sources.join(', ')}]\n`
        break
      }
      case 'forget': {
        logEntry = `- [${iso}] FORGET [${event.id}]\n`
        break
      }
      case 'purge': {
        logEntry = `- [${iso}] PURGE scope (${event.count ?? 0} facts removed)\n`
        break
      }
    }
    if (logEntry) {
      appendFileSync(logPath, logEntry, 'utf8')
    }

    // 3. index.md (cataloging facts, concepts, and updated/superseded history)
    const activeFacts = facts.filter((f) => !f.supersededBy)
    const supersededFacts = facts.filter((f) => !!f.supersededBy)
    const concepts = extractConcepts(facts)

    const activeLines = activeFacts.length
      ? activeFacts.map(
          (f) =>
            `- **[${f.id}]**: ${f.content} ^[${f.sources.join(', ')}]${f.relation ? ` *(${f.relation} ${f.supersedesId})*` : ''}`,
        )
      : ['- None']

    const supersededLines = supersededFacts.length
      ? supersededFacts.map(
          (f) =>
            `- ~~**[${f.id}]**: ${f.content}~~ -> Superseded by [[${f.supersededBy}]] ^[${f.sources.join(', ')}]`,
        )
      : ['- None']

    const conceptLines = concepts.length
      ? concepts.map(
          (c) =>
            `- [[${c.slug}]] (${c.name}) - ${c.facts.length} fact${c.facts.length === 1 ? '' : 's'}`,
        )
      : ['- None']

    const indexContent = [
      '# EchoRegent LLM-Wiki Knowledge Index',
      '',
      '## Active Facts',
      ...activeLines,
      '',
      '## Superseded Facts (History)',
      ...supersededLines,
      '',
      '## Concepts',
      ...conceptLines,
      '',
    ].join('\n')
    writeFileSync(join(wikiDir, 'index.md'), indexContent, 'utf8')

    // 4. concepts/<slug>.md (interlinked with [[wikilinks]] and ^[source] citations)
    const currentSlugs = new Set(concepts.map((c) => `${c.slug}.md`))
    if (existsSync(conceptsDir)) {
      for (const existingFile of readdirSync(conceptsDir)) {
        if (existingFile.endsWith('.md') && !currentSlugs.has(existingFile)) {
          rmSync(join(conceptsDir, existingFile), { force: true })
        }
      }
    }

    for (const concept of concepts) {
      const conceptContent = [
        `# ${concept.name}`,
        '',
        '## Facts',
        ...concept.facts.map((f) => `- ${f.content} ^[${f.sources.join(', ')}]`),
        '',
        '## Related Concepts',
        ...(concept.relatedSlugs.size
          ? Array.from(concept.relatedSlugs)
              .sort()
              .map((s) => `- [[${s}]]`)
          : ['- None']),
        '',
      ].join('\n')
      writeFileSync(join(conceptsDir, `${concept.slug}.md`), conceptContent, 'utf8')
    }
  }
}
