import Anthropic from '@anthropic-ai/sdk';
import type { LlmMessage, LlmResponse, ChatTurnMessage, ToolDefinitionForModel, ChatCallResult } from '../types.js';

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

function toAnthropicMessage(m: ChatTurnMessage): Anthropic.Messages.MessageParam {
  if (m.role === 'tool') {
    return {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: m.toolCallId!, content: m.content }],
    };
  }
  if (m.role === 'assistant' && m.toolCalls?.length) {
    const content: Anthropic.Messages.ContentBlockParam[] = [];
    if (m.content) content.push({ type: 'text', text: m.content });
    for (const call of m.toolCalls) {
      content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args as Record<string, unknown> });
    }
    return { role: 'assistant', content };
  }
  return { role: m.role, content: m.content };
}

/**
 * Multi-turn chat with tool use — distinct from callAnthropic above, which
 * stays single-shot for the pipeline stages. See engineering-doc.md §3.
 */
export async function callAnthropicChat(
  model: string,
  system: string,
  history: ChatTurnMessage[],
  tools?: ToolDefinitionForModel[],
): Promise<ChatCallResult> {
  const response = await client().messages.create({
    model,
    max_tokens: 4096,
    system,
    messages: history.map(toAnthropicMessage),
    tools: tools?.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Messages.Tool.InputSchema })),
  });

  const toolCalls = response.content
    .filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use')
    .map(b => ({ id: b.id, name: b.name, args: b.input }));

  const text = response.content.find((b): b is Anthropic.Messages.TextBlock => b.type === 'text');

  return {
    message: {
      role: 'assistant',
      content: text?.text ?? '',
      toolCalls: toolCalls.length ? toolCalls : undefined,
    },
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    model: response.model,
  };
}
