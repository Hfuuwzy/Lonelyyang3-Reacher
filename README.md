# Blog Workspace

Personal blog / portal workspace. The git repository root lives here at `D:\Code\Blog`; the Nuxt frontend application lives under `portfolio/`. A backend is planned as a future sibling directory.

## Repository layout

| Path | What it is |
| --- | --- |
| `portfolio/` | Nuxt 4 frontend application. This is the npm working directory — all commands run from here. |
| `docs/adr/` | Architecture decision records (repository root promotion, agent infrastructure placement). |
| `docs/agents/` | Instructions for coding agents working in this repo (issue tracker, triage labels, domain docs). |
| `docs/browser-automation-runbook.md` | Rules for deterministic browser captures. Read before any browser workflow. |
| `AGENTS.md` | Workspace instructions for coding agents. |
| `CONTEXT.md` | Domain vocabulary/glossary for this workspace. |
| `README.md` | This file. |

Planned: a sibling `backend/` directory.

## portfolio/ — Nuxt app

`portfolio/` is a standalone npm package (no root-level npm workspace). All commands below run from `D:\Code\Blog\portfolio`:

```powershell
npm install        # install dependencies (postinstall runs nuxt prepare)
npm run dev        # start the dev server
npm run build      # production build
npm run test:unit  # unit tests (vitest)
npm test           # unit tests only
```

Playwright E2E is opt-in. Run only when requested and target the spec or cases related to the changed behavior:

```powershell
npm run test:e2e -- tests/e2e/final-qa.spec.ts
npm run test:e2e -- tests/e2e/final-qa.spec.ts --grep "Japanese routes"
```

An unfiltered `npm run test:e2e` runs the full suite; use it only when the full E2E suite is explicitly requested.

There is no standalone `typecheck` script configured for `portfolio/`; `npm run dev` and `npm run build` are the available local commands.

### Reading prototype

The synthetic paper reader lives at `portfolio/app/pages/prototype/paper-reader.vue`. Run `npm run dev` from `portfolio/` and open `/prototype/paper-reader`; focus layout C is the default. Prototype routes are excluded from production builds. See [the prototype guide](portfolio/docs/paper-reader-prototype.md) for comparison layouts, fixture controls, and limits.

The task-result C reader is `portfolio/app/components/prototype/PaperTaskReader.vue`; `/prototype/paper-task-reader-fixture` renders it with an untrusted-Markdown sample for bounded manual checks. Real results are opened from `/prototype/paper-task` after a task reaches its result phase.

### Recorded E2E baseline (issue #2)

At issue #2 closure, the recorded E2E baseline was **40 passing, 11 accepted failures**. The 11 failures were stale page-structure/behavior contracts and were accepted for that baseline; they are historical context, not a requirement to run E2E for every change.

## Local agent infrastructure

`.opencode/`, `.omo/`, `.codegraph/`, and `.playwright-mcp/` are local machine-only agent tooling directories. They stay on this machine, are ignored by `.gitignore`, and are never committed.

## Governance

- Tracked domain vocabulary: `CONTEXT.md`
- Tracked decisions: `docs/adr/` (`0001-repo-root-and-baseline-restructure.md`, `0002-agent-infrastructure-out-of-repo.md`)
- Issues/specs: GitHub issues in `Hfuuwzy/Lonelyyang3-Reacher`, managed with the `gh` CLI (see `docs/agents/issue-tracker.md`).
