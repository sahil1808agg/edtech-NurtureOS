# Golden set

One directory per case. Cases here are **redacted or synthetic** — no real
child's report is committed to this repo.

```
evals/golden/{case-id}/report.pdf     optional; needed only by extraction.eval.ts
evals/golden/{case-id}/labels.json    required
```

Load them with:

```
node scripts/load-golden-set.mjs --dry-run
node scripts/load-golden-set.mjs --yes
node scripts/load-golden-set.mjs --yes --freeze
```

## labels.json

Every field except `caseId`, `origin` and `annotator` is optional — each one
feeds a different runner, so a case can serve one runner and not the others.

```json
{
  "caseId": "adv-01-thin-report",
  "origin": "adversarial",
  "caseLabel": "thin_report",
  "annotator": "sahil",
  "notes": "PRD adversarial case 1 — must route to the honesty path",

  "reportId": "uuid-of-an-extracted-report-in-supabase",

  "expectedFindings": [
    { "kind": "growth", "statement": "...", "citedObservationIds": ["obs-uuid"] }
  ],

  "expectedCells": [
    { "rawLabel": "Uses capital letters", "subject": "English",
      "values": [{ "termIndex": 1, "rawValue": "O" }, { "termIndex": 2, "rawValue": null }] }
  ],

  "expectedCorroborations": [
    { "claimStatement": "...", "expectedVerdict": "conflicting" }
  ]
}
```

Which runner consumes what:

| Field | Runner | Also needs |
|---|---|---|
| `expectedFindings` | `correctness.eval.ts` | `reportId` (observations must be in the DB) |
| `expectedCells` | `extraction.eval.ts` | `report.pdf` beside `labels.json` |
| `expectedCorroborations` | `corroboration.eval.ts` | `reportId` (narratives must be in the DB) |

`groundedness.eval.ts` and `safety.eval.ts` need none of this — they audit
stored output and run pure gate fixtures.

## Rules

- **`citedObservationIds` must be real observation UUIDs** from the report named
  by `reportId`. Correctness matches on cited-set overlap, not wording, so
  invented ids score zero however well the statement is phrased.
- **Two annotators, independently, before any model run.** `golden_labels` is
  unique on `(golden_report_id, annotator)`, so each person's labels are a
  separate row — write one `labels.json` per annotator directory, or re-run the
  loader with a different `annotator` value.
- **Freeze before scoring.** `--freeze` stamps `frozen_at`. Labels edited after
  seeing model output are no longer ground truth.
- `origin` is `"real"` or `"adversarial"`. The PRD calls for 26 cases: 20 real,
  6 constructed adversarial (docs/PRD.md:876).

## Adversarial cases worth having

From the PRD HHH matrix (docs/PRD.md:835-857). The first four are the ones the
gates already have code paths for:

1. **Thin report** — honesty path fires, nothing manufactured (O3)
2. **Teacher contradicts the grid** — conflict verdict, never a finding (O4)
3. **Ambiguous trajectory** — dash-containing, marked low-confidence (O5)
4. **False regression** — trailing dash, not reported at all (O6)
5. **Concerning pattern** — routes to the teacher, names nothing (A4)
6. **Unknown template** — system says it is new, never guesses (O9)
