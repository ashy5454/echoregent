import { it, expect } from 'vitest'
import { encodeChat } from 'gpt-tokenizer'
import { countChatTokens } from '../../src/cts-core/tokenizer'
import type { Message } from '../../src/cts-core/types'

it('counts mixed roles and mutated content exactly across reused histories', () => {
  const messages: Message[]=[{role:'user',content:'Hello 👋'},{role:'assistant',content:'Here is the answer.'},{role:'system',content:'Be brief.'}]
  expect(countChatTokens(messages)).toBe(encodeChat(messages,'gpt-4o').length)
  messages[0].content='A longer question with PostgreSQL connection timeout 503.'
  expect(countChatTokens(messages)).toBe(encodeChat(messages,'gpt-4o').length)
  expect(countChatTokens([])).toBe(0)
})
