import { describe, expect, it } from 'vitest'
import {
  compactConversationTurns,
  restoreConversationTurns,
} from '../../packages/core/src/conversation-compressor.js'

// Realistic repetitive message text >= 64 characters with enough tokens to guarantee smallerText is true
const SAMPLE_PROMPT_A =
  'Please inspect the database schema, identify redundant foreign key indexes, and provide a migration script with rollback support.'
const SAMPLE_REPLY_A =
  'I have thoroughly inspected the database schema. All indexes have been analyzed, and the redundant indexes have been cataloged with appropriate rollback commands.'
const SAMPLE_PROMPT_B =
  'Can you also analyze the application query patterns, slow queries above 200 milliseconds, and connection pool utilization during peak traffic?'
const SAMPLE_REPLY_B =
  'Here is the complete analysis of application query patterns and slow queries exceeding 200ms along with connection pool recommendations.'

describe('Lossless Conversational Turn Deduplicator & Compactor', () => {
  describe('Exact duplicate older turn compaction and byte-for-byte restoration', () => {
    it('compacts older exact duplicate turns and losslessly restores them byte-for-byte (string content)', () => {
      const items = [
        { role: 'user', content: SAMPLE_PROMPT_A, id: 'turn-0' },
        { role: 'assistant', content: SAMPLE_REPLY_A, id: 'turn-1' },
        // Exact duplicates of turns 0 and 1:
        { role: 'user', content: SAMPLE_PROMPT_A, id: 'turn-2' },
        { role: 'assistant', content: SAMPLE_REPLY_A, id: 'turn-3' },
        { role: 'user', content: SAMPLE_PROMPT_B, id: 'turn-4' },
        { role: 'assistant', content: SAMPLE_REPLY_B, id: 'turn-5' },
        // Last 6 items (keepRecent default = 6):
        { role: 'user', content: 'What about indexing the created_at column?', id: 'turn-6' },
        { role: 'assistant', content: 'The created_at column should use a BRIN or B-tree index depending on write volume.', id: 'turn-7' },
        { role: 'user', content: 'What about partition keys?', id: 'turn-8' },
        { role: 'assistant', content: 'Partition keys should be selected based on query filters, commonly timestamp or tenant ID.', id: 'turn-9' },
        { role: 'user', content: 'Summarize the top recommendations.', id: 'turn-10' },
        { role: 'assistant', content: 'Top recommendations: remove redundant indexes and partition by tenant ID.', id: 'turn-11' },
      ]

      const originalClone = structuredClone(items)
      const result = compactConversationTurns(items)

      expect(result.turnsCompacted).toBe(2)
      expect(result.charactersRemoved).toBeGreaterThan(0)
      expect(result.items.length).toBe(items.length)

      // Turn 2 is a duplicate of turn 0
      expect(result.items[2].content).toBe(
        '[EchoRegent lossless turn-ref v1: exact duplicate of turn #0]'
      )
      expect(result.items[2].id).toBe('turn-2')
      expect(result.items[2].role).toBe('user')

      // Turn 3 is a duplicate of turn 1
      expect(result.items[3].content).toBe(
        '[EchoRegent lossless turn-ref v1: exact duplicate of turn #1]'
      )
      expect(result.items[3].id).toBe('turn-3')
      expect(result.items[3].role).toBe('assistant')

      // Turns 0, 1, 4, 5, 6-11 are untouched
      expect(result.items[0]).toEqual(items[0])
      expect(result.items[1]).toEqual(items[1])
      expect(result.items[4]).toEqual(items[4])
      expect(result.items[5]).toEqual(items[5])
      expect(result.items.slice(6)).toEqual(items.slice(6))

      // Input array was not mutated
      expect(items).toEqual(originalClone)

      // Lossless byte-for-byte restoration
      const restored = restoreConversationTurns(result.items)
      expect(restored).toEqual(originalClone)
    })

    it('compacts older exact duplicate turns with block-array content and restores them byte-for-byte', () => {
      const items = [
        {
          role: 'user',
          id: 'turn-0',
          content: [{ type: 'input_text', text: SAMPLE_PROMPT_A }],
        },
        {
          role: 'assistant',
          id: 'turn-1',
          content: [{ type: 'output_text', text: SAMPLE_REPLY_A }],
        },
        {
          role: 'user',
          id: 'turn-2',
          content: [{ type: 'input_text', text: SAMPLE_PROMPT_A }],
        },
        {
          role: 'assistant',
          id: 'turn-3',
          content: [{ type: 'output_text', text: SAMPLE_REPLY_A }],
        },
        { role: 'user', content: [{ type: 'text', text: SAMPLE_PROMPT_B }] },
        { role: 'assistant', content: [{ type: 'text', text: SAMPLE_REPLY_B }] },
        // 6 recent items:
        { role: 'user', content: [{ type: 'text', text: 'Recent question 1.' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Recent answer 1.' }] },
        { role: 'user', content: [{ type: 'text', text: 'Recent question 2.' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Recent answer 2.' }] },
        { role: 'user', content: [{ type: 'text', text: 'Final question.' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Final answer.' }] },
      ]

      const originalClone = structuredClone(items)
      const result = compactConversationTurns(items)

      expect(result.turnsCompacted).toBe(2)
      expect(result.items[2].content[0].type).toBe('input_text')
      expect(result.items[2].content[0].text).toBe(
        '[EchoRegent lossless turn-ref v1: exact duplicate of turn #0]'
      )
      expect(result.items[3].content[0].type).toBe('output_text')
      expect(result.items[3].content[0].text).toBe(
        '[EchoRegent lossless turn-ref v1: exact duplicate of turn #1]'
      )

      const restored = restoreConversationTurns(result.items)
      expect(restored).toEqual(originalClone)
    })

    it('points multiple duplicate turns directly to firstIdx rather than chaining', () => {
      const items = [
        { role: 'user', content: SAMPLE_PROMPT_A, id: 'turn-0' },
        { role: 'user', content: SAMPLE_PROMPT_A, id: 'turn-1' },
        { role: 'user', content: SAMPLE_PROMPT_A, id: 'turn-2' },
        { role: 'user', content: SAMPLE_PROMPT_A, id: 'turn-3' },
        // 6 recent items:
        { role: 'assistant', content: 'Recent response A.' },
        { role: 'user', content: 'Recent question A.' },
        { role: 'assistant', content: 'Recent response B.' },
        { role: 'user', content: 'Recent question B.' },
        { role: 'assistant', content: 'Recent response C.' },
        { role: 'user', content: 'Latest active user turn.' },
      ]

      const originalClone = structuredClone(items)
      const result = compactConversationTurns(items)

      expect(result.turnsCompacted).toBe(3)
      // Turns 1, 2, 3 must all reference turn #0 directly
      expect(result.items[1].content).toBe(
        '[EchoRegent lossless turn-ref v1: exact duplicate of turn #0]'
      )
      expect(result.items[2].content).toBe(
        '[EchoRegent lossless turn-ref v1: exact duplicate of turn #0]'
      )
      expect(result.items[3].content).toBe(
        '[EchoRegent lossless turn-ref v1: exact duplicate of turn #0]'
      )

      const restored = restoreConversationTurns(result.items)
      expect(restored).toEqual(originalClone)
    })

    it('preserves metadata, ids, and non-content fields through compaction and restoration', () => {
      const items = [
        {
          role: 'user',
          id: 'msg-001',
          name: 'alice',
          metadata: { session: 's1', timestamp: 1700000000 },
          content: SAMPLE_PROMPT_A,
        },
        {
          role: 'user',
          id: 'msg-002',
          name: 'alice',
          metadata: { session: 's1', timestamp: 1700000005, retryCount: 1 },
          content: SAMPLE_PROMPT_A,
        },
        // 6 recent items
        { role: 'assistant', content: 'Answer 1' },
        { role: 'user', content: 'Question 2' },
        { role: 'assistant', content: 'Answer 2' },
        { role: 'user', content: 'Question 3' },
        { role: 'assistant', content: 'Answer 3' },
        { role: 'user', content: 'Question 4' },
      ]

      const originalClone = structuredClone(items)
      const result = compactConversationTurns(items)

      expect(result.turnsCompacted).toBe(1)
      expect(result.items[1].id).toBe('msg-002')
      expect(result.items[1].name).toBe('alice')
      expect(result.items[1].metadata).toEqual({ session: 's1', timestamp: 1700000005, retryCount: 1 })

      const restored = restoreConversationTurns(result.items)
      expect(restored).toEqual(originalClone)
    })

    it('does not compact duplicate texts shorter than 64 characters', () => {
      const shortText = 'Tell me a quick joke about programming.'
      expect(shortText.length).toBeLessThan(64)

      const items = [
        { role: 'user', content: shortText },
        { role: 'assistant', content: 'Why do programmers prefer dark mode? Because light attracts bugs.' },
        { role: 'user', content: shortText },
        // 6 recent items:
        { role: 'assistant', content: 'Another joke.' },
        { role: 'user', content: 'Recent 1' },
        { role: 'assistant', content: 'Recent 2' },
        { role: 'user', content: 'Recent 3' },
        { role: 'assistant', content: 'Recent 4' },
        { role: 'user', content: 'Recent 5' },
      ]

      const result = compactConversationTurns(items)
      expect(result.turnsCompacted).toBe(0)
      expect(result.charactersRemoved).toBe(0)
      expect(result.items).toBe(items)
    })
  })

  describe('Preservation of latest user turn and recent turns (keepRecent)', () => {
    it('never compacts the latest user turn, even if it is an exact duplicate of turn #0', () => {
      const items = [
        { role: 'user', content: SAMPLE_PROMPT_A },
        { role: 'assistant', content: SAMPLE_REPLY_A },
        // Turn 2 is the latest user turn in the entire request!
        { role: 'user', content: SAMPLE_PROMPT_A },
        { role: 'assistant', content: SAMPLE_REPLY_B },
        { role: 'assistant', content: 'Follow-up observation.' },
        { role: 'assistant', content: 'Another observation.' },
        { role: 'assistant', content: 'Yet another observation.' },
        { role: 'assistant', content: 'Final response.' },
      ]

      const originalClone = structuredClone(items)
      const result = compactConversationTurns(items)

      // Turn 2 is the latest user turn; turns prior to latest user turn are turns 0 and 1.
      // Turn 0 is first occurrence, turn 1 is assistant. Neither is a duplicate.
      expect(result.turnsCompacted).toBe(0)
      expect(result.items[2].content).toBe(SAMPLE_PROMPT_A)
      expect(result.items).toBe(items)
      expect(items).toEqual(originalClone)
    })

    it('never compacts turns within the last keepRecent items', () => {
      const items = [
        { role: 'user', content: SAMPLE_PROMPT_A },
        { role: 'assistant', content: SAMPLE_REPLY_A },
        { role: 'user', content: SAMPLE_PROMPT_B },
        { role: 'assistant', content: SAMPLE_REPLY_B },
        // Last 6 items: turn 4 is a duplicate of turn 0, but it is within the last 6 items!
        { role: 'user', content: SAMPLE_PROMPT_A },
        { role: 'assistant', content: SAMPLE_REPLY_A },
        { role: 'user', content: 'What about indexes?' },
        { role: 'assistant', content: 'B-trees are standard.' },
        { role: 'assistant', content: 'Composite indexes can help too.' },
        { role: 'user', content: 'Latest user turn.' },
      ]

      const result = compactConversationTurns(items)
      // Boundary is min(10 - 6, 9) = 4. Items 0..3 are checked.
      // Turn 4 is at index 4, which is in the last 6 items (indices 4..9), so it is not compacted.
      expect(result.turnsCompacted).toBe(0)
      expect(result.items[4].content).toBe(SAMPLE_PROMPT_A)
      expect(result.items[5].content).toBe(SAMPLE_REPLY_A)
    })

    it('respects a custom keepRecent option', () => {
      const items = [
        { role: 'user', content: SAMPLE_PROMPT_A, id: 'turn-0' },
        { role: 'assistant', content: SAMPLE_REPLY_A, id: 'turn-1' },
        { role: 'user', content: SAMPLE_PROMPT_A, id: 'turn-2' },
        { role: 'assistant', content: SAMPLE_REPLY_A, id: 'turn-3' },
        // Only 2 recent items protected with keepRecent: 2
        { role: 'user', content: 'Short question' },
        { role: 'assistant', content: 'Short answer' },
      ]

      const resultWith2 = compactConversationTurns(items, { keepRecent: 2 })
      expect(resultWith2.turnsCompacted).toBe(2)
      expect(resultWith2.items[2].content).toBe(
        '[EchoRegent lossless turn-ref v1: exact duplicate of turn #0]'
      )
      expect(resultWith2.items[3].content).toBe(
        '[EchoRegent lossless turn-ref v1: exact duplicate of turn #1]'
      )

      // With keepRecent: 6, all 6 items are protected
      const resultWith6 = compactConversationTurns(items, { keepRecent: 6 })
      expect(resultWith6.turnsCompacted).toBe(0)
    })

    it('returns items untouched when conversation has fewer items than keepRecent', () => {
      const items = [
        { role: 'user', content: SAMPLE_PROMPT_A },
        { role: 'user', content: SAMPLE_PROMPT_A },
        { role: 'user', content: SAMPLE_PROMPT_A },
      ]

      const result = compactConversationTurns(items) // default keepRecent = 6
      expect(result.turnsCompacted).toBe(0)
      expect(result.charactersRemoved).toBe(0)
      expect(result.items).toBe(items)
    })

    it('handles conversation with no user messages by protecting keepRecent items', () => {
      const items = [
        { role: 'assistant', content: SAMPLE_REPLY_A },
        { role: 'assistant', content: SAMPLE_REPLY_A },
        // 6 recent items:
        { role: 'assistant', content: 'Step 1' },
        { role: 'assistant', content: 'Step 2' },
        { role: 'assistant', content: 'Step 3' },
        { role: 'assistant', content: 'Step 4' },
        { role: 'assistant', content: 'Step 5' },
        { role: 'assistant', content: 'Step 6' },
      ]

      const result = compactConversationTurns(items)
      expect(result.turnsCompacted).toBe(1)
      expect(result.items[1].content).toBe(
        '[EchoRegent lossless turn-ref v1: exact duplicate of turn #0]'
      )
      const restored = restoreConversationTurns(result.items)
      expect(restored).toEqual(items)
    })
  })

  describe('Preservation of fenced code, JSON, tool calls, and cache_control items', () => {
    it('skips items containing backtick fenced code blocks', () => {
      const codeBlock = '```typescript\nfunction optimizeQuery() {\n  return db.select().from("users");\n}\n```\n' + SAMPLE_PROMPT_A
      const items = [
        { role: 'user', content: codeBlock },
        { role: 'assistant', content: SAMPLE_REPLY_A },
        { role: 'user', content: codeBlock }, // duplicate with code block
        { role: 'assistant', content: SAMPLE_REPLY_A }, // duplicate plain text
        // 6 recent items:
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: 'A1' },
        { role: 'user', content: 'Q2' },
        { role: 'assistant', content: 'A2' },
        { role: 'user', content: 'Q3' },
        { role: 'assistant', content: 'A3' },
      ]

      const result = compactConversationTurns(items)
      // Turn 2 has fenced code -> skipped!
      // Turn 3 is plain text duplicate of turn 1 -> compacted!
      expect(result.turnsCompacted).toBe(1)
      expect(result.items[2].content).toBe(codeBlock)
      expect(result.items[3].content).toBe(
        '[EchoRegent lossless turn-ref v1: exact duplicate of turn #1]'
      )
    })

    it('skips items containing tilde fenced code blocks', () => {
      const tildeCode = '~~~bash\npg_dump --clean --if-exists -U postgres mydb > backup.sql\n~~~\n' + SAMPLE_PROMPT_A
      const items = [
        { role: 'user', content: tildeCode },
        { role: 'assistant', content: SAMPLE_REPLY_A },
        { role: 'user', content: tildeCode },
        // 6 recent items:
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: 'A1' },
        { role: 'user', content: 'Q2' },
        { role: 'assistant', content: 'A2' },
        { role: 'user', content: 'Q3' },
        { role: 'assistant', content: 'A3' },
      ]

      const result = compactConversationTurns(items)
      expect(result.turnsCompacted).toBe(0)
      expect(result.items[2].content).toBe(tildeCode)
    })

    it('skips items containing structured JSON objects or JSON arrays', () => {
      const jsonObjectText = JSON.stringify(
        {
          operation: 'migration',
          tables: ['users', 'orders', 'payments'],
          rollbackAllowed: true,
          description: SAMPLE_PROMPT_A,
        },
        null,
        2
      )
      const jsonArrayText = JSON.stringify([
        { index: 'idx_user_email', columns: ['email'] },
        { index: 'idx_user_created', columns: ['created_at'] },
      ])

      const items = [
        { role: 'user', content: jsonObjectText },
        { role: 'assistant', content: jsonArrayText },
        { role: 'user', content: jsonObjectText },
        { role: 'assistant', content: jsonArrayText },
        // 6 recent items:
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: 'A1' },
        { role: 'user', content: 'Q2' },
        { role: 'assistant', content: 'A2' },
        { role: 'user', content: 'Q3' },
        { role: 'assistant', content: 'A3' },
      ]

      const result = compactConversationTurns(items)
      expect(result.turnsCompacted).toBe(0)
      expect(result.items[2].content).toBe(jsonObjectText)
      expect(result.items[3].content).toBe(jsonArrayText)
    })

    it('skips items containing tool_calls or function_call', () => {
      const items = [
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'query_db', arguments: '{}' } },
          ],
        },
        { role: 'user', content: SAMPLE_PROMPT_A },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call_2', type: 'function', function: { name: 'query_db', arguments: '{}' } },
          ],
        },
        // 6 recent items:
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: 'A1' },
        { role: 'user', content: 'Q2' },
        { role: 'assistant', content: 'A2' },
        { role: 'user', content: 'Q3' },
        { role: 'assistant', content: 'A3' },
      ]

      const result = compactConversationTurns(items)
      expect(result.turnsCompacted).toBe(0)
    })

    it('skips items with top-level or block-level cache_control', () => {
      const items = [
        {
          role: 'user',
          content: SAMPLE_PROMPT_A,
          cache_control: { type: 'ephemeral' },
        },
        {
          role: 'assistant',
          content: SAMPLE_REPLY_A,
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: SAMPLE_PROMPT_A, cache_control: { type: 'ephemeral' } }],
        },
        // 6 recent items:
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: 'A1' },
        { role: 'user', content: 'Q2' },
        { role: 'assistant', content: 'A2' },
        { role: 'user', content: 'Q3' },
        { role: 'assistant', content: 'A3' },
      ]

      const result = compactConversationTurns(items)
      // Both turn 0 and turn 2 have cache_control -> preserved!
      expect(result.turnsCompacted).toBe(0)
    })

    it('skips items with annotations and multimodal content', () => {
      const items = [
        {
          role: 'assistant',
          content: SAMPLE_REPLY_A,
          annotations: [{ type: 'file_citation', file_id: 'file-1' }],
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: SAMPLE_REPLY_A, annotations: [{ type: 'citation' }] }],
        },
        {
          role: 'user',
          content: [
            { type: 'input_text', text: SAMPLE_PROMPT_A },
            { type: 'input_image', image_url: 'data:image/png;base64,iVBORw==' },
          ],
        },
        // 6 recent items:
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: 'A1' },
        { role: 'user', content: 'Q2' },
        { role: 'assistant', content: 'A2' },
        { role: 'user', content: 'Q3' },
        { role: 'assistant', content: 'A3' },
      ]

      const result = compactConversationTurns(items)
      expect(result.turnsCompacted).toBe(0)
    })
  })

  describe('Safe pass-through on malformed and out-of-range reference markers', () => {
    it.each([
      '[EchoRegent lossless turn-ref v1: exact duplicate of turn #abc]',
      '[EchoRegent lossless turn-ref v1: exact duplicate of turn #]',
      '[EchoRegent lossless turn-ref v1: exact duplicate of turn #-1]',
      '[EchoRegent lossless turn-ref v2: exact duplicate of turn #0]',
      'Prefix text [EchoRegent lossless turn-ref v1: exact duplicate of turn #0]',
      '[EchoRegent lossless turn-ref v1: exact duplicate of turn #0] trailing text',
      '[EchoRegent lossless turn-ref v1: exact duplicate of turn #0]\n',
    ])('leaves malformed reference marker untouched: %j', (malformed) => {
      const items = [
        { role: 'user', content: SAMPLE_PROMPT_A },
        { role: 'assistant', content: malformed },
      ]

      const restored = restoreConversationTurns(items)
      expect(restored[1].content).toBe(malformed)
      expect(restored).toBe(items)
    })

    it('leaves out-of-range turn references untouched', () => {
      const items = [
        { role: 'user', content: SAMPLE_PROMPT_A },
        {
          role: 'assistant',
          content: '[EchoRegent lossless turn-ref v1: exact duplicate of turn #999]',
        },
      ]

      const restored = restoreConversationTurns(items)
      expect(restored[1].content).toBe(
        '[EchoRegent lossless turn-ref v1: exact duplicate of turn #999]'
      )
      expect(restored).toBe(items)
    })

    it('handles self-references and cyclical references safely without infinite recursion', () => {
      const items = [
        // Self-reference
        {
          role: 'user',
          content: '[EchoRegent lossless turn-ref v1: exact duplicate of turn #0]',
        },
        // Cyclical reference: turn 1 -> turn 2, turn 2 -> turn 1
        {
          role: 'assistant',
          content: '[EchoRegent lossless turn-ref v1: exact duplicate of turn #2]',
        },
        {
          role: 'user',
          content: '[EchoRegent lossless turn-ref v1: exact duplicate of turn #1]',
        },
      ]

      const restored = restoreConversationTurns(items)
      expect(restored[0].content).toBe(
        '[EchoRegent lossless turn-ref v1: exact duplicate of turn #0]'
      )
      expect(restored[1].content).toBe(
        '[EchoRegent lossless turn-ref v1: exact duplicate of turn #2]'
      )
      expect(restored[2].content).toBe(
        '[EchoRegent lossless turn-ref v1: exact duplicate of turn #1]'
      )
      expect(restored).toBe(items)
    })

    it('leaves references pointing to non-text or null items untouched', () => {
      const items = [
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'f', arguments: '{}' } }],
        },
        {
          role: 'user',
          content: '[EchoRegent lossless turn-ref v1: exact duplicate of turn #0]',
        },
      ]

      const restored = restoreConversationTurns(items)
      expect(restored[1].content).toBe(
        '[EchoRegent lossless turn-ref v1: exact duplicate of turn #0]'
      )
      expect(restored).toBe(items)
    })

    it('resolves chained references safely when present', () => {
      const items = [
        { role: 'user', content: SAMPLE_PROMPT_A },
        {
          role: 'assistant',
          content: '[EchoRegent lossless turn-ref v1: exact duplicate of turn #0]',
        },
        {
          role: 'user',
          content: '[EchoRegent lossless turn-ref v1: exact duplicate of turn #1]',
        },
      ]

      const restored = restoreConversationTurns(items)
      expect(restored[1].content).toBe(SAMPLE_PROMPT_A)
      expect(restored[2].content).toBe(SAMPLE_PROMPT_A)
    })
  })

  describe('Edge cases and idempotency', () => {
    it('handles empty or non-array inputs cleanly', () => {
      expect(compactConversationTurns([])).toEqual({
        items: [],
        charactersRemoved: 0,
        turnsCompacted: 0,
      })
      expect(compactConversationTurns(null as any)).toEqual({
        items: [],
        charactersRemoved: 0,
        turnsCompacted: 0,
      })
      expect(compactConversationTurns(undefined as any)).toEqual({
        items: [],
        charactersRemoved: 0,
        turnsCompacted: 0,
      })
      expect(restoreConversationTurns([])).toEqual([])
      expect(restoreConversationTurns(null as any)).toBe(null)
      expect(restoreConversationTurns(undefined as any)).toBe(undefined)
    })

    it('does not compact turns that already contain reserved EchoRegent lossless markers', () => {
      const items = [
        { role: 'user', content: SAMPLE_PROMPT_A },
        {
          role: 'user',
          content: '[EchoRegent lossless turn-ref v1: exact duplicate of turn #0]',
        },
        // 6 recent items:
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: 'A1' },
        { role: 'user', content: 'Q2' },
        { role: 'assistant', content: 'A2' },
        { role: 'user', content: 'Q3' },
        { role: 'assistant', content: 'A3' },
      ]

      const result = compactConversationTurns(items)
      expect(result.turnsCompacted).toBe(0)
    })

    it('is idempotent: restoring already restored items returns the same items', () => {
      const items = [
        { role: 'user', content: SAMPLE_PROMPT_A },
        { role: 'assistant', content: SAMPLE_REPLY_A },
        { role: 'user', content: SAMPLE_PROMPT_A },
        { role: 'assistant', content: SAMPLE_REPLY_A },
        // 6 recent items:
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: 'A1' },
        { role: 'user', content: 'Q2' },
        { role: 'assistant', content: 'A2' },
        { role: 'user', content: 'Q3' },
        { role: 'assistant', content: 'A3' },
      ]

      const compacted = compactConversationTurns(items)
      const restoredFirst = restoreConversationTurns(compacted.items)
      const restoredSecond = restoreConversationTurns(restoredFirst)

      expect(restoredFirst).toEqual(items)
      expect(restoredSecond).toBe(restoredFirst)
    })
  })
})
