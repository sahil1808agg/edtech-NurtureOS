# Spec 05 — Pipeline progress surfaced as a live chat update

Implements Feature 5. Worker-side addition only — the pipeline stages themselves (`src/server/pipeline/*.ts`) are unchanged.

## Change to `src/server/queue/jobs/report-analyse.ts`

After the existing publish-findings logic (unchanged), add:

```ts
// At the end of the existing report.analyse handler, after finding_sets/findings are written:
const pending = await admin.from('messages')
  .select('id, conversation_id')
  .eq('attachment_report_id', reportId)
  .eq('status', 'pending')
  .maybeSingle();

const summary = buildFindingsSummaryForChat(findingSet, findings); // new small helper, src/server/chat/summarize.ts

if (pending.data) {
  await admin.from('messages')
    .update({ content: summary, status: 'complete' })
    .eq('id', pending.data.id);
} else {
  // Report was processed from the legacy upload page, not a chat attachment —
  // no placeholder exists. If the child has a conversation, post a fresh
  // message so it still shows up there; if not, do nothing (legacy-only use).
  const conv = await admin.from('conversations').select('id').eq('child_id', childId).maybeSingle();
  if (conv.data) {
    await admin.from('messages').insert({
      conversation_id: conv.data.id, family_id: familyId, role: 'assistant',
      content: summary, status: 'complete',
    });
  }
}
```

`buildFindingsSummaryForChat` reuses the same finding statements/citations already computed — it is a formatting function, not a new model call.

## Equivalent addition to `src/server/queue/jobs/plan-generate.ts`

Same pattern, for the case where `regenerate_plan` (Spec 03) was itself enqueued rather than run inline — e.g. if a future revision moves it off the inline path per engineering-doc §10 open item 2. At the time of this spec, `regenerate_plan` runs inline from `dispatchTool` and does not need this path, since its caller already has the result synchronously. Implement this handler addition anyway, for the `plan.generate` path still used by any legacy-page-triggered plan request.

## Failure path

If the report ends in `held` or `failed` (existing `report_status` values, unchanged), update the placeholder message to reflect that instead of a findings summary:

```ts
if (report.status === 'held')   content = "I didn't find enough in this report to stand behind a finding — happy to look again if you upload a clearer copy or a different term's report.";
if (report.status === 'failed') content = "Something went wrong processing that report. Mind trying the upload again?";
```

Same `status: 'complete'` update either way — `pending` must not be left hanging indefinitely.

## Client-side (no new code beyond Spec 01)

The Realtime subscription already set up in Spec 01 receives this `UPDATE`/`INSERT` on `messages` and merges it by `id` — no polling needed. A reconnect-after-disconnect fallback (`GET /api/children/:id/chat` re-fetch, de-duped by id) covers the case where the socket dropped during processing.

## Edge cases

- Worker updates a message for a conversation the parent has since closed/left → irrelevant to the worker; it writes the DB row regardless, and the client picks it up next time that thread is open (Realtime is additive to the initial `GET`, not the only delivery path).
- Two reports in flight for the same child at once → each has its own `attachment_report_id`-linked placeholder; the `.maybeSingle()` lookup is scoped by `reportId`, not `childId`, so they resolve independently.
