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
