import { readFile } from 'fs/promises';

/**
 * Load a PDF from disk for use with Anthropic's native PDF document support.
 * For OpenAI-compatible vision providers, convert pages to images separately
 * using a tool such as pdfjs-dist + canvas (add when a non-Anthropic vision
 * provider is configured).
 */
export async function loadPdf(filePath: string): Promise<Buffer> {
  return readFile(filePath);
}
