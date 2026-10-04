# Spec 02 — Report upload as a chat attachment

Implements Feature 2. Reuses every piece of `src/app/api/reports/route.ts` except the entry point.

## Refactor first (no behavior change)

Extract the existing route body into a shared function:

```ts
// src/server/reports/ingest.ts
export interface IngestReportInput {
  childId: string;
  familyId: string;          // caller's own family, already verified by the route
  file: File;
  termLabel?: string;
  termIndex?: number;
  academicYear?: string;
}

export interface IngestReportResult {
  reportId: string;
  status: 'uploaded';
}

/** Consent check -> validate type/size -> insert reports row -> upload to storage -> enqueue report.extract.
 *  Identical body to the current src/app/api/reports/route.ts POST handler, lifted out so both
 *  the legacy upload route and the chat attachment route call one implementation. */
export async function ingestReport(input: IngestReportInput): Promise<IngestReportResult>;
```

`src/app/api/reports/route.ts` becomes a thin wrapper: auth + ownership check, then `ingestReport(...)`, same response shape as today — no behavior change for the legacy upload page.

Reused constants (move to `src/server/reports/ingest.ts`, exported for both callers): `MAX_BYTES = 20 * 1024 * 1024`, `ACCEPTED = new Set(['application/pdf', 'image/jpeg', 'image/png'])`.

## New route

```
POST /api/children/:id/chat/attachments
  multipart: { file }
  -> 202 { reportId: string, pendingMessage: ChatMessageRow }

  1. Ownership check (same pattern as every child-scoped route).
  2. ingestReport({ childId, familyId: user.familyId, file }).
  3. getOrCreateConversation(childId, familyId).
  4. appendMessage({ role: 'assistant', content: 'Looking at this report now…',
       status: 'pending', attachmentReportId: reportId }).
  5. Return the pending message so the client can render it immediately.
```

On `ConsentError` from `ingestReport`: respond 403 with the same `{ error, reason }` shape `src/app/api/reports/route.ts` returns today; the chat UI renders it as an inline assistant message rather than a toast (see Spec 01 composer error handling).

## Client

`ChatThread.tsx` attach control reuses `UploadForm.tsx`'s client-side type/size validation (extract that into a shared `src/lib/validateReportFile.ts` used by both forms) before the request is sent, so rejections for an obviously-wrong file never hit the network.

## Edge cases

- Two attachments sent back-to-back for the same child → two independent `reports` rows, two independent pending messages, each resolved independently by Spec 05 when its own `report.analyse` completes.
- Attachment sent to a child with no live consent → 403 before any storage write, identical to the legacy path today.
