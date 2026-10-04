export type ModelTier = 'vision' | 'reasoning' | 'small';
export type Provider = 'anthropic' | 'gemini' | 'openai' | 'grok' | 'kimi';

export interface LlmMessage {
  system: string;
  user: string;
  /** Raw PDF bytes for Anthropic's native PDF document support */
  pdfBuffer?: Buffer;
  /** Base64-encoded PNG images for vision-capable OpenAI-compatible models */
  images?: string[];
}

export interface LlmResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

// ---------- Chat (multi-turn + tool use) ----------
// Separate from LlmMessage/LlmResponse above, which stay single-shot for the
// pipeline stages. See docs/engineering/engineering-doc.md §3.

export interface ChatToolCall {
  id: string;
  name: string;
  args: unknown;
}

export interface ChatTurnMessage {
  role: 'user' | 'assistant' | 'tool';
  /** Empty string is valid for an assistant turn that is only tool calls. */
  content: string;
  /** Present on a role: 'tool' message — which call this is the result of. */
  toolCallId?: string;
  /** Present on a role: 'assistant' message when the model is calling tools instead of replying. */
  toolCalls?: ChatToolCall[];
}

export interface ToolDefinitionForModel {
  name: string;
  description: string;
  /** JSON Schema, derived from the tool's Zod schema via zod-to-json-schema. */
  parameters: object;
}

export interface ChatCallResult {
  message: ChatTurnMessage;
  inputTokens: number;
  outputTokens: number;
  model: string;
}
