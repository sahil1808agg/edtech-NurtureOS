import { GoogleGenAI, createPartFromBase64, ThinkingLevel, Type, type Part, type Content, type Schema, type GenerateContentConfig } from '@google/genai';
import type { LlmMessage, LlmResponse, ChatTurnMessage, ToolDefinitionForModel, ChatCallResult } from '../types.js';

let _client: GoogleGenAI | null = null;

function client(): GoogleGenAI {
  _client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return _client;
}

// thinkingLevel is a stage-level override (LLM_THINKING_<STAGE>, e.g. "high"); left
// unset it falls through to the model's own default thinking level.
export async function callGemini(model: string, msg: LlmMessage, thinkingLevel?: string): Promise<LlmResponse> {
  const parts: Part[] = [];

  if (msg.pdfBuffer) {
    parts.push(createPartFromBase64(msg.pdfBuffer.toString('base64'), 'application/pdf'));
  }

  for (const img of msg.images ?? []) {
    parts.push(createPartFromBase64(img, 'image/png'));
  }

  parts.push({ text: msg.user });

  const config: GenerateContentConfig = {
    systemInstruction: msg.system,
    responseMimeType: 'application/json',
  };

  if (thinkingLevel) {
    const level = ThinkingLevel[thinkingLevel.toUpperCase() as keyof typeof ThinkingLevel];
    if (!level) throw new Error(`Unknown Gemini thinking level: "${thinkingLevel}"`);
    config.thinkingConfig = { thinkingLevel: level };
  }

  const response = await client().models.generateContent({ model, contents: parts, config });

  return {
    content: response.text ?? '',
    inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    model: response.modelVersion ?? model,
  };
}

// zod-to-json-schema emits standard lowercase JSON Schema; Gemini's Schema
// type wants its own uppercase Type enum and only a subset of keywords.
// Best-effort conversion, covering what tools.ts actually produces (object/
// string/boolean, properties/required/enum) — not a general JSON-Schema
// translator. UNVERIFIED against a live Gemini account; see
// docs/engineering/engineering-doc.md §10 open item 1 before defaulting
// LLM_CHAT_PROVIDER here.
function toGeminiSchema(schema: unknown): Schema {
  const s = schema as Record<string, unknown>;
  const typeMap: Record<string, Type> = {
    string: Type.STRING,
    number: Type.NUMBER,
    integer: Type.INTEGER,
    boolean: Type.BOOLEAN,
    array: Type.ARRAY,
    object: Type.OBJECT,
  };

  const out: Schema = {};
  if (typeof s.type === 'string' && typeMap[s.type]) out.type = typeMap[s.type];
  if (typeof s.description === 'string') out.description = s.description;
  if (Array.isArray(s.enum)) out.enum = s.enum as string[];
  if (s.properties && typeof s.properties === 'object') {
    out.properties = Object.fromEntries(
      Object.entries(s.properties as Record<string, unknown>).map(([k, v]) => [k, toGeminiSchema(v)]),
    );
  }
  if (Array.isArray(s.required)) out.required = s.required as string[];
  if (s.items) out.items = toGeminiSchema(s.items);
  return out;
}

function toGeminiContents(history: ChatTurnMessage[]): Content[] {
  const contents: Content[] = [];

  for (const m of history) {
    if (m.role === 'tool') {
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { id: m.toolCallId, name: m.toolCallId, response: { output: m.content } } }],
      });
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      const parts: Part[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const call of m.toolCalls) {
        parts.push({ functionCall: { id: call.id, name: call.name, args: call.args as Record<string, unknown> } });
      }
      contents.push({ role: 'model', parts });
    } else {
      contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
    }
  }

  return contents;
}

/**
 * Multi-turn chat with tool use via Gemini's function-calling API.
 * UNVERIFIED against a live account — see
 * docs/engineering/engineering-doc.md §10 open item 1 before defaulting
 * LLM_CHAT_PROVIDER to gemini. In particular, toGeminiSchema above matches
 * function responses to calls by `id`, which the functionResponse type
 * accepts per the SDK's own types, but behavior against the real API should
 * be confirmed on the golden set before relying on it.
 */
export async function callGeminiChat(
  model: string,
  system: string,
  history: ChatTurnMessage[],
  tools?: ToolDefinitionForModel[],
): Promise<ChatCallResult> {
  const config: GenerateContentConfig = { systemInstruction: system };
  if (tools?.length) {
    config.tools = [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: toGeminiSchema(t.parameters) })) }];
  }

  const response = await client().models.generateContent({ model, contents: toGeminiContents(history), config });

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const toolCalls = parts
    .filter((p): p is Part & { functionCall: NonNullable<Part['functionCall']> } => !!p.functionCall)
    .map((p, i) => ({ id: p.functionCall.id ?? `call_${i}`, name: p.functionCall.name ?? '', args: p.functionCall.args ?? {} }));

  const text = parts.filter(p => p.text).map(p => p.text).join('');

  return {
    message: {
      role: 'assistant',
      content: text,
      toolCalls: toolCalls.length ? toolCalls : undefined,
    },
    inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    model: response.modelVersion ?? model,
  };
}
