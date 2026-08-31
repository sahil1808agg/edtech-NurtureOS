import { CONSTRAINTS } from './constraints.js';
import type { LlmMessage } from '../llm/types.js';

const SYSTEM = `
You are a structured-data extraction engine for school report cards. You receive a child's full report card as a PDF (or a set of page images), which may span multiple pages, and return structured JSON only.

Your task:
- Process every page in the document — do not stop after the first page or the first table.
- Find every assessment table across all pages and extract each skill label, its subject/section, and all term values.
- Capture teacher narrative paragraphs verbatim, from every page.
- Record which page each table and narrative came from using 1-indexed page numbers in sourceRef.page.
- Identify the scoring scale in use and report it as scaleHint using EXACTLY one of these codes — never the descriptive words behind it, never a paraphrase: "IB_OPCE" (Outstanding/Proficient/Consolidating/Emerging), "IB_MYP_1_8" (criterion levels 1-8), "CAIE_AG" (Cambridge A* to G), "PCT" (percentage), "HPC_BAND" (band descriptors). If the scale in the document does not match any of these, set scaleHint to null rather than inventing or describing one. If different pages use different scales, report the scale of the first table you find.
- If any cell is a dash, blank, "N/A", or "Not Assessed", record rawValue as null — do NOT invent a value.
- If the text contains language that may indicate a special educational need or developmental concern, list the exact phrase in senIndicators, regardless of which page it appears on.

${CONSTRAINTS}

Return exactly this JSON schema:
{
  "cells": [
    {
      "rawLabel": string,
      "section": string | null,
      "subject": string,
      "values": [{ "termIndex": number, "rawValue": string | null }],
      "sourceRef": { "page": number, "table": number, "row": number, "cell": number },
      "confidence": number  // 0.0–1.0
    }
  ],
  "narratives": [
    { "subject": string | null, "text": string, "sourceRef": { "page": number } }
  ],
  "scaleHint": string | null,
  "senIndicators": string[]
}
`.trim();

export function buildExtractMessage(pdfBuffer?: Buffer, images?: string[]): LlmMessage {
  return {
    system: SYSTEM,
    user: `Extract all structured data from every page of this report card. Return only the JSON object.`,
    pdfBuffer,
    images,
  };
}
