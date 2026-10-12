# Paper-task source preparation

This guide describes the local, sample-only PDF source preparation available on the prototype paper-task route. It is a preparation and correction surface, not a generated paper intermediate.

## Current behavior

- A submitted PDF is retained in a project-local task workspace. Source preparation extracts a minimal ordered JSON record per readable text line, including record ID, page, bounding box, kind, state, section/context, and links. Record `order` preserves natural reading order as extracted.
- The record kinds include body, heading, appendix, footnote, reference, table, formula, and algorithm. Selectable text is not translated, interpreted, or rebuilt into a paper.
- Table, formula, and algorithm source crops can be rendered as original PNG assets. Each asset carries page and bounding-box metadata and `understanding: unverified`. `available` means the PNG exists and passed basic asset checks, not that a model or person understood it.
- Gaps record pages without recoverable selectable text; ambiguous records flag extraction that needs review. These are not repaired automatically.
- The UI allows translation, deep-reading, or both branches, but currently shows sample previews from original extracted text. Previews are marked SAMPLE, incomplete, and not quality-checked. They are not translations or deep-reading reports.

## Controlled fixture

Use `tests/fixtures/paper-task-source-fixture.pdf` for bounded source-preparation checks. It contains a body, appendix, footnote, internal and external links, a table, one formula, one algorithm, ambiguous columns, a caption-only table with missing crop, and a blank page. Expected preparation is incomplete, with four gaps, three available original PNGs, and one missing asset. The fixture does not establish support for arbitrary complex PDFs or scanned documents.

## Read and correct source

In development, access is limited to loopback requests with an accepted matching Origin. A foreign Origin is rejected with 403. These project-local prototype endpoints are not a general public API.

```http
GET /api/prototype/paper-task/{uuid}/source
```

The reader response includes source state, gaps, and assets, not internal source positions or records. Ordered records and per-record revisions remain in the task's private `source-records/` files for processing and repair. The response header `x-paper-source-revision` carries the global source revision. Fetch a rendered asset only by its opaque ID:

```http
GET /api/prototype/paper-task/{uuid}/assets/{opaque-asset-id}
```

Corrections are text-only edits to existing present records, after the task stream has cleanly finished. Submit the current global and record revisions:

```http
PATCH /api/prototype/paper-task/{uuid}/source
Content-Type: application/json

{
  "expectedSourceRevision": 1,
  "corrections": [
    { "recordId": "p1-r1", "expectedRecordRevision": 1, "text": "Corrected existing text." }
  ]
}
```

A successful change returns 200 and advances the global revision. A stale revision returns 409. Invalid JSON or attempts to correct a gap/non-present record return 400; unavailable source or task state returns 409. The API does not guess missing or ambiguous content. A change updates affected records and dependent context/revisions, and marks dependent draft pieces stale in both branches. Untouched records, original assets, and draft payload bytes remain unchanged. A no-op returns unchanged without advancing revisions.

## Retention, isolation, and limits

- Retained project-local task files remain until manual task deletion. There is no TTL, task history, recovery after server restart, correction history, provenance manifest, or human-original intermediate.
- Branch runtimes can read shared source material but write only their own branch workspace. A Node 24 trusted-code guard limits the local runtime; it is not a hostile-code sandbox.
- Extraction relies on selectable PDF text and layout heuristics. It does not promise full-paper translation, deep reading, export, or visual model understanding. Actual generation, regeneration, and model understanding are later work for issues 43, 44, and 45.

## Verification record

The recorded issue42 verification was 701 unit tests passing, with app/server TypeScript checks and production build passing. A cold API run exercised three branch selections and observed 1, 1, and 2 sample previews. The fixture source was incomplete with four gaps, three available original PNGs, and one missing asset. API checks observed correction 200, stale-version conflict 409, and foreign-Origin denial 403. No E2E suite or paid model was run. For API checks after changing dev peer routes, restart the dev server to exercise cold server state. The bounded QA server used for this record was agent-owned and cleaned up; an already-running shared server was not terminated.
