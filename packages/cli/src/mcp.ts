import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { EchoRegent, type MemoryScope } from '@echoregent/core'

const string = { type: 'string' }
const sources = { type: 'array', items: string, minItems: 1 }
export const tools = [
  { name: 'classify', description: 'Evaluate deterministic domain and protected-context policy.', inputSchema: { type: 'object', properties: { text: string }, required: ['text'] } },
  { name: 'compress', description: 'Explicitly compress repeated log lines. Protected text is preserved. This does not intercept other agent requests.', inputSchema: { type: 'object', properties: { text: string }, required: ['text'] } },
  { name: 'remember', description: 'Store a cited fact in this server project/session scope. Memory must be enabled explicitly.', inputSchema: { type: 'object', properties: { content: string, sources, context: string }, required: ['content', 'sources'] } },
  { name: 'recall', description: 'Find cited facts only in this server project/session scope.', inputSchema: { type: 'object', properties: { query: string, context: string }, required: ['query'] } },
  { name: 'update', description: 'Replace a fact and citations in this server scope.', inputSchema: { type: 'object', properties: { id: string, content: string, sources, context: string }, required: ['id', 'content', 'sources'] } },
  { name: 'forget', description: 'Delete one fact in this server scope.', inputSchema: { type: 'object', properties: { id: string }, required: ['id'] } },
  { name: 'purge', description: 'Delete all facts in this server scope.', inputSchema: { type: 'object', properties: {} } },
]

export async function callTool(engine: EchoRegent, scope: MemoryScope, name: string, args: Record<string, any>) {
  try {
    let result: unknown
    if (name === 'classify' || name === 'compress') {
      if (typeof args.text !== 'string') throw new Error('text must be a string')
      result = name === 'classify' ? engine.classify(args.text, scope) : engine.compressText(args.text, scope)
    } else if (name === 'remember') result = await engine.remember(scope, { content: args.content, sources: args.sources }, args.context)
    else if (name === 'recall') {
      if (typeof args.query !== 'string') throw new Error('query must be a string')
      result = await engine.recall(scope, args.query, args.context)
    } else if (name === 'update') result = await engine.update(scope, args.id, { content: args.content, sources: args.sources }, args.context)
    else if (name === 'forget') result = { deleted: await engine.forget(scope, args.id) }
    else if (name === 'purge') result = { deleted: await engine.purge(scope) }
    else throw new Error(`Unknown tool: ${name}`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  } catch (error) { return { content: [{ type: 'text' as const, text: (error as Error).message }], isError: true } }
}

export function createMcpServer(engine: EchoRegent, scope: MemoryScope) {
  const server = new Server({ name: 'echoregent', version: '0.4.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => callTool(engine, scope, request.params.name, request.params.arguments ?? {}))
  return server
}

export async function runMcp(engine: EchoRegent, scope: MemoryScope) {
  const server = createMcpServer(engine, scope)
  await server.connect(new StdioServerTransport())
  return server
}
