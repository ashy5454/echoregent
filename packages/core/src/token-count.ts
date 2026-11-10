import { GptEncoding } from 'gpt-tokenizer/GptEncoding'
import ranks from 'gpt-tokenizer/bpeRanks/o200k_base'

let tokenizer: GptEncoding | undefined
const ordinaryText = { disallowedSpecial: new Set<string>() }

/** Local estimate only. This private instance never caches pieces of caller text. */
export function textTokens(text: string): number {
  if (!tokenizer) {
    tokenizer = GptEncoding.getEncodingApi('o200k_base', () => ranks)
    tokenizer.setMergeCacheSize(0)
  }
  return tokenizer.countTokens(text, ordinaryText)
}

export function payloadTokens(value: unknown): number {
  return textTokens(JSON.stringify(value))
}

export function smallerText(original: string, candidate: string): boolean {
  return candidate.length < original.length
    && textTokens(candidate) < textTokens(original)
    && payloadTokens(candidate) < payloadTokens(original)
}
