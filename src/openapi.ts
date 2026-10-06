/** Minimal, versioned OpenAPI document for the stable public API surface. */
export function getOpenApiDocument(origin: string): Record<string, unknown> {
  const bearer = [{ bearerAuth: [] }]
  return {
    openapi: '3.1.0',
    info: {
      title: 'EchoRegent Context API',
      version: '0.5.0',
      description: 'Policy-governed context planning, compression, and source-cited memory for AI agents.',
    },
    servers: [{ url: origin }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      schemas: {
        Message: { type: 'object', required: ['role', 'content'], properties: { role: { enum: ['user', 'assistant'] }, content: { type: 'string' } } },
        ContextPolicy: {
          type: 'object',
          properties: {
            version: { type: 'string' },
            protectedDomains: { type: 'array', items: { type: 'string' } },
            protectedRisks: { type: 'array', items: { type: 'string' } },
            defaultRetentionDays: { type: 'integer', minimum: 1, maximum: 3650 },
          },
        },
      },
    },
    paths: {
      '/health': { get: { summary: 'Liveness and model health' } },
      '/ready': { get: { summary: 'Readiness check for model-dependent deployment' } },
      '/api/context-plan': {
        post: {
          security: bearer,
          summary: 'Return a policy decision and context strategy without an LLM call',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['message'], properties: { message: { type: 'string' }, history: { type: 'array', items: { $ref: '#/components/schemas/Message' } }, provider: { type: 'string' } } } } },
          responses: { '200': { description: 'Routing frame and context plan' } },
        },
      },
      '/api/policy': {
        get: { security: bearer, summary: 'Read the authenticated workspace context policy', responses: { '200': { description: 'Context policy' } } },
        put: { security: bearer, summary: 'Replace the authenticated workspace context policy', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ContextPolicy' } } } }, responses: { '200': { description: 'Resolved context policy' } } },
      },
      '/compress': { post: { security: bearer, summary: 'Classify and safely compress history', responses: { '200': { description: 'Compressed history and context plan' } } } },
      '/api/evaluations/context': { post: { security: bearer, summary: 'Measure critical-context preservation for a compression decision', responses: { '200': { description: 'Compression and deterministic quality report' } } } },
      '/api/chat': { post: { security: bearer, summary: 'Run context planning and an optional provider call', responses: { '200': { description: 'Response, policy, and cited memory state' } } } },
      '/api/memory/facts': { get: { security: bearer, summary: 'Retrieve current source-cited memory facts', responses: { '200': { description: 'Current matching facts' } } } },
      '/api/memory/purge': { post: { security: bearer, summary: 'Permanently remove expired memory according to its retention policy', responses: { '200': { description: 'Removed source, page, and fact counts' } } } },
      '/api/traces': { get: { security: bearer, summary: 'Retrieve privacy-safe context-decision traces', responses: { '200': { description: 'Recent traces' } } } },
      '/v1/chat/completions': { post: { security: bearer, summary: 'OpenAI-compatible context-aware proxy', responses: { '200': { description: 'Provider-compatible response with CTS headers' } } } },
    },
  }
}
