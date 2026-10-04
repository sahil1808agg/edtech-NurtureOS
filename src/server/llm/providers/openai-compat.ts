import OpenAI from 'openai';
import type { LlmMessage, LlmResponse, ChatTurnMessage, ToolDefinitionForModel, ChatCallResult } from '../types.js';

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

function toOpenAIMessages(system: string, history: ChatTurnMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: 'system', content: system }];

  for (const m of history) {
    if (m.role === 'tool') {
      messages.push({ role: 'tool', tool_call_id: m.toolCallId!, content: m.content });
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      messages.push({
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map(call => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.args) },
        })),
      });
    } else {
      messages.push({ role: m.role, content: m.content });
    }
  }

  return messages;
}

/**
 * Multi-turn chat with tool use, via the OpenAI-compatible function-calling
 * shape — standard across openai/grok/kimi, but unverified against the
 * latter two's actual implementations. Verify before pointing
 * LLM_CHAT_PROVIDER at grok/kimi — see
 * docs/engineering/engineering-doc.md §10 open item 1.
 */
export async function callOpenAICompatChat(
  provider: CompatProvider,
  model: string,
  system: string,
  history: ChatTurnMessage[],
  tools?: ToolDefinitionForModel[],
): Promise<ChatCallResult> {
  const response = await client(provider).chat.completions.create({
    model,
    messages: toOpenAIMessages(system, history),
    tools: tools?.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown> } })),
  });

  const message = response.choices[0]?.message;
  const toolCalls = (message?.tool_calls ?? [])
    .filter((c): c is OpenAI.Chat.ChatCompletionMessageFunctionToolCall => c.type === 'function')
    .map(c => ({ id: c.id, name: c.function.name, args: JSON.parse(c.function.arguments || '{}') }));

  return {
    message: {
      role: 'assistant',
      content: message?.content ?? '',
      toolCalls: toolCalls.length ? toolCalls : undefined,
    },
    inputTokens: response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
    model: response.model,
  };
}
