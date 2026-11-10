export type IntentType =
  | 'information_seeking'
  | 'task_execution'
  | 'decision_support'
  | 'comparison'
  | 'summarization'
  | 'generation'
  | 'debugging'
  | 'escalation'
  | 'objection_handling'
  | 'confirmation_seeking'
  | 'exploration'
  | 'correction'

export type ConversationState =
  | 'opening'
  | 'deepening'
  | 'pivoting'
  | 'returning'
  | 'escalating'
  | 'resolving'
  | 'closing'

export type DomainType =
  | 'general'
  | 'coding'
  | 'customer_support'
  | 'sales'
  | 'legal'
  | 'medical'
  | 'education'
  | 'commerce'
  | (string & {})

export type RiskSignal =
  | 'medical_caution'
  | 'legal_caution'
  | 'financial_caution'
  | 'protected_context'
  | 'unsafe_request'
  | 'crisis'

export interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp?: string
}

export interface ExtractedSignals {
  keywords: string[]
  structures: string[]
  urgency: 'low' | 'medium' | 'high'
  affect?: 'neutral' | 'frustrated' | 'distressed' | 'positive'
}

export interface RoutingFrame {
  intent: IntentType
  state: ConversationState
  domain: DomainType
  risk: RiskSignal[]
  signals: ExtractedSignals
  confidence: {
    intent: number
    state: number
    domain: number
    risk: number
  }
}

export interface CompressionResult {
  original: Message[]
  compressed: Message[]
  memoryFrame?: MemoryFrame
  keptReasons: string[]
  droppedCount: number
  originalTokens: number
  compressedTokens: number
  tokensSaved: number
}

export interface MemoryFrame {
  domain: DomainType
  intent: IntentType
  state: ConversationState
  task: string
  userGoal?: string
  entities: string[]
  constraints: string[]
  unresolved: string[]
  risk: RiskSignal[]
}

export interface RouteResult {
  systemPrompt: string
  behavior: string[]
  constraints: string[]
}

export interface CustomDomainPlugin {
  id: string
  label: string
  keywords: string[]
  behavior: string
  constraints: string
}

export interface WikiDocument {
  profile: string[]
  patterns: string[]
  activeContext: string[]
  mistakes: string[]
  behavioralSignals: string[]
  version: number
  lastUpdated: string
}

export interface WikiSource {
  id: string
  title: string
  content: string
  addedAt: string
}

export interface WikiPage {
  path: string
  title: string
  markdown: string
  updatedAt: string
  sourceIds: string[]
  tags: string[]
}

export interface LLMWiki {
  sources: WikiSource[]
  pages: WikiPage[]
  indexMarkdown: string
  logMarkdown: string
  schemaMarkdown: string
  version: number
  lastUpdated: string
}

export interface SourceInput {
  title: string
  content: string
}

export interface CTSResult {
  frame: RoutingFrame
  compression: CompressionResult
  route: RouteResult
  response: string
  processingMs: number
}

export interface CTSInput {
  message: string
  history?: Message[]
  wikiContext?: string
  customDomainPlugins?: CustomDomainPlugin[]
}

export interface LLMResponderInput {
  systemPrompt: string
  compressedHistory: Message[]
  message: string
  frame: RoutingFrame
}

export type LLMResponder = (input: LLMResponderInput) => Promise<string>

export interface CTSAsyncInput extends CTSInput {
  responder?: LLMResponder
}
