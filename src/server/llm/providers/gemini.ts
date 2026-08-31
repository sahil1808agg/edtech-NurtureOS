import { GoogleGenAI, createPartFromBase64, ThinkingLevel, type Part, type GenerateContentConfig } from '@google/genai';
import type { LlmMessage, LlmResponse } from '../types.js';

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
