# Upstream Harness Source Pin

- Repository: `https://github.com/deepseek-ai/deepseek-harness`
- Release: `dsh-v0.1.7-rc.2`
- Commit: `477b4f420553e8a52c2fbccc464d7561b239c443`
- License: MIT; preserve `LICENSE` and `THIRD_PARTY_NOTICES.md`.

This is a tracked source snapshot for the repository-maintained Harness foundation. It is not a submodule and does not follow upstream automatically. Update it only after an explicit version review; keep local changes in this repository.

The upstream workspace requires Node `^22.19.0 || >=24.0.0` and pins `pnpm@11.7.0`. Use Corepack from this directory to install and build the source. The web application remains a separate npm package in `portfolio/`.

## Paper-review build prerequisite

The `portfolio/` paper-review workbench launches the SDK runtime from this checked-in fork, never the published npm `@deepseek-ai/dsh`. Before running it, build this workspace separately with Corepack/pnpm from this directory:

```sh
corepack pnpm install
corepack pnpm run build
```

The runner requires the built CLI entry at `apps/cli/lib/bin.js` (declared as `apps/cli/package.json` → `bin.dsh`). It also requires that `apps/cli/package.json` version matches the app-installed SDK version in `portfolio/node_modules/@deepseek-ai/dsh-sdk-client/package.json`; a missing built entry or a version mismatch fails the run closed with a typed, actionable error. Build outputs under `apps/cli/lib/` are not committed; this `harness/` tree and the `portfolio/` npm package stay separate (no root workspace).
