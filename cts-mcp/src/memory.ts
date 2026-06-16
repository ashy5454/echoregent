import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

type WikiSource = {
  id: string;
  title: string;
  content: string;
  addedAt: string;
};

type WikiPage = {
  path: string;
  title: string;
  markdown: string;
  updatedAt: string;
  sourceIds: string[];
  tags: string[];
};

type ScoredPage = {
  page: WikiPage;
  sessionId: string;
  score: number;
};

type LLMWiki = {
  sources: WikiSource[];
  pages: WikiPage[];
  indexMarkdown: string;
  logMarkdown: string;
  schemaMarkdown: string;
  version: number;
  lastUpdated: string;
};

const rootDir = dirname(__dirname);
const memoryDir = join(rootDir, "data", "cts-memory");

export async function rememberSource(input: {
  sessionId?: string;
  title?: string;
  content: string;
  domain?: string;
  intent?: string;
}): Promise<{ wiki: LLMWiki; sourceId: string; path: string }> {
  const sessionId = sanitizeSessionId(input.sessionId ?? "codex");
  const path = memoryPath(sessionId);
  const wiki = await loadWiki(sessionId);
  const now = new Date().toISOString();
  const source: WikiSource = {
    id: `src-${Date.now().toString(36)}`,
    title: compact(input.title || `Codex memory ${wiki.sources.length + 1}`, 120),
    content: input.content.trim(),
    addedAt: now,
  };

  if (!source.content) {
    throw new Error("content is required");
  }

  wiki.sources.push(source);
  const tags = unique(["memory", input.domain ?? "general", input.intent ?? "information_seeking"]);

  upsertPage(wiki, {
    path: "overview.md",
    title: "Overview",
    markdown: [
      "# Overview",
      "",
      `Latest source: ${source.title}`,
      "",
      "## Current synthesis",
      summarize(source.content),
      "",
      "## Source trail",
      ...wiki.sources.slice(-8).map((item) => `- ${item.id}: ${item.title}`),
    ].join("\n"),
    updatedAt: now,
    sourceIds: unique([...(wiki.pages.find((page) => page.path === "overview.md")?.sourceIds ?? []), source.id]),
    tags,
  });

  for (const concept of extractConcepts(`${source.title}\n${source.content}`).slice(0, 5)) {
    const conceptPath = `concepts/${slug(concept)}.md`;
    upsertPage(wiki, {
      path: conceptPath,
      title: concept,
      markdown: [
        `# ${concept}`,
        "",
        "## Notes",
        summarize(source.content),
        "",
        `Sources: ${source.id}`,
      ].join("\n"),
      updatedAt: now,
      sourceIds: unique([...(wiki.pages.find((page) => page.path === conceptPath)?.sourceIds ?? []), source.id]),
      tags,
    });
  }

  wiki.indexMarkdown = buildIndex(wiki);
  wiki.logMarkdown += `\n## [${now.slice(0, 10)}] ingest | ${source.title}\n- Source: ${source.id}\n- Session: ${sessionId}\n`;
  wiki.version += 1;
  wiki.lastUpdated = now;

  await saveWiki(sessionId, wiki);
  return { wiki, sourceId: source.id, path };
}

export async function recallContext(input: {
  sessionId?: string;
  query: string;
  maxPages?: number;
}): Promise<{ wiki: LLMWiki; context: string; pages: WikiPage[]; path: string; sessions: string[] }> {
  const requestedSessionId = input.sessionId ? sanitizeSessionId(input.sessionId) : null;
  const sessionIds = requestedSessionId ? [requestedSessionId] : await listSessionIds();
  const path = requestedSessionId ? memoryPath(requestedSessionId) : memoryDir;
  const query = input.query.trim();
  const maxPages = Math.max(1, Math.min(8, input.maxPages ?? 4));

  if (!query) {
    throw new Error("query is required");
  }

  const wikis = await Promise.all(sessionIds.map(async (sessionId) => ({ sessionId, wiki: await loadWiki(sessionId) })));
  const queryTokens = new Set(tokenize(query));
  const scoredPages: ScoredPage[] = wikis.flatMap(({ sessionId, wiki }) =>
    wiki.pages.map((page) => {
      const haystack = `${sessionId} ${page.path} ${page.title} ${page.tags.join(" ")} ${page.markdown}`.toLowerCase();
      const score =
        page.tags.filter((tag) => query.toLowerCase().includes(tag.toLowerCase())).length * 3 +
        [...queryTokens].filter((token) => haystack.includes(token)).length;
      return { page, sessionId, score };
    }),
  );

  const matched = scoredPages
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.page.updatedAt.localeCompare(a.page.updatedAt))
    .slice(0, maxPages);

  const pages = matched.map(({ page }) => page);

  const context = pages.length
    ? [
        "CTS LLM Wiki context:",
        ...matched.map(({ page, sessionId }) => [`## ${sessionId}/${page.path}`, page.markdown.slice(0, 1200)].join("\n")),
      ].join("\n\n")
    : "CTS LLM Wiki context: no relevant pages found.";

  return { wiki: mergeWikis(wikis.map(({ wiki }) => wiki)), context, pages, path, sessions: sessionIds };
}

async function loadWiki(sessionId: string): Promise<LLMWiki> {
  try {
    return JSON.parse(await readFile(memoryPath(sessionId), "utf8")) as LLMWiki;
  } catch {
    return createEmptyWiki();
  }
}

async function saveWiki(sessionId: string, wiki: LLMWiki): Promise<void> {
  const path = memoryPath(sessionId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(wiki, null, 2)}\n`, "utf8");
}

async function listSessionIds(): Promise<string[]> {
  try {
    const entries = await readdir(memoryDir, { withFileTypes: true });
    const sessions = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => sanitizeSessionId(basename(entry.name, ".json")))
      .filter(Boolean);
    return sessions.length > 0 ? sessions : ["codex"];
  } catch {
    return ["codex"];
  }
}

function mergeWikis(wikis: LLMWiki[]): LLMWiki {
  const merged = createEmptyWiki();
  merged.sources = wikis.flatMap((wiki) => wiki.sources);
  merged.pages = wikis.flatMap((wiki) => wiki.pages);
  merged.version = Math.max(1, ...wikis.map((wiki) => wiki.version));
  merged.lastUpdated = wikis
    .map((wiki) => wiki.lastUpdated)
    .sort()
    .at(-1) ?? merged.lastUpdated;
  merged.indexMarkdown = buildIndex(merged);
  merged.logMarkdown = wikis.map((wiki) => wiki.logMarkdown).join("\n");
  return merged;
}

function createEmptyWiki(): LLMWiki {
  const now = new Date().toISOString();
  return {
    sources: [],
    pages: [],
    indexMarkdown: "# Index\n\nNo pages yet.\n",
    logMarkdown: "# Log\n",
    schemaMarkdown: [
      "# CTS LLM Wiki Schema",
      "",
      "- Raw sources are immutable.",
      "- Wiki pages are generated markdown maintained by CTS.",
      "- index.md catalogs pages by path and summary.",
      "- log.md is append-only and records ingests/queries/lint passes.",
    ].join("\n"),
    version: 1,
    lastUpdated: now,
  };
}

function memoryPath(sessionId: string): string {
  return join(memoryDir, `${sanitizeSessionId(sessionId)}.json`);
}

function sanitizeSessionId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "codex";
}

function upsertPage(wiki: LLMWiki, page: WikiPage): void {
  const index = wiki.pages.findIndex((item) => item.path === page.path);
  if (index === -1) {
    wiki.pages.push(page);
    return;
  }

  const existing = wiki.pages[index];
  wiki.pages[index] = {
    ...page,
    markdown: `${existing.markdown}\n\n---\n\n${page.markdown}`,
    sourceIds: unique([...existing.sourceIds, ...page.sourceIds]),
    tags: unique([...existing.tags, ...page.tags]),
  };
}

function buildIndex(wiki: LLMWiki): string {
  return [
    "# Index",
    "",
    ...wiki.pages
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((page) => `- [${page.path}] ${page.title} - ${page.tags.join(", ")} - ${page.sourceIds.length} source(s)`),
  ].join("\n");
}

function extractConcepts(content: string): string[] {
  const named = Array.from(content.matchAll(/\b[A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){0,3}\b/g)).map((match) => match[0]);
  const important = tokenize(content).filter((token) => token.length > 6);
  return unique([...named, ...important].map(titleCase).filter((item) => item.length > 2));
}

function summarize(content: string): string {
  const firstSentences = content
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .join(" ");
  return firstSentences.slice(0, 900) || content.slice(0, 900);
}

function tokenize(value: string): string[] {
  return value.toLowerCase().match(/\b[a-z][a-z0-9-]{3,}\b/g) ?? [];
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "untitled";
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function compact(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}
