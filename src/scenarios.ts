import type { Message } from './cts-core'

export interface Scenario {
  id: string
  name: string
  description: string
  message: string
  history: Message[]
}

export const scenarios: Scenario[] = [
  {
    id: 'coding-debug',
    name: 'Coding flow',
    description: 'Architecture request into generation, then debugging.',
    message: 'This auth login function throws a 401 every third request. Why is it failing?',
    history: [
      { role: 'user', content: 'Help me build an auth system for a small SaaS app.' },
      { role: 'assistant', content: 'Use email/password auth, JWT sessions, and refresh tokens.' },
      { role: 'user', content: 'Now write the login function in TypeScript.' },
      { role: 'assistant', content: 'Here is a login function using bcrypt and signed JWTs.' },
    ],
  },
  {
    id: 'support-refund',
    name: 'Customer support',
    description: 'Missing order, escalation, refund/resolution seeking.',
    message: "My order still hasn't arrived after 2 weeks. I want a refund now.",
    history: [
      { role: 'user', content: "My order hasn't arrived." },
      { role: 'assistant', content: 'I can help check the delivery status.' },
      { role: 'user', content: 'The tracking has not moved for days.' },
    ],
  },
  {
    id: 'sales-objection',
    name: 'Sales flow',
    description: 'Product info into comparison and objection handling.',
    message: "I'm not sure yet. Your pricing seems higher than the competitor.",
    history: [
      { role: 'user', content: 'Tell me about your product for support teams.' },
      { role: 'assistant', content: 'It helps teams resolve tickets faster with AI routing.' },
      { role: 'user', content: 'How does it compare to Zendesk?' },
    ],
  },
  {
    id: 'legal-caution',
    name: 'Legal document',
    description: 'Contract summary into legal caution and comparison.',
    message: 'Is this non-compete clause enforceable compared to standard terms?',
    history: [
      { role: 'user', content: 'Summarize this contract for me.' },
      { role: 'assistant', content: 'The contract includes payment, confidentiality, and non-compete clauses.' },
    ],
  },
  {
    id: 'medical-decision',
    name: 'Medical caution',
    description: 'Symptom report into escalation signal and decision support.',
    message: 'I have had a headache and fever for 3 days. Should I see a doctor?',
    history: [
      { role: 'user', content: 'I have a headache.' },
      { role: 'assistant', content: 'How long has it been happening and how severe is it?' },
    ],
  },
  {
    id: 'general-summary',
    name: 'General assistant',
    description: 'Summary, planning, comparison, and correction style.',
    message: 'Summarize the key points and correct anything that sounds unclear.',
    history: [
      { role: 'user', content: 'I wrote a rough launch plan for next week.' },
      { role: 'assistant', content: 'Share it and I can help tighten it.' },
      { role: 'user', content: 'We launch, post, email users, maybe compare channels later.' },
    ],
  },
]

