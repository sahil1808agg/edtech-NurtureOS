import Anthropic from '@anthropic-ai/sdk';
import type { LlmMessage, LlmResponse } from '../types.js';

let _client: Anthropic | null = null;

function client(): Anthropic {
  _client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

export async function callAnthropic(model: string, msg: LlmMessage): Promise<LlmResponse> {
  const userContent: Anthropic.Messages.ContentBlockParam[] = [];

  if (msg.pdfBuffer) {
    userContent.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: msg.pdfBuffer.toString('base64'),
      },
    } as Anthropic.Messages.ContentBlockParam);
  }

  for (const img of msg.images ?? []) {
    userContent.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: img },
    });
  }

  userContent.push({ type: 'text', text: msg.user });

  const response = await client().messages.create({
    model,
    max_tokens: 4096,
    system: msg.system,
    messages: [{ role: 'user', content: userContent }],
  });

  const text = response.content.find((b): b is Anthropic.Messages.TextBlock => b.type === 'text');

  return {
    content: text?.text ?? '',
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    model: response.model,
  };
}
