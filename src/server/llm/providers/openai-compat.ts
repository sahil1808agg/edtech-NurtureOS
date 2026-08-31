import OpenAI from 'openai';
import type { LlmMessage, LlmResponse } from '../types.js';

type CompatProvider = 'openai' | 'grok' | 'kimi';

let clients: Partial<Record<CompatProvider, OpenAI>> = {};

function client(provider: CompatProvider): OpenAI {
  if (!clients[provider]) {
    const configs: Record<CompatProvider, ConstructorParameters<typeof OpenAI>[0]> = {
      openai: {
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: process.env.OPENAI_BASE_URL,
      },
      grok: {
        apiKey: process.env.GROK_API_KEY,
        baseURL: process.env.GROK_BASE_URL ?? 'https://api.x.ai/v1',
      },
      kimi: {
        apiKey: process.env.KIMI_API_KEY,
        baseURL: process.env.KIMI_BASE_URL ?? 'https://api.moonshot.cn/v1',
      },
    };
    clients[provider] = new OpenAI(configs[provider]);
  }
  return clients[provider]!;
}

export async function callOpenAICompat(
  provider: CompatProvider,
  model: string,
  msg: LlmMessage,
): Promise<LlmResponse> {
  const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [];

  for (const img of msg.images ?? []) {
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${img}` },
    });
  }

  userContent.push({ type: 'text', text: msg.user });

  const response = await client(provider).chat.completions.create({
    model,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: msg.system },
      { role: 'user', content: userContent },
    ],
  });

  return {
    content: response.choices[0]?.message.content ?? '',
    inputTokens: response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
    model: response.model,
  };
}
