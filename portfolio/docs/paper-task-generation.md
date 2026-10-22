# Paper-task document generation

The prototype paper-task service runs an independent DSH turn for each selected branch. Each branch produces one Markdown document using the selected, task-local snapshot of its `SKILL.md`. The service launches the pinned local DSH CLI through `@deepseek-ai/dsh-sdk-client` 0.1.7-rc.2 and checks the SDK, CLI package, and CLI version before launch.

## Source and skill inputs

Preparation stores the extracted paper as shared `source.md` and its receipt as private `source.meta.json`. Metadata binds the Markdown to the original PDF, source revision, page ranges, extraction status, records, and assets. It is not model-facing paper text. There is no `source.txt`. Legacy extracted records remain available to existing readers and correction workflows, but generation reads the shared Markdown document rather than requesting or producing per-record output.

`paper_task_read_source` returns raw UTF-8 Markdown, up to 200,000 bytes by default, enough for ordinary papers in one call. For a longer paper, follow each `nextOffset` until `totalBytes` is covered. `paper_task_search_source` can locate text and offsets, but search results are snippets and do not count as proof that the full source was read. Publication requires complete source-byte read coverage.

At submission, selected skill resources are copied into immutable `generation-resources/` snapshots. The translation root is selected in this order: an explicit `roots.translation` argument, `PAPER_TASK_TRANSLATION_SKILL_ROOT`, then the machine-local default. Deep reading uses `roots['deep-reading']`, `PAPER_TASK_DEEP_READING_SKILL_ROOT`, then its machine-local default. The selected bundle must include `SKILL.md`; there is no fixed skill name or version requirement. The model reads the entry and follows its instructions, choosing any referenced materials and method itself rather than an application-authored framework. References are addressed relative to the skill entry or the referencing file. Text resources, including scripts, can be read; scripts are not executable. Retries and corrections in the task reuse its snapshots. A new task takes new snapshots. Missing or invalid resources fail the affected branch.

Each branch also receives retained `task-input.md` with the selection and instructions. The nine controlled tools are `paper_task_read_input`, `paper_task_read_source`, `paper_task_search_source`, `paper_task_list_resources`, `paper_task_read_resource`, `paper_task_write_branch`, `paper_task_read_branch`, `paper_task_submit_content_review`, and `paper_task_apply_local_repair`. The isolated `sdk-minimal` composition disables shell, PowerShell, MCP resources, and generic retry producers. Reads are bounded and checked against task-local roots; source, task input, and skill snapshots cannot be written through these tools.

## V2 documents and quality state

`paper_task_write_branch` publishes one complete Markdown manuscript. Translation is one continuous natural-language Chinese translation of the whole paper, not segments or a record-keyed ledger. Deep reading is a Chinese analysis report shaped by the selected skill, not a translation or a prescribed application template. V2 metadata records the manuscript hash, source fingerprint and read ranges, skill digest and resource reads, declared limitations, and referenced original assets. It contains no translation segments or claim ledger.

After publication, the controlled agent reads back the complete saved document and submits exactly one skill-aligned content review. If the review finds substantive issues, the agent may make at most one local repair, limited to the identified manuscript paragraphs, and records which findings were resolved. Publication cannot be repeated; review and repair cannot be repeated. Structural checks and the review workflow determine the task status, but neither proves semantic correctness, translation accuracy, or sound analysis. Source images remain unverified unless separately checked, and unavailable capabilities must be disclosed rather than claimed complete.

The wire event may include a preview of at most eight non-empty paragraphs, each capped at 2,000 characters. This is an excerpt of a retained document, not an automatically complete or approved result. The v2 quality ceiling is `preview`: a non-stale document with only minor or no findings remains a preview, never an automatically completed result. Substantive limitations or findings, including stale source, yield `needs-confirmation`; an invalid artifact yields `failed`. The full translation is retained as `drafts/translation/master.md` with `preview.md` and `translation.json`; deep reading is retained as `drafts/deep-reading/report.md` with `preview.md` and `evidence.json`. The C reader can expose a valid stale Markdown manuscript with `needs-confirmation`; stale does not mean unreadable. Existing legacy record-based readers remain available for legacy artifacts; they do not change the v2 generation contract.

A source correction changes the source fingerprint and makes the entire v2 document based on the old source stale. V2 does not mark isolated paragraphs or segments stale, and does not automatically retranslate or regenerate after correction. A stale document needs a new whole-document workflow. Legacy readers and correction support for legacy records are retained.

The original uploaded PDF remains available from `GET /api/prototype/paper-task/<id>/pdf/original`. Translation exports are Markdown, a controlled-assets archive, and PDF; there is no DOCX export. A translated PDF can be built as an inspection artifact, but final retrieval remains disabled until both the branch quality and the PDF's full-page checks pass. The original is never presented as a translated export. Task outputs remain in the project-local retained workspace and dev-only `/prototype` routes, not public blog collections.

## PDF export and page-by-page inspection

The reader builds only the explicitly selected branch and format. Building a PDF does not download or share it. Before a PDF can be retrieved as a final file, the service requires a content boundary check against the current Markdown master and an inspection record for every page of the actual PDF. Text extraction checks that source blocks remain in order; it does not establish visual correctness.

Maintainer check:

1. In a local `/prototype` task reader, select the translation and explicitly choose **构建 PDF**. Confirm the PDF status changes independently of Markdown and asset status. Do not use the original-paper link as the export under test.
2. Choose **检查生成的 PDF**. The embedded viewer serves the exact retained PDF artifact. Visit every page in order; do not substitute a contact sheet, a text dump, or a sample of pages.
3. For each page, record a concrete expected anchor (for example, the page heading and the table or figure caption expected there), what is actually visible, and an evidence note identifying the inspected PDF page and confirming whether text, images, captions, and page edges are intact. An example for page 1 of a short fixture is: expected `自选分析结构` and the opening conclusion; observed both are readable and complete; evidence `Generated PDF, page 1, opened in the reader; no overlap or clipping`. Replace the example with facts from the artifact being checked.
4. Mark only minor whitespace or line-wrap defects as `minor`. Mark missing, obscured, truncated, or materially cropped content as `blocked`; a blocked page prevents final retrieval. Submit only after the record covers each page exactly once. The service validates the generated page count, page range, non-empty expected/observed/evidence fields, and artifact/master identity.
5. Confirm the saved records appear under **查看逐页检查记录** in the reader and in `drafts/translation/pdf-format.json` in the retained task workspace. The metadata binds the inspection to the artifact SHA-256. Rebuilds or master changes invalidate prior evidence.
6. If the full gate passes, open and download use the same retained PDF bytes; only the response disposition changes. The translated-PDF entry resolves through the same qualified artifact. The original-PDF route remains separate.

Current v2 quality limitation: branch generation caps a clean result at `preview`, while final PDF retrieval requires master quality `complete`. Keep that gate intact; an all-pages inspection does not promote the master. Therefore, with the present v2 policy, maintainers can build and inspect PDFs and verify evidence persistence, but no v2 task can expose a final translated PDF until the upstream quality policy changes. Do not describe an inspection copy as a released final file.

There has not yet been a real task PDF manually inspected page by page. Unit tests exercise the gate and hash binding with generated fixtures; they are not visual-inspection evidence for a production artifact.

## Provider settings and lifecycle

Provider settings are copied at submission, so later changes do not reroute an active task. A missing provider label, endpoint, or model fails submission with an actionable configuration message. The API key is passed only in the DSH child environment, never written to task files, runtime patches, or event payloads. When no key is configured, the child receives a non-secret placeholder required by OpenAI-compatible local gateways.

Each branch has a separate DSH process, Harness home, and runtime directory. Startup, protocol requests, total run time, shutdown, and process reaping are bounded. Generation defaults to a 60-minute limit; `PAPER_TASK_RUN_LIMIT_MS` and `PAPER_TASK_MAX_OUTPUT_TOKENS` override the defaults. The runtime mounts token measurement and bounded compaction, but no tool-result-pruner. Cancellation and event-stream disconnect close the SDK runtime while retaining task materials. Runtime-home removal occurs only after SDK close succeeds; cleanup failure is reported and prevents task deletion.

A fulfilled SDK run means the agent became idle, not that its model request succeeded. Structured terminal errors are checked first. Only a normally completed turn with missing output can receive one same-session continuation, under the original deadline. Bounded, redacted diagnostics are retained in `runtime-diagnostics.json`; actionable failures are recorded in `runtime-error.json`. Provider rejection bodies are not relayed verbatim. A bounded error reader recognizes expired keys and emits a fixed message; other failures remain generic, and credentials and upstream authentication headers are not included.

To run a bounded real-model check against an original PDF, run from `portfolio/`:

```powershell
node scripts/paper-task-generation-local.mjs --allow-paid --env=development --selection=deep-reading "--pdf=D:\papers\original.pdf" --timeout-ms=1200000
```

The runner reads the selected local environment file without printing credentials and checks retained content, current review evidence, original-PDF identity, and cleanup, not just a terminal status. By default it uses both branches and a controlled fixture PDF. From `portfolio/`, `--allow-paid` is required before credentials are read. The default credential file is `.env.test.local`; use `--env=development` for `.env`. `--selection=translation`, `--selection=deep-reading`, and `--selection=both` select branches. The runner bounds execution and preserves task materials. It does not silently switch credential files. Web settings are process-local and are not synchronized automatically with this runner.

## Evidence and limits

Local protocol and quality fixtures exercise the pinned CLI, SDK, controlled tools, review and repair gates, failure paths, and cleanup mechanics. These tests check integration behavior and structural gates, not model quality or semantic correctness.

Historical evidence: on 2026-10-13, an authorized provider run through the then-current default task service produced translation and deep-reading previews from `tests/fixtures/paper-task-source-fixture.pdf`. The terminal outcome was `succeeded`, cleanup was `clean`, and no tool failure was reported. The full Markdown and task resources were retained. The input was incomplete; this prior run does not establish full-paper coverage, visual understanding, accuracy, or completion of the current v2 quality workflow.

Sanitized final-tree QA evidence: a bounded real-model run on 2026-10-20 for task `0940a592-facb-4c57-9302-fbfebc94cef5` used an original 9-page, 835-record paper. Both branches generated and reviewed documents; together they contained 36,437 characters. Each branch called `paper_task_read_source` once, `paper_task_write_branch` once, and `paper_task_submit_content_review` once. Cleanup was `clean`, and elapsed time was 173,273 ms. Translation submitted empty paragraph replacements during its repair; validation rejected the attempt and a second call was denied. The original manuscript and unresolved findings remain readable with `needs-confirmation`, not silently corrected or approved. Separate pinned-DSH regressions verify that valid content-changing repairs succeed for both branches. These counts evidence source delivery and workflow execution, not comprehension or semantic correctness. Image verification and translated export remain limitations.

For opt-in original crop inputs, application payload bounds, branch transport receipts, and the separate visual-understanding acceptance boundary, see [Paper-task image input](paper-task-image-input.md).
