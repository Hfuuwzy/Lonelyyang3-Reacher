# Workspace Instructions

## Repository layout

- Git root: this directory (`D:\Code\Blog`).
- Frontend app: `portfolio/` (Nuxt 4). It is the npm working directory — run every npm command from `portfolio/` (`npm install`, `npm run dev`, `npm run build`, `npm test`, `npm run test:unit`, `npm run test:e2e`). There is no root npm workspace and no standalone typecheck script.
- Planned sibling: `backend/`.
- Governance docs: `README.md`, `CONTEXT.md`, `docs/adr/`, `docs/agents/`, `docs/browser-automation-runbook.md`.
- Machine-local agent tooling (`.opencode/`, `.omo/`, `.codegraph/`, `.playwright-mcp/`) is ignored by `.gitignore` and never committed.
- Keep root-level screenshots, browser captures, and retired plans/specs out of the repo; keep the frontend lockfile under `portfolio/`.

## Test execution

- Choose the smallest relevant checks for changed behavior; tests are not a mandatory end-of-task ritual.
- `npm test` and `npm run test:unit` run unit tests only.
- Playwright E2E is opt-in: run it only when the user explicitly asks for E2E/Playwright tests. When requested, select only affected spec files or cases with a path or title filter; run the unfiltered full suite only when the user explicitly asks for the full E2E suite.
- Add or update focused tests when a behavior needs a maintained regression guard. Keep distinct useful coverage; retire or consolidate cases only when the behavior is removed or coverage is genuinely redundant, not merely because a test passed once.

## Browser Automation

- Read `docs/browser-automation-runbook.md` before starting any browser workflow.
- Use the project MCP `playwright-isolated` for timed, deterministic captures.
- Reference-versus-local comparisons use one isolated `playwright-isolated` browser with two tabs, never two browser stacks or contexts by default.
- Keep those tabs only for the bounded current run. Freshly reload both tabs before every timed capture sequence.
- The default visual baseline is a top-of-page viewport screenshot at `2560×1440` CSS pixels, this workspace's primary 2K fullscreen viewport. Use full-page capture only when needed as supplemental evidence.
- Use `agent-browser` only for interactive workflows, always with a unique `--session`.
- Limit the complete browser workflow, including cleanup, to 10 minutes.
- Make at most two retries after the initial attempt.
- Never run browser work in the background or overnight.
- Use one browser stack at a time. Fall back only after receiving the primary stack's cleanup receipt.
- Bound every selector, text, URL, and app-state wait. Never use unbounded `networkidle` waits.
- Use finally-style closure and evidence cleanup. A cleanup receipt is mandatory before completion.

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues on `Hfuuwzy/MyWorks`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles mapped to labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: one `CONTEXT.md` at the repo root plus `docs/adr/`. See `docs/agents/domain.md`.
