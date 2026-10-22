# Paper-review local CLI

A developer-facing CLI for the issue #27 paper-review flow. It runs the **existing
in-process multipart + pipeline + Harness seam** directly (no server, browser, or
HTTP route), so you can test submission → stages → report/counts against a real
Harness/binary from the terminal. It is *not* a replacement for route acceptance
tests; it is a local convenience harness for the same code path.

> **Cost warning.** Running with `--allow-paid` launches a real Harness and calls
> your configured provider, which incurs provider cost (BYOK). Only ever run it
> with `--allow-paid` when you intend to make a real paid call.

## Configuration

This CLI reads the ignored `portfolio/.env.test.local` file. That file is
git-ignored and holds your personal agent/test credentials — do **not** commit it.

Required fields (the CLI fails fast and sanitized if any is missing):

```dotenv
LLM_MODEL_ID=deepseek-r1
LLM_API_KEY=sk-your-key
LLM_BASE_URL=https://api.example.com/v1
PDF_PATH=./papers/demo.pdf
```

Optional field:

```dotenv
LLM_PROTOCOL=openai-completions   # or `anthropic-messages`; defaults to `openai-completions`
```

Semantics:

- **`LLM_BASE_URL`** must be a bare `http(s)://` URL with no userinfo and no
  credential-like query keys. The provider label shown in output is derived as
  `new URL(LLM_BASE_URL).host`.
- **`PDF_PATH`** may be absolute or relative; a relative path is resolved against
  `portfolio/`. Only use a local, non-secret PDF for these runs.
- Values may be double-quoted; quotes are stripped by the standard dotenv parser.

## Usage

From `portfolio/`:

```powershell
npm run paper-review:local            # no-flag smoke: prints the gate message, exit 1, reads nothing
npm run paper-review:local -- --allow-paid   # real run (paid) against .env.test.local
```

- **`--allow-paid` is required and must be the only argument.** It must be present
  before any config is read or any review runs. Any unknown argument is rejected.
- Without `--allow-paid` the CLI exits `1`, prints a fixed message, and reads no
  config file at all.

## Output

Output is deliberately safe and countable — **no** report prose, PDF text, API key,
base URL, PDF path, or SDK detail is ever printed.

On success:

```
paper-review:local
stages: validating extracting analyzing verifying
status: incomplete
sections: 3
findings: 5
gaps: 2
missingScope: 1
```

On failure it prints a fixed sanitized message plus (where available) the stage
names and a safe error code, and exits nonzero. Config/bootstrap errors also exit
nonzero with a fixed sanitized message that never echoes the offending value.

## What is intentionally not supported

- **No browser autofill and no production credential defaults.** Every required
  field must come from `LLM_*`/`PDF_PATH`; none has a default.
- **`LLM_TIMEOUT` is not read by this CLI.** A real bounded operation timeout with
  safe cleanup touches the Harness run/cancellation path and is scoped to the
  broader issue #28 work, so this CLI does **not** pretend to support it. Do not add
  `LLM_TIMEOUT` to your `.env.test.local` or any template as if it were honored —
  it would be silently ignored. Prefer retries/limits at the provider or gateway,
  or track issue #28 for first-class timeout support.