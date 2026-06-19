import type { LLMWiki, RoutingFrame, SourceInput, WikiPage, WikiSource } from './types.js'

export type WikiLLMCall = (prompt: string) => Promise<string>

export function createEmptyLLMWiki(): LLMWiki {
  const now = new Date().toISOString()
  return {
    sources: [],
    pages: [],
    indexMarkdown: '# Index\n\nNo pages yet.\n',
    logMarkdown: '# Log\n',
    schemaMarkdown: [
      '# CTS LLM Wiki Schema',
      '',
      '- Raw sources are immutable.',
      '- Wiki pages are generated markdown maintained by CTS.',
      '- index.md catalogs pages by path and summary.',
      '- log.md is append-only and records ingests/queries/lint passes.',
      '- Pages should preserve source IDs and cross-link related concepts.',
    ].join('\n'),
    version: 1,
    lastUpdated: now,
  }
}

export async function ingestSourceIntoLLMWiki(
  existing: LLMWiki | null,
  input: SourceInput,
  frame: RoutingFrame,
  llmCall?: WikiLLMCall,
): Promise<LLMWiki> {
  const wiki = cloneWiki(existing ?? createEmptyLLMWiki())
  const now = new Date().toISOString()
  const source: WikiSource = {
    id: `src-${Date.now().toString(36)}`,
    title: input.title.trim() || `Source ${wiki.sources.length + 1}`,
    content: input.content.trim(),
    addedAt: now,
  }

  if (!source.content) return wiki

  wiki.sources.push(source)

  let ingestedWithLLM = false
  if (llmCall) {
    const pages = await llmIngestPages(wiki, source, frame, llmCall, now)
    if (pages.length > 0) {
      for (const page of pages) upsertPage(wiki, page)
      ingestedWithLLM = true
    }
  }

  if (!ingestedWithLLM) {
    upsertPage(wiki, {
      path: 'overview.md',
      title: 'Overview',
      markdown: buildOverviewPage(wiki, source, frame),
      updatedAt: now,
      sourceIds: unique([...wiki.pages.find((p) => p.path === 'overview.md')?.sourceIds ?? [], source.id]),
      tags: ['overview', frame.domain, frame.intent],
    })

    upsertPage(wiki, {
      path: `domains/${slug(frame.domain)}.md`,
      title: `Domain: ${frame.domain}`,
      markdown: buildDomainPage(source, frame),
      updatedAt: now,
      sourceIds: unique([...wiki.pages.find((p) => p.path === `domains/${slug(frame.domain)}.md`)?.sourceIds ?? [], source.id]),
      tags: ['domain', frame.domain],
    })

    for (const concept of extractConcepts(source.content, source.title).slice(0, 4)) {
      const path = `concepts/${slug(concept)}.md`
      upsertPage(wiki, {
        path,
        title: concept,
        markdown: buildConceptPage(concept, source, frame),
        updatedAt: now,
        sourceIds: unique([...wiki.pages.find((p) => p.path === path)?.sourceIds ?? [], source.id]),
        tags: ['concept', frame.domain],
      })
    }
  }

  wiki.indexMarkdown = buildIndex(wiki)
  wiki.logMarkdown += `\n## [${now.slice(0, 10)}] ingest | ${source.title}\n- Source: ${source.id}\n- Routed as: ${frame.intent} / ${frame.domain} / ${frame.state}\n- Method: ${ingestedWithLLM ? 'llm' : 'template'}\n`
  wiki.version += 1
  wiki.lastUpdated = now
  return wiki
}

export function llmWikiToContextString(wiki: LLMWiki | null, message: string, maxPages = 4): string {
  if (!wiki || wiki.pages.length === 0) return ''
  const lower = message.toLowerCase()
  const scored = wiki.pages
    .map((page) => ({
      page,
      score: page.tags.filter((tag) => lower.includes(tag.toLowerCase())).length +
        tokenize(page.title).filter((token) => lower.includes(token)).length +
        tokenize(page.markdown).filter((token) => lower.includes(token)).slice(0, 5).length,
    }))
    .sort((a, b) => b.score - a.score || b.page.updatedAt.localeCompare(a.page.updatedAt))
    .slice(0, maxPages)

  return [
    'LLM Wiki context:',
    ...scored.map(({ page }) => [
      `## ${page.path}`,
      page.markdown.slice(0, 1200),
    ].join('\n')),
  ].join('\n\n')
}

export function lintLLMWiki(wiki: LLMWiki | null): string[] {
  if (!wiki) return ['No LLM wiki exists yet.']
  const issues: string[] = []
  const linked = new Set<string>()
  for (const page of wiki.pages) {
    const matches = page.markdown.matchAll(/\[\[[^\]]+\]\]/g)
    for (const match of matches) linked.add(match[0].slice(2, -2))
  }
  const pageTitles = new Set(wiki.pages.map((page) => page.title))
  for (const link of linked) {
    if (!pageTitles.has(link)) issues.push(`Missing page for link: ${link}`)
  }
  for (const page of wiki.pages) {
    if (page.sourceIds.length === 0) issues.push(`Page has no source IDs: ${page.path}`)
  }
  return issues.length ? issues : ['Wiki lint passed: no obvious broken links or source gaps.']
}

// ── LLM-driven ingest ─────────────────────────────────────────────────────────

async function llmIngestPages(
  wiki: LLMWiki,
  source: WikiSource,
  frame: RoutingFrame,
  llmCall: WikiLLMCall,
  now: string,
): Promise<WikiPage[]> {
  const relevantPages = wiki.pages
    .map((page) => ({
      page,
      score: tokenize(source.content + ' ' + source.title)
        .filter((t) => page.markdown.toLowerCase().includes(t)).length,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.page)

  const prompt = buildIngestPrompt(wiki, source, frame, relevantPages)

  let raw: string
  try {
    raw = await llmCall(prompt)
  } catch {
    return []
  }

  return parsePagesFromLLMOutput(raw, source.id, now, frame)
}

function buildIngestPrompt(wiki: LLMWiki, source: WikiSource, frame: RoutingFrame, relevantPages: WikiPage[]): string {
  const parts: string[] = [
    `You are maintaining a structured knowledge wiki for an AI assistant.`,
    `Current conversation domain: ${frame.domain} | intent: ${frame.intent} | state: ${frame.state}`,
    '',
    '## Current wiki index',
    wiki.indexMarkdown.slice(0, 600) || '(empty)',
  ]

  if (relevantPages.length > 0) {
    parts.push('', '## Relevant existing pages')
    for (const page of relevantPages) {
      parts.push(`### ${page.path}`, page.markdown.slice(0, 500))
    }
  }

  parts.push(
    '',
    '## New source to integrate',
    `Title: ${source.title}`,
    source.content.slice(0, 2000),
    '',
    'Return new or updated wiki pages using this exact format (repeat for each page):',
    'PAGE: path/to/page.md',
    '[markdown content — under 400 words, use [[Title]] links, extract specific facts/decisions/questions]',
    '',
    'Use paths like: overview.md, concepts/name.md, domains/name.md',
    'Do not reproduce the source verbatim. Synthesize, link, and highlight what matters.',
  )

  return parts.filter((p) => p !== null).join('\n')
}

function parsePagesFromLLMOutput(raw: string, sourceId: string, now: string, frame: RoutingFrame): WikiPage[] {
  const pages: WikiPage[] = []
  const blocks = raw.split(/^PAGE:\s*/m).filter(Boolean)

  for (const block of blocks) {
    const newlineIdx = block.indexOf('\n')
    if (newlineIdx === -1) continue
    const rawPath = block.slice(0, newlineIdx).trim()
    const markdown = block.slice(newlineIdx + 1).trim()
    if (!rawPath || !markdown) continue

    const safePath = rawPath
      .replace(/[^a-z0-9/_.-]/gi, '-')
      .replace(/\.{2,}/g, '.')
      .replace(/^[-/]+|[-/]+$/g, '')
      .slice(0, 80)
    if (!safePath) continue

    const titleRaw = safePath.split('/').pop()?.replace(/\.md$/, '').replace(/-/g, ' ') ?? safePath

    pages.push({
      path: safePath.endsWith('.md') ? safePath : `${safePath}.md`,
      title: titleCase(titleRaw),
      markdown,
      updatedAt: now,
      sourceIds: [sourceId],
      tags: [frame.domain, frame.intent],
    })
  }

  return pages
}

// ── Template fallback (original) ──────────────────────────────────────────────

function buildOverviewPage(wiki: LLMWiki, source: WikiSource, frame: RoutingFrame): string {
  return [
    '# Overview',
    '',
    `Latest source: [[${source.title}]]`,
    `Routed domain: [[Domain: ${frame.domain}]]`,
    `Routed intent: ${frame.intent}`,
    '',
    '## Current synthesis',
    summarize(source.content),
    '',
    '## Source trail',
    ...wiki.sources.slice(-6).map((item) => `- ${item.id}: ${item.title}`),
  ].join('\n')
}

function buildDomainPage(source: WikiSource, frame: RoutingFrame): string {
  return [
    `# Domain: ${frame.domain}`,
    '',
    `Intent observed: ${frame.intent}`,
    `State observed: ${frame.state}`,
    '',
    '## New evidence',
    summarize(source.content),
    '',
    `Sources: ${source.id}`,
  ].join('\n')
}

function buildConceptPage(concept: string, source: WikiSource, frame: RoutingFrame): string {
  return [
    `# ${concept}`,
    '',
    `Related domain: [[Domain: ${frame.domain}]]`,
    '',
    '## Notes',
    summarize(source.content),
    '',
    `Sources: ${source.id}`,
  ].join('\n')
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function upsertPage(wiki: LLMWiki, page: WikiPage): void {
  const index = wiki.pages.findIndex((item) => item.path === page.path)
  if (index >= 0) wiki.pages[index] = mergePage(wiki.pages[index], page)
  else wiki.pages.push(page)
}

function mergePage(existing: WikiPage, next: WikiPage): WikiPage {
  return {
    ...next,
    markdown: `${existing.markdown}\n\n---\n\n${next.markdown}`,
    sourceIds: unique([...existing.sourceIds, ...next.sourceIds]),
    tags: unique([...existing.tags, ...next.tags]),
  }
}

function buildIndex(wiki: LLMWiki): string {
  return [
    '# Index',
    '',
    ...wiki.pages
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((page) => `- [${page.path}] ${page.title} — ${page.tags.join(', ')} — ${page.sourceIds.length} source(s)`),
  ].join('\n')
}

function extractConcepts(content: string, title: string): string[] {
  const candidates = [
    title,
    ...Array.from(content.matchAll(/\b[A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){0,3}\b/g)).map((m) => m[0]),
    ...tokenize(content).filter((token) => token.length > 6),
  ]
  return unique(candidates.map(titleCase).filter((item) => item.length > 2)).slice(0, 8)
}

function summarize(content: string): string {
  const firstSentences = content
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean)
    .slice(0, 10)
    .join(' ')
  return firstSentences.slice(0, 700) || content.slice(0, 700)
}

function tokenize(value: string): string[] {
  return value.toLowerCase().match(/\b[a-z][a-z0-9-]{3,}\b/g) ?? []
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled'
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

function cloneWiki(wiki: LLMWiki): LLMWiki {
  return {
    sources: wiki.sources.map((source) => ({ ...source })),
    pages: wiki.pages.map((page) => ({ ...page, sourceIds: [...page.sourceIds], tags: [...page.tags] })),
    indexMarkdown: wiki.indexMarkdown,
    logMarkdown: wiki.logMarkdown,
    schemaMarkdown: wiki.schemaMarkdown,
    version: wiki.version,
    lastUpdated: wiki.lastUpdated,
  }
}
