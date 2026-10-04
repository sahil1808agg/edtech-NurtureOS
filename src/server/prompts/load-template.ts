import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Loads a prompt's static wording from src/server/prompts/templates/<name>.md
 * and fills in `{{key}}` placeholders. The .md files are the maintained,
 * human-reviewable source of truth for what gets sent to the model — open
 * one directly to review or edit wording, no TypeScript required. The
 * chat-*.ts prompt modules own only the dynamic assembly (which template,
 * which values) — see docs/specs/08-orchestrator-chat.md.
 *
 * Read once per process and cached — restart the server (or redeploy) to
 * pick up an edited template.
 */
const templateCache = new Map<string, string>();

function loadTemplateFile(templateName: string): string {
  const cached = templateCache.get(templateName);
  if (cached !== undefined) return cached;

  const filePath = path.join(process.cwd(), 'src', 'server', 'prompts', 'templates', `${templateName}.md`);
  const content = readFileSync(filePath, 'utf8');
  templateCache.set(templateName, content);
  return content;
}

/**
 * Every `{{key}}` in the template must have a matching entry in `vars` —
 * missing one is a bug in the caller, not a value a parent should ever see
 * leak into a prompt, so this throws rather than silently leaving `{{key}}`
 * in the text.
 */
export function renderPromptTemplate(templateName: string, vars: Record<string, string>): string {
  const template = loadTemplateFile(templateName);

  const rendered = template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (!(key in vars)) throw new Error(`template "${templateName}" references {{${key}}}, which was not provided`);
    return vars[key];
  });

  return rendered.trim();
}
