/**
 * Data loaders for the eval runners.
 *
 * Reuses serviceClient() rather than building another client: RLS is bypassed
 * here deliberately, because an eval audits every family's output at once.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { serviceClient } from '../../src/lib/db/clients.js';

export interface StoredCitation {
  observationId: string | null;
  narrativeId: string | null;
}

export interface StoredFinding {
  id: string;
  kind: 'strength' | 'growth';
  statement: string;
  corroborationStatus: string;
  corroborationQuote: string | null;
  position: number;
  citations: StoredCitation[];
}

export interface StoredFindingSet {
  id: string;
  reportId: string;
  childId: string;
  status: string;
  honestyPath: boolean;
  promptVersion: string;
  findings: StoredFinding[];
  /** Observation ids belonging to THIS report — the set a citation must fall inside. */
  validObservationIds: string[];
  validNarrativeIds: string[];
}

/**
 * Every finding set with its findings, citations, and the id sets for its own
 * report.
 *
 * The report-scoped id sets are the point. finding_citations.observation_id is
 * a foreign key with ON DELETE CASCADE, so a citation can never point at a row
 * that does not exist — checking mere existence would always pass. What the
 * database does NOT enforce is that the cited observation belongs to the report
 * the finding was drawn from, and a claim citing another child's report is
 * exactly the O1 violation the gate exists to prevent.
 */
export async function loadFindingSets(): Promise<StoredFindingSet[]> {
  const db = serviceClient();

  const { data: sets, error } = await db
    .from('finding_sets')
    .select('id, report_id, child_id, status, honesty_path, prompt_version')
    .order('created_at');
  if (error) throw new Error(`loading finding_sets: ${error.message}`);

  const out: StoredFindingSet[] = [];

  for (const s of sets ?? []) {
    const { data: findings, error: fErr } = await db
      .from('findings')
      .select('id, kind, statement, corroboration_status, corroboration_quote, position')
      .eq('finding_set_id', s.id)
      .order('position');
    if (fErr) throw new Error(`loading findings for ${s.id}: ${fErr.message}`);

    const ids = (findings ?? []).map((f) => f.id);
    const citationsByFinding = new Map<string, StoredCitation[]>();

    if (ids.length) {
      const { data: cites, error: cErr } = await db
        .from('finding_citations')
        .select('finding_id, observation_id, narrative_id')
        .in('finding_id', ids);
      if (cErr) throw new Error(`loading citations for ${s.id}: ${cErr.message}`);

      for (const c of cites ?? []) {
        const list = citationsByFinding.get(c.finding_id) ?? [];
        list.push({ observationId: c.observation_id, narrativeId: c.narrative_id });
        citationsByFinding.set(c.finding_id, list);
      }
    }

    const { data: obs } = await db.from('observations').select('id').eq('report_id', s.report_id);
    const { data: narr } = await db.from('narratives').select('id').eq('report_id', s.report_id);

    out.push({
      id: s.id,
      reportId: s.report_id,
      childId: s.child_id,
      status: s.status,
      honestyPath: s.honesty_path,
      promptVersion: s.prompt_version,
      validObservationIds: (obs ?? []).map((o) => o.id),
      validNarrativeIds: (narr ?? []).map((n) => n.id),
      findings: (findings ?? []).map((f) => ({
        id: f.id,
        kind: f.kind,
        statement: f.statement,
        corroborationStatus: f.corroboration_status,
        corroborationQuote: f.corroboration_quote,
        position: f.position,
        citations: citationsByFinding.get(f.id) ?? [],
      })),
    });
  }

  return out;
}

/** Narratives for a report, in the shape runCorroborate and verifyQuote expect. */
export async function loadNarratives(reportId: string) {
  const { data, error } = await serviceClient()
    .from('narratives')
    .select('id, report_id, subject, text')
    .eq('report_id', reportId);
  if (error) throw new Error(`loading narratives for ${reportId}: ${error.message}`);

  return (data ?? []).map((n) => ({
    id: n.id,
    reportId: n.report_id,
    subject: n.subject,
    text: n.text,
  }));
}

// ------- golden set (on disk) -------

export interface GoldenExpectedFinding {
  kind: 'strength' | 'growth';
  statement: string;
  citedObservationIds: string[];
}

export interface GoldenExpectedCell {
  rawLabel: string;
  subject: string;
  values: Array<{ termIndex: number; rawValue: string | null }>;
}

export interface GoldenCase {
  caseId: string;
  origin: 'real' | 'adversarial';
  caseLabel: string | null;
  annotator: string;
  notes?: string;
  /** Set once a real report has been extracted, so runners can load its observations. */
  reportId?: string;
  expectedFindings?: GoldenExpectedFinding[];
  expectedCells?: GoldenExpectedCell[];
  expectedCorroborations?: Array<{
    claimStatement: string;
    expectedVerdict: 'corroborated' | 'not_mentioned' | 'conflicting';
  }>;
  /** Path to the PDF beside labels.json, if one is committed. */
  pdfPath?: string;
}

const GOLDEN_DIR = join('evals', 'golden');

/**
 * Reads evals/golden/{case-id}/labels.json. Returns [] when the directory does
 * not exist yet — the golden set is hand-built, and a runner with no cases must
 * report "no data" rather than crash the whole sweep.
 */
export function loadGoldenCases(): GoldenCase[] {
  if (!existsSync(GOLDEN_DIR)) return [];

  const cases: GoldenCase[] = [];

  for (const entry of readdirSync(GOLDEN_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const labelsPath = join(GOLDEN_DIR, entry.name, 'labels.json');
    if (!existsSync(labelsPath)) continue;

    const parsed = JSON.parse(readFileSync(labelsPath, 'utf8')) as GoldenCase;
    const pdfPath = join(GOLDEN_DIR, entry.name, 'report.pdf');

    cases.push({
      ...parsed,
      caseId: parsed.caseId ?? entry.name,
      pdfPath: existsSync(pdfPath) ? pdfPath : undefined,
    });
  }

  return cases;
}
