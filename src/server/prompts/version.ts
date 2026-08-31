/**
 * Pinned prompt versions. Incrementing any value is a pull request that
 * triggers the evaluation run in CI — treat these like infrastructure changes.
 */
export const PROMPT_VERSIONS = {
  extract:     process.env.PROMPT_VERSION_EXTRACT     ?? '1',
  normalise:   process.env.PROMPT_VERSION_NORMALISE   ?? '1',
  analyse:     process.env.PROMPT_VERSION_ANALYSE     ?? '2',
  corroborate: process.env.PROMPT_VERSION_CORROBORATE ?? '1',
  plan:        process.env.PROMPT_VERSION_PLAN        ?? '2',
  checkin:     process.env.PROMPT_VERSION_CHECKIN     ?? '2',
} as const;

export type PromptKey = keyof typeof PROMPT_VERSIONS;

export function versionTag(key: PromptKey): string {
  return `${key}:${PROMPT_VERSIONS[key]}`;
}
