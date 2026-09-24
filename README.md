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
npm run test:e2e   # End-to-end tests (Playwright)
npm test           # unit then E2E
```

There is no standalone `typecheck` script configured for `portfolio/`; `npm run dev` and `npm run build` are the available local commands.

### E2E baseline (issue #2)

The current E2E run settles at **40 passing, 11 accepted failures**. The 11 failures are accepted stale-contract failures (page structure/behavior drifted from older test expectations) and do not block the baseline.

## Local agent infrastructure

`.opencode/`, `.omo/`, `.codegraph/`, and `.playwright-mcp/` are local machine-only agent tooling directories. They stay on this machine, are ignored by `.gitignore`, and are never committed.

## Governance

- Tracked domain vocabulary: `CONTEXT.md`
- Tracked decisions: `docs/adr/` (`0001-repo-root-and-baseline-restructure.md`, `0002-agent-infrastructure-out-of-repo.md`)
- Issues/specs: GitHub issues on `Hfuuwzy/MyWorks`, managed with the `gh` CLI (see `docs/agents/issue-tracker.md`).