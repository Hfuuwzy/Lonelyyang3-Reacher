# DeepSeek Harness Release Baseline for Issue 21

Checked on 2026-09-26 (Asia/Shanghai) against first-party GitHub API and project documentation.

## Findings

- The official repository is [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness), whose default branch is `master`.
- The newest published release entry is [`dsh-v0.1.7-rc.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2), published at `2026-09-24T14:10:21Z`. GitHub marks it as a prerelease.
- The GitHub `releases/latest` endpoint returned HTTP 404, and filtering the published release list for non-draft, non-prerelease entries returned no results. Thus there was no stable release returned by the official release API at the time checked.
- Resolving `dsh-v0.1.7-rc.2` through the official commits API returned `477b4f420553e8a52c2fbccc464d7561b239c443`. Resolving `master` returned the same commit at the time checked. Pinning the commit SHA identifies the source snapshot independently of a moving branch name.
- The official README documents a source checkout and pnpm build/run flow. The Python SDK README separately documents installing `deepseek-harness-sdk` with pip; that SDK installation is distinct from vendoring the TypeScript repository source.

## Version Comparison

- [`dsh-v0.1.5-rc.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.2) was published at `2026-09-10T15:09:34Z` and is a prerelease. Its release notes list feedback-submission and delivered-file/chat-layout improvements. The tag resolves to commit [`fb2c4b9e698e30edb738bca4cf0618587db7d203`](https://github.com/deepseek-ai/deepseek-harness/commit/fb2c4b9e698e30edb738bca4cf0618587db7d203).
- The first `0.1.5` release candidate, [`dsh-v0.1.5-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1), documents the series' baseline capabilities: arbitrary file uploads and file tools, PDF previews, a DeepSeek model adapter, and a `SessionHandle`-based lifecycle with an async `agentLoop.create()` and one-process-per-session locking. These release notes support that the series has the core pieces for a typical agent workflow, but do not verify this project's endpoint or PDF-processing quality.
- [`dsh-v0.1.6-alpha.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.6-alpha.2) records fixes to Messages API endpoint construction and historical tool inputs, plus session/runtime changes.
- [`dsh-v0.1.7-rc.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2) is also a prerelease. Its release notes include fixes for broken characters in long tool output that could break later turns and message-send failures in some long conversations. Those fixes are directly relevant to long-paper workflows, even if the newer features are not needed. The tag resolves to commit [`477b4f420553e8a52c2fbccc464d7561b239c443`](https://github.com/deepseek-ai/deepseek-harness/commit/477b4f420553e8a52c2fbccc464d7561b239c443).

## Primary Sources

- [Official releases API](https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=100)
- [Official latest stable release API](https://api.github.com/repos/deepseek-ai/deepseek-harness/releases/latest)
- [Release `dsh-v0.1.7-rc.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2)
- [Release `dsh-v0.1.5-rc.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.2)
- [Release `dsh-v0.1.5-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1)
- [Release `dsh-v0.1.6-alpha.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.6-alpha.2)
- [Commit resolved from `dsh-v0.1.5-rc.2`](https://github.com/deepseek-ai/deepseek-harness/commit/fb2c4b9e698e30edb738bca4cf0618587db7d203)
- [Commit resolved from `dsh-v0.1.7-rc.2`](https://github.com/deepseek-ai/deepseek-harness/commit/477b4f420553e8a52c2fbccc464d7561b239c443)
- [Commit resolved from `master`](https://github.com/deepseek-ai/deepseek-harness/commit/477b4f420553e8a52c2fbccc464d7561b239c443)
- [Official source build instructions](https://github.com/deepseek-ai/deepseek-harness/blob/master/README.md)
- [Official Python SDK installation instructions](https://github.com/deepseek-ai/deepseek-harness/blob/master/python/sdk/README.md)

## Scope Note

This note records upstream release facts only. The final source baseline and maintenance policy are recorded in the resolution of GitHub issue 21.
