import { encodeChat } from 'gpt-tokenizer'
const messages=[{role:'user',content:'Hello'},{role:'assistant',content:'Hi'},{role:'system',content:'Be brief'}]
console.log(messages.map(m=>encodeChat([m],'gpt-4o').length),encodeChat(messages,'gpt-4o').length)
console.log(encodeChat([], 'gpt-4o').length)
