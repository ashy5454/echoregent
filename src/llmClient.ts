import type { LLMResponder, LLMResponderInput } from './cts-core/index.js'

export type LiveProvider = 'openai' | 'gemini' | 'anthropic' | 'openrouter'

export interface LiveLLMConfig {
  provider: LiveProvider
  apiKey: string
  model: string
}

export const defaultModels: Record<LiveProvider, string> = {
  openai: 'gpt-4o-mini',
  gemini: 'gemini-1.5-flash',
  anthropic: 'claude-3-5-haiku-20241022',
  openrouter: 'openai/gpt-4o-mini',
}

export function createLiveResponder(config: LiveLLMConfig): LLMResponder {
  return async (input: LLMResponderInput) => {
    const response = await fetch('/api/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: config.provider,
        apiKey: config.apiKey,
        model: config.model,
        systemPrompt: input.systemPrompt,
        compressedHistory: input.compressedHistory,
        message: input.message,
      }),
    })

    const payload = (await response.json()) as { text?: string; error?: string }
    if (!response.ok || !payload.text) {
      throw new Error(payload.error || `Provider returned HTTP ${response.status}`)
    }

    return payload.text
  }
}

