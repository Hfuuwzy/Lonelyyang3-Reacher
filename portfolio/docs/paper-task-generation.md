# Paper-task text generation

The prototype paper-task service runs one independent DSH turn per selected branch and stores the full natural Markdown draft in that branch's retained workspace. Each turn launches the built local `dsh` CLI through the exact `@deepseek-ai/dsh-sdk-client` pin `0.1.7-rc.2`; the SDK and CLI package versions and the CLI's `--version` output are checked before launch.

## Task inputs and resources

The retained `task-input.md` holds the branch selection and ongoing instructions. The initial DSH prompt asks the agent to read that file through a task tool and read source records and pinned branch resources on demand. It does not inline an extraction summary in place of the files.

At submission, the service snapshots the selected branch's translation skill and its declared Markdown/PDF/DOCX dependencies, or the deep-reading skill and its ten references, into `generation-resources/`. The translation snapshot is accepted only when its frontmatter names `academic-paper-zh-translation` version `1.1.0`. A missing or mismatched skill fails only its selected branch. Retries and corrections within this task reuse those retained bytes; a new task creates a new snapshot.

The application-owned Cordis plugin exposes only task-input read, source index/read, pinned resource index/read, current-branch read, and current-branch Markdown write. The isolated `sdk-minimal` composition disables shell, MCP resource, and generic retry producers, so the actual model roster contains only these seven tools. Identifiers are constrained, reads are checked against canonical task-local directories, and output filenames are fixed. Shared source records and resource snapshots are not writable through these tools. Reads are paged by UTF-8 bytes with explicit parameter limits; saving a preview requires complete skill reads and source-revision dependencies matching the records actually read.

## Provider settings and lifecycle

Provider settings are copied when a task is submitted, so later settings changes do not reroute an active task. Missing provider label, endpoint, or model fails submission with an actionable configuration message. The API key is passed only in the DSH child environment; it is not written into task files, runtime patches, or event payloads. When the key is empty, the child gets a non-secret placeholder required by OpenAI-compatible local gateways.

Each branch owns a separate DSH process, Harness home, and runtime directory. Startup, individual protocol requests, total turn duration, shutdown, and process reaping are bounded. Cancellation or event-stream disconnect closes the SDK runtime; task and generation materials remain retained. Runtime-home removal happens only after SDK close succeeds; cleanup failure is reported and prevents task deletion.

## Preview semantics

Generated natural Markdown is retained as `drafts/<branch>/preview.md`. The wire event exposes only up to eight non-empty paragraphs, each capped at 2,000 characters, and uses designation `generated-preview`; terminal state is `preview-ready`. The full Markdown is not forced into a universal intermediate schema. The task tools can record source-record revisions named by the writer so corrections can mark dependent draft pieces stale. Existing sample-runtime tests retain `sample` and `sample-ready`; sample output is not represented as real generation.

A generated preview is unfinished and is not a complete translation, deep-reading report, or quality approval. This change does not implement figure/crop understanding, full-document validation, or downstream quality gates.

## Verification boundary

The local protocol fixtures exercise the actual pinned DSH CLI, SDK, Cordis composition, and controlled tools. They cover successful preview generation plus provider failure, cancellation, and event-consumer disconnect, checking runtime cleanup and retained source materials. They verify integration mechanics, not model quality.

On 2026-10-13, a real authorized provider run through the default task service produced two independent previews from `tests/fixtures/paper-task-source-fixture.pdf`: translation and deep reading, with 16 bounded preview paragraphs in total. The terminal outcome was `succeeded`, cleanup was `clean`, and no tool failure was reported. Full Markdown, source records, and pinned resource snapshots were retained under the project-local task workspace. The controlled input remains incomplete; these previews do not establish full-paper coverage, visual understanding, accuracy, or a completed quality workflow.

From `portfolio/`, run `node scripts/paper-task-generation-local.mjs --allow-paid`. The default credential file is `.env.test.local`; explicitly use `--env=development` for `.env`. `--selection=translation`, `--selection=deep-reading`, or `--selection=both` selects the branch set. The command requires the paid-call flag before reading credentials, prints only sanitized outcome/count metadata, bounds execution, and preserves task materials. It never falls back silently between credential files.
