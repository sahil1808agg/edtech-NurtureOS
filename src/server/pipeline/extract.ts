import { z } from 'zod';
import { callModel } from '../llm/client.js';
import { buildExtractMessage } from '../prompts/extract.js';
import type { StageResult, SourceRef } from './types.js';

export interface ExtractedCell {
  rawLabel: string;
  section: string | null;
  subject: string;
  values: Array<{ termIndex: number; rawValue: string | null }>;
  sourceRef: SourceRef & { table: number; row: number; cell: number };
  confidence: number;
}

export interface ExtractOutput {
  cells: ExtractedCell[];
  narratives: Array<{ subject: string | null; text: string; sourceRef: SourceRef }>;
  scaleHint: string | null;
  senIndicators: string[];
}

const SourceRefSchema = z.object({
  page: z.number().int(),
  table: z.number().int().optional(),
  row: z.number().int().optional(),
  cell: z.number().int().optional(),
});

const ExtractOutputSchema = z.object({
  cells: z.array(
    z.object({
      rawLabel: z.string(),
      section: z.string().nullable(),
      subject: z.string(),
      values: z.array(z.object({ termIndex: z.number().int(), rawValue: z.string().nullable() })),
      sourceRef: SourceRefSchema,
      confidence: z.number().min(0).max(1),
    })
  ),
  narratives: z.array(
    z.object({
      subject: z.string().nullable(),
      text: z.string(),
      sourceRef: SourceRefSchema,
    })
  ),
  scaleHint: z.string().nullable(),
  senIndicators: z.array(z.string()),
});

export interface ExtractInput {
  reportId: string;
  pdfBuffer?: Buffer;
  images?: string[];
}

export async function runExtract(input: ExtractInput): Promise<StageResult<ExtractOutput>> {
  const msg = buildExtractMessage(input.pdfBuffer, input.images);
  const result = await callModel('extract', msg, ExtractOutputSchema);

  if (!result.ok) return result;

  if (result.value.senIndicators.length > 0) {
    return {
      ok: false,
      error: { code: 'SEN_DETECTED', indicators: result.value.senIndicators },
      meta: result.meta,
    };
  }

  const confidenceThreshold = parseFloat(process.env.EXTRACTION_CONFIDENCE_THRESHOLD ?? '0.85');
  const lowConf = result.value.cells.find(c => c.confidence < confidenceThreshold);
  if (lowConf) {
    return {
      ok: false,
      error: { code: 'LOW_CONFIDENCE', field: lowConf.rawLabel, confidence: lowConf.confidence },
      meta: result.meta,
    };
  }

  return result as StageResult<ExtractOutput>;
}
