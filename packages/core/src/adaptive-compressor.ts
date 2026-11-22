/**
 * EchoRegent Continual Learning Compression Engine (Workstream 2)
 *
 * Implements online, local synaptic plasticity (Local Delta Rule / Rescorla-Wagner)
 * over structural pattern signatures. Automatically promotes regret-triggering
 * patterns to protected status without backpropagation or extra LLM calls.
 */

import { compressLogs } from './compression.js'
import { smallerText } from './token-count.js'

export interface AdaptiveCompressorOptions {
  /** Learning rate η for utility update (default: 0.35) */
  learningRate?: number
  /** Utility threshold θ below which patterns are protected (default: 0.45) */
  protectionThreshold?: number
  /** Default initial weight for unseen patterns (default: 1.0) */
  initialWeight?: number
  /** Minimum consecutive identical lines to compact into repeat marker (default: 4) */
  minRepeatCount?: number
}

export interface AdaptiveCompressorState {
  version: number
  learningRate: number
  protectionThreshold: number
  weights: Record<string, number>
  protectedSignatures: string[]
  stats?: {
    totalTurns: number
    regretTurns: number
    survivalTurns: number
  }
}

export interface ToolCallItem {
  name?: string
  args?: any
  command?: string
  path?: string
  [key: string]: any
}

export interface TurnObservation {
  signatures?: string[]
  userPrompt?: string
  toolCalls?: ToolCallItem[]
  previousToolCalls?: ToolCallItem[]
  regretDetected?: boolean
  reward?: number
  target?: number
}

const REGRET_PROMPT_PATTERNS = [
  /\bshow (?:full|all)\b/i,
  /\bmissed line\b/i,
  /\btruncated\b/i,
  /\buncompressed\b/i,
  /\bmissing (?:output|logs?)\b/i,
  /\bfull logs?\b/i,
  /\bshow everything\b/i,
  /\bdid not see\b/i,
  /\bwhere is the (?:error|rest|output)\b/i,
  /\bprint the whole\b/i,
]

/**
 * Normalizes dynamic tokens (timestamps, hex addresses, numbers) into
 * invariant structural signatures.
 */
export function extractSignature(line: string): string {
  let s = line

  // 1. Timestamps: ISO-8601, bracketed timestamps, and time-of-day
  s = s.replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<TS>')
  s = s.replace(/\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/g, '<TS>')

  // 2. Hex addresses, UUIDs, and git commit hashes
  s = s.replace(/\b0x[0-9a-fA-F]+\b/g, '<HEX>')
  s = s.replace(/\b[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}\b/g, '<HEX>')
  s = s.replace(/\b(?=[0-9a-fA-F]*[a-fA-F])(?=[0-9a-fA-F]*\d)[0-9a-fA-F]{7,64}\b/g, '<HEX>')

  // 3. IP address multi-segment numbers: preserve segment structure
  s = s.replace(/\b(\d+)\.(\d+)\.(\d+)\.(\d+)\b/g, '<NUM>.<NUM>.<NUM>.<NUM>')

  // 4. Numbers: signed/unsigned floats, scientific notation, and integers
  s = s.replace(/(?:(?<=[\s,(:=])|^)[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, '<NUM>')

  return s.trim()
}

function normalizeToolCall(call: ToolCallItem): string {
  const name = call.name ?? ''
  const payload = call.args ?? { command: call.command, path: call.path }
  return JSON.stringify({ name, payload })
}

export class AdaptiveCompressionLearner {
  public learningRate: number
  public protectionThreshold: number
  public initialWeight: number
  public minRepeatCount: number

  private weights: Record<string, number> = Object.create(null)
  private protectedSignatures: Set<string> = new Set()
  private lastCompressedSignatures: string[] = []

  private stats = {
    totalTurns: 0,
    regretTurns: 0,
    survivalTurns: 0,
  }

  constructor(options: AdaptiveCompressorOptions = {}) {
    this.learningRate = options.learningRate ?? 0.35
    this.protectionThreshold = options.protectionThreshold ?? 0.45
    this.initialWeight = options.initialWeight ?? 1.0
    this.minRepeatCount = options.minRepeatCount ?? 4
  }

  /**
   * Helper bound method for signature extraction.
   */
  extractSignature(line: string): string {
    return extractSignature(line)
  }

  /**
   * Returns the current utility weight for a pattern signature.
   * Unseen signatures start at initialWeight (default 1.0).
   */
  getUtility(signature: string): number {
    return this.weights[signature] ?? this.initialWeight
  }

  /**
   * Returns true if the signature is protected (cannot be compressed).
   */
  isProtected(signature: string): boolean {
    if (this.protectedSignatures.has(signature)) return true
    const current = this.weights[signature]
    return current !== undefined && current < this.protectionThreshold
  }

  /**
   * Policy check: returns true if the signature is safe to compress.
   */
  shouldCompressSignature(signature: string): boolean {
    return !this.isProtected(signature)
  }

  /**
   * Returns a list of all currently protected signatures.
   */
  getProtectedSignatures(): string[] {
    return Array.from(this.protectedSignatures)
  }

  /**
   * Applies the local delta rule:
   *   w_k <- w_k + η * (target - w_k)
   * If w_k < protectionThreshold, automatically promotes the signature to protected.
   */
  updateUtility(signature: string, target: number): number {
    const current = this.getUtility(signature)
    const updated = current + this.learningRate * (target - current)
    this.weights[signature] = updated

    if (updated < this.protectionThreshold) {
      this.protectedSignatures.add(signature)
    }

    return updated
  }

  /**
   * Updates multiple signatures at once based on an outcome.
   */
  recordFeedback(
    signatures: string[],
    outcome: 'survival' | 'regret' | { reward?: number; target?: number; regretDetected?: boolean }
  ): Record<string, number> {
    let target = 1.0
    if (outcome === 'regret') {
      target = 0.0
    } else if (outcome === 'survival') {
      target = 1.0
    } else if (typeof outcome === 'object') {
      if (outcome.regretDetected === true || outcome.target === 0.0) {
        target = 0.0
      } else if (outcome.reward !== undefined) {
        target = outcome.reward
      } else if (outcome.target !== undefined) {
        target = outcome.target
      }
    }

    const updatedMap: Record<string, number> = {}
    for (const sig of signatures) {
      updatedMap[sig] = this.updateUtility(sig, target)
    }
    return updatedMap
  }

  /**
   * Detects downstream regret from incoming user prompts or repeated tool calls.
   */
  detectRegret(observation: TurnObservation): boolean {
    if (observation.regretDetected !== undefined) {
      return observation.regretDetected
    }

    // 1. User prompt dissatisfaction markers
    if (observation.userPrompt) {
      for (const pattern of REGRET_PROMPT_PATTERNS) {
        if (pattern.test(observation.userPrompt)) {
          return true
        }
      }
    }

    // 2. Immediate tool re-read / re-execution detection
    if (
      Array.isArray(observation.toolCalls) &&
      observation.toolCalls.length > 0 &&
      Array.isArray(observation.previousToolCalls) &&
      observation.previousToolCalls.length > 0
    ) {
      const prevNormalized = new Set(observation.previousToolCalls.map(normalizeToolCall))
      for (const call of observation.toolCalls) {
        if (prevNormalized.has(normalizeToolCall(call))) {
          return true
        }
      }
    }

    return false
  }

  /**
   * Turn t+1 feedback loop observer.
   * Evaluates regret/survival, updates weights, and identifies newly protected signatures.
   */
  observeTurn(observation: TurnObservation): {
    regretDetected: boolean
    updatedWeights: Record<string, number>
    newlyProtected: string[]
  } {
    const regretDetected = this.detectRegret(observation)
    const target = regretDetected ? 0.0 : (observation.reward ?? 1.0)
    const sigsToUpdate = observation.signatures ?? [...this.lastCompressedSignatures]

    const updatedWeights: Record<string, number> = {}
    const newlyProtected: string[] = []

    for (const sig of sigsToUpdate) {
      const wasProtected = this.isProtected(sig)
      const newWeight = this.updateUtility(sig, target)
      updatedWeights[sig] = newWeight

      if (!wasProtected && this.isProtected(sig)) {
        newlyProtected.push(sig)
      }
    }

    this.stats.totalTurns++
    if (regretDetected) {
      this.stats.regretTurns++
    } else {
      this.stats.survivalTurns++
    }

    return { regretDetected, updatedWeights, newlyProtected }
  }

  /**
   * Compresses repetitive text while strictly preserving lines matching
   * learned-protected signatures verbatim.
   */
  compressWithLearnedPolicy(text: string, options?: { minRepeatCount?: number }): string {
    const minRepeats = options?.minRepeatCount ?? this.minRepeatCount
    const newline = text.includes('\r\n') ? '\r\n' : '\n'
    const lines = text.split(newline)
    const output: string[] = []
    const compressedSigs: Set<string> = new Set()

    for (let index = 0; index < lines.length; ) {
      const line = lines[index]
      const sig = extractSignature(line)
      const canCompress = this.shouldCompressSignature(sig)

      if (!canCompress) {
        // Protected line: preserve verbatim without collapsing
        output.push(line)
        index++
        continue
      }

      // Check extent of identical consecutive lines
      let end = index + 1
      while (end < lines.length && lines[end] === line) {
        end++
      }

      const runLength = end - index
      if (runLength >= minRepeats) {
        output.push(line)
        output.push(`[EchoRegent: previous line repeated ${runLength - 1} additional times]`)
        compressedSigs.add(sig)
        index = end
        continue
      }

      // Check contiguous unprotected block with varying numbers/timestamps (e.g. [INFO] ts=1, [INFO] ts=2)
      let blockEnd = index
      while (blockEnd < lines.length && this.shouldCompressSignature(extractSignature(lines[blockEnd]))) {
        blockEnd++
      }
      if (blockEnd - index >= minRepeats) {
        const blockLines = lines.slice(index, blockEnd)
        // Check if any exact consecutive run >= minRepeats exists inside this block
        let hasExactRun = false
        for (let i = 0; i < blockLines.length; ) {
          let j = i + 1
          while (j < blockLines.length && blockLines[j] === blockLines[i]) j++
          if (j - i >= minRepeats) { hasExactRun = true; break }
          i = j
        }
        if (!hasExactRun) {
          const blockText = blockLines.join(newline)
          const templated = compressLogs(blockText)
          if (templated !== blockText && smallerText(blockText, templated)) {
            output.push(templated)
            for (const bl of blockLines) compressedSigs.add(extractSignature(bl))
            index = blockEnd
            continue
          }
        }
      }

      output.push(line)
      for (let r = index + 1; r < end; r++) {
        output.push(lines[r])
      }
      index = end
    }

    this.lastCompressedSignatures = Array.from(compressedSigs)
    return output.join(newline)
  }

  /**
   * Returns signatures that underwent compaction during the most recent compression call.
   */
  getLastCompressedSignatures(): string[] {
    return [...this.lastCompressedSignatures]
  }

  /**
   * Exports full state for cross-session and cross-restart continual learning.
   */
  exportState(): AdaptiveCompressorState {
    return {
      version: 1,
      learningRate: this.learningRate,
      protectionThreshold: this.protectionThreshold,
      weights: { ...this.weights },
      protectedSignatures: Array.from(this.protectedSignatures),
      stats: { ...this.stats },
    }
  }

  /**
   * Restores learned weights, thresholds, and protected signatures from state.
   */
  loadState(state: AdaptiveCompressorState | string): void {
    const parsed: AdaptiveCompressorState = typeof state === 'string' ? JSON.parse(state) : state
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid AdaptiveCompressorState: expected object or JSON string')
    }

    if (parsed.learningRate !== undefined) this.learningRate = parsed.learningRate
    if (parsed.protectionThreshold !== undefined) this.protectionThreshold = parsed.protectionThreshold
    this.weights = { ...(parsed.weights || {}) }
    this.protectedSignatures = new Set(parsed.protectedSignatures || [])

    for (const [sig, weight] of Object.entries(this.weights)) {
      if (weight < this.protectionThreshold) {
        this.protectedSignatures.add(sig)
      }
    }

    if (parsed.stats) {
      this.stats = { ...parsed.stats }
    }
  }
}
