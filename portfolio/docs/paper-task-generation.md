# Paper-task text generation

The prototype paper-task service runs one independent DSH turn per selected branch and stores the full natural Markdown draft in that branch's retained workspace. Each turn launches the built local `dsh` CLI through the exact `@deepseek-ai/dsh-sdk-client` pin `0.1.7-rc.2`; the SDK and CLI package versions and the CLI's `--version` output are checked before launch.

## Task inputs and resources

The retained `task-input.md` holds the branch selection and ongoing instructions. The initial DSH prompt asks the agent to read that file through a task tool and read source records and pinned branch resources on demand. It does not inline an extraction summary in place of the files. Deep reading is an independent branch: it analyzes the original source whether or not translation is selected or complete.

At submission, the service snapshots the selected branch's translation skill and its declared Markdown/PDF/DOCX dependencies, or the deep-reading skill and its ten references, into `generation-resources/`. The translation snapshot is accepted only when its frontmatter names `academic-paper-zh-translation` version `1.1.0`. Deep reading uses the pinned `deep-reading-analyst` skill and chooses a suitable analysis framework from its pinned references. A missing or mismatched skill fails only its selected branch. Retries and corrections within this task reuse those retained bytes; a new task creates a new snapshot.

The application-owned Cordis plugin exposes only task-input read, source index/read, pinned resource index/read, current-branch read, and current-branch Markdown write. The isolated `sdk-minimal` composition disables shell, MCP resource, and generic retry producers, so the actual model roster contains only these seven tools. Identifiers are constrained, reads are checked against canonical task-local directories, and output filenames are fixed. Shared source records and resource snapshots are not writable through these tools. Reads are paged by UTF-8 bytes with explicit parameter limits. Saving a preview requires complete skill reads. Deep reading must discover the entire source index and fully read every indexed record; translation must do the same before it can publish a master. Summaries cannot substitute for source text.

## Translation master

Translation saves one continuous natural Chinese Markdown master through `paper_task_write_branch`. The call carries bounded `segments` in article order, each with the source records it draws on; a natural paragraph may span several records. The application joins the segments, checks the complete source index, and publishes three retained files together: `drafts/translation/master.md`, a compatibility `preview.md` copy, and the internal `translation.json` ledger. There is no bilingual pairing, fixed article JSON template, source-position markers, original two-column layout, or pagination in the master.

The ledger records every segment’s source-revision dependencies, declared terminology choices, referenced original assets, and unresolved records. Structural checks require:

- Every indexed record is translated, preserved as an original asset, kept as an English reference entry, or listed with an unresolved reason.
- Reference entries keep their original English text.
- Table, formula, and algorithm records keep their original crop. Images must use the task-owned `asset:<id>` scheme; other image targets are rejected. Tables are never translated, rebuilt, or generatively redrawn. Figure captions are translated as text, and a detected figure retains the page region above its caption as an unverified original crop; if that region is unavailable, essential figure content must be declared unresolved instead of inferred.
- Source numbers and units survive in the master, and declared terminology stays consistent.
- The master is not a short substitute summary: for source text above a small threshold, its non-whitespace length must reach a conservative fraction of the translated source length.
- Missing or unrecoverable material appears as a short reader-visible note (`待补`, `未核实`, and similar) instead of guessed content.

These checks are structural and presence-based. They do not prove sentence-level accuracy, complete semantic equivalence, or translation quality.

## Reader retrieval and freshness

`GET /api/prototype/paper-task/<id>/translation` returns the complete master, referenced original assets, unresolved reasons, and stale paragraph indexes. The route uses the same local-development access gate and no-store headers as source retrieval. The task page renders the full master in continuous single-column order with its associated original charts; the bounded SSE excerpts remain only as a loading/fallback view and never replace a readable master.

A local source correction updates only the affected source records and context, then marks only ledger segments that depend on a changed record stale. Unaffected segment text and the master bytes stay unchanged; the master condition becomes `needs-update` until a later review/repair workflow handles it. Automatic retranslation is not triggered by a correction, and this ticket does not introduce a quality-approved final state.

Deep reading remains independent: it neither requires translation nor is blocked by translation failure, and a deep-reading failure does not hide a readable translation master.

## Provider settings and lifecycle

Provider settings are copied when a task is submitted, so later settings changes do not reroute an active task. Missing provider label, endpoint, or model fails submission with an actionable configuration message. The API key is passed only in the DSH child environment; it is not written into task files, runtime patches, or event payloads. When the key is empty, the child gets a non-secret placeholder required by OpenAI-compatible local gateways.

Each branch owns a separate DSH process, Harness home, and runtime directory. Startup, individual protocol requests, total turn duration, shutdown, and process reaping are bounded. Cancellation or event-stream disconnect closes the SDK runtime; task and generation materials remain retained. Runtime-home removal happens only after SDK close succeeds; cleanup failure is reported and prevents task deletion.

## Preview semantics

Generated natural Markdown is retained as `drafts/<branch>/preview.md`. Translation additionally retains `master.md` and its `translation.json` ledger; both are the canonical full document. Deep reading retains the same full report as `drafts/deep-reading/report.md`. The wire event still exposes only up to eight non-empty paragraphs, each capped at 2,000 characters, and uses designation `generated-preview`; terminal state is `preview-ready`. The excerpt does not replace or truncate the retained document, and the reader fetches the full translation separately. Deep-reading saves also retain internal `evidence.json`: report passages are linked to original source-record revisions and verbatim quotes, with fact/inference classification and an explanation for inferences.

A generated preview is unfinished and is not a complete translation, a quality approval, or proof of semantic accuracy. Evidence guards check report passage presence, source quote matches, record revisions, and disallow table, formula, or algorithm records as verified evidence. They do not prove that a report's claims are accurate or that the analysis is sound. Source-state assets use stable report-relative paths, but their understanding remains `unverified`; missing or unverified material must be disclosed rather than interpreted as understood. These guards are not full-document validation or the downstream quality gates. Reader rendering, export, quality gates, and acceptance of image understanding through a real endpoint remain later work. Translation remains independent: it need not be selected or succeed for a deep-reading draft to be saved, and translation failure does not hide the sibling deep-reading result.

## Verification boundary

The local protocol fixtures exercise the actual pinned DSH CLI, SDK, Cordis composition, and controlled tools. They cover successful preview generation plus provider failure, cancellation, and event-consumer disconnect, checking runtime cleanup and retained source materials. They verify integration mechanics, not model quality. Translation-specific tests use a controlled source containing body text, an appendix, a footnote, an English reference entry, repeated numbers and units, terminology, and an original table crop; they check structural coverage, controlled asset references, and master readability. A fixture with more than 200 indexed records is covered by the ledger validation rather than a fixed dependency cap. These checks do not establish sentence-level translation accuracy.

On 2026-10-13, a real authorized provider run through the default task service produced two independent previews from `tests/fixtures/paper-task-source-fixture.pdf`: translation and deep reading, with 16 bounded preview paragraphs in total. The terminal outcome was `succeeded`, cleanup was `clean`, and no tool failure was reported. Full Markdown, source records, and pinned resource snapshots were retained under the project-local task workspace. The controlled input remains incomplete; these previews do not establish full-paper coverage, visual understanding, accuracy, or a completed quality workflow.

From `portfolio/`, run `node scripts/paper-task-generation-local.mjs --allow-paid`. The default credential file is `.env.test.local`; explicitly use `--env=development` for `.env`. `--selection=translation`, `--selection=deep-reading`, or `--selection=both` selects the branch set. The command requires the paid-call flag before reading credentials, prints only sanitized outcome/count metadata, bounds execution, and preserves task materials. It never falls back silently between credential files.

For opt-in original crop inputs, application payload bounds, branch transport receipts, and the separate visual-understanding acceptance boundary, see [Paper-task image input](paper-task-image-input.md).
