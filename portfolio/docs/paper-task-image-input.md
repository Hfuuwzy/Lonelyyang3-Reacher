# Paper-task image input

This guide describes the bounded image-input policy for paper-task branches. Image input is opt-in: provider setting `imageInput` defaults to `false`. Enabling it declares a requested capability to the DSH runtime. It does not discover endpoint capabilities or establish that a provider accepted or understood images.

## Scope and context

Only existing PNG crops prepared from original source records for tables, formulas, and algorithms are eligible. Arbitrary files and URLs are not inputs, and this scope does not add or expand figure extraction. An image must stay associated with its task, branch, asset, source record, record revision, page, and bounding box. Keep the original source context and numbering with formula and algorithm crops. Tables must remain clear original crops: never translate, reconstruct, rebuild, or redraw them.

The input and receipts retain `understanding: unverified` semantics. A path, available crop, attachment, or successful transport is not evidence that visual content was understood. A source correction changes the record revision, so receipts tied to the prior revision no longer describe the current source.

## Application bounds

The application policy currently caps each image at 1,500,000 pixels, 8,192 pixels on either side, and 8 MiB of PNG bytes. A branch may include at most four images, with aggregate limits of 16 MiB raw image bytes and 22 MiB base64 image bytes. The complete serialized request is capped at 24 MiB, including tools, history, and JSON structure. Context is capped at 20,000 UTF-8 bytes per image.

These are application bounds, not supplier limits or SDK guarantees. The guard checks actual native protocol image blocks, decodes their PNG dimensions and pixels, and matches them to admitted source crops and context. It does not treat a path or remote image URL as image content. Lossless PNG re-encoding may be acceptable if decoded pixels and dimensions still match; resizing, lossy conversion, and redraws are blocked as changed image content.

## Receipts and lifecycle

Receipts are branch- and revision-bound and report `not-sent`, `blocked`, `transported`, or `interrupted`, with a reason where applicable. These states report preparation or transport, not model comprehension. Failed validation or provider transport must remain visible as blocked or interrupted, never as understood.

Temporary branch attachments, harness state, and guard resources are cleaned up on success, failure, cancellation, and disconnect. Retained original source assets and generated outputs remain in the task workspace until explicit task deletion.

## Verification boundary

Keyless, controlled local protocol fixtures can verify application wiring, protocol blocks, bounds, association, and lifecycle handling. They cannot establish visual understanding at a real endpoint. Real authorized endpoint evaluation and any acceptance of visual understanding belong to a later ticket. Do not report image wiring or fixture success as endpoint acceptance.

Focused unit-test files, when present in the checkout:

```powershell
npm run test:unit -- tests/unit/paper-task-image-input.test.ts
npm run test:unit -- tests/unit/paper-task-image-wire.test.ts
npm run test:unit -- tests/unit/paper-task-image-request-guard.test.ts
npm run test:unit -- tests/unit/paper-task-dsh-runtime.test.ts
npm run test:unit -- tests/unit/paper-task-dsh-lifecycle.test.ts
```
